import { NextResponse } from 'next/server';
import { createIntakeClient } from '@/lib/supabase';
import { CHASE_WINDOW_DAYS, planChaseTasks, type ReferralRow } from '@/lib/referral-chase';

export const dynamic = 'force-dynamic';

// The daily referral chase. Reads open referrals inside the last 30 days of their six-month window
// and creates a task for each so it lands on the Tasks page and in the reminder email. Inside the
// last seven days the task is an escalation instead of the routine chase, so the referral is raised
// again at the point it is most likely to be lost. Each window has its own column, and that column
// is the idempotency key - not the title, which a person may rewrite.

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });

  const header = request.headers.get('authorization') ?? '';
  const given = header.replace(/^Bearer\s+/i, '') || request.headers.get('x-cron-secret') || '';
  if (given !== secret) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const supabase = createIntakeClient();
  const today = new Date();
  const horizon = new Date(today.getTime() + CHASE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  const { data: referralData, error: referralError } = await supabase
    .from('referrals')
    .select('id, company_id, company_name, deadline_on, status, chase_task_id, escalation_task_id')
    .in('status', ['registered', 'introduced'])
    .lte('deadline_on', horizon)
    .order('deadline_on');
  if (referralError) {
    return NextResponse.json({ error: referralError.message }, { status: 500 });
  }

  const referrals = (referralData ?? []) as unknown as ReferralRow[];
  const companyIds = Array.from(
    new Set(referrals.map((row) => row.company_id).filter((id): id is string => Boolean(id))),
  );

  const owners = new Map<string, string | null>();
  if (companyIds.length > 0) {
    const { data: companies } = await supabase
      .from('companies')
      .select('id, owner_id')
      .in('id', companyIds);
    for (const company of (companies ?? []) as { id: string; owner_id: string | null }[]) {
      owners.set(company.id, company.owner_id);
    }
  }

  const plan = planChaseTasks(
    referrals.map((row) => ({
      ...row,
      owner_id: row.company_id ? owners.get(row.company_id) ?? null : null,
    })),
    { today },
  );

  const created: { referralId: string; companyName: string; kind: string; title: string }[] = [];
  const failed: { referralId: string; reason: string }[] = [];

  for (const item of plan.create) {
    const { data: task, error } = await supabase
      .from('tasks')
      .insert({
        company_id: item.companyId,
        title: item.title,
        due_on: item.dueOn,
        assigned_to: item.assignedTo,
      })
      .select('id')
      .single();

    if (error || !task) {
      failed.push({ referralId: item.referralId, reason: error?.message ?? 'task not created' });
      continue;
    }

    const column = item.kind === 'escalation' ? 'escalation_task_id' : 'chase_task_id';
    const { error: linkError } = await supabase
      .from('referrals')
      .update({ [column]: task.id })
      .eq('id', item.referralId);

    if (linkError) {
      // The task exists but is not linked; the next run would create a second one, so this is
      // reported rather than swallowed.
      failed.push({ referralId: item.referralId, reason: `task created but not linked: ${linkError.message}` });
      continue;
    }

    created.push({
      referralId: item.referralId,
      companyName: item.companyName,
      kind: item.kind,
      title: item.title,
    });
  }

  return NextResponse.json({
    window_days: CHASE_WINDOW_DAYS,
    evaluated: referrals.length,
    created,
    skipped: plan.skipped,
    failed,
  });
}
