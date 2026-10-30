import { NextResponse, type NextRequest } from 'next/server';
import { createIntakeClient } from '@/lib/supabase';

// Sends one email per overdue or due-today task, once. Called on a schedule from the VPS.
// Protected by a shared secret. Tasks with no assignee go to all admins.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL;
  const crmOrigin = process.env.CRM_ORIGIN ?? '';
  if (!apiKey || !from) {
    return NextResponse.json({ error: 'Email is not configured' }, { status: 500 });
  }

  const supabase = createIntakeClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, due_on, assigned_to, company_id, companies(name)')
    .eq('done', false)
    .is('reminded_at', null)
    .lte('due_on', today);
  if (error) return NextResponse.json({ error: 'Could not read tasks' }, { status: 500 });

  const { data: admins } = await supabase.from('crm_staff').select('user_id').eq('role', 'admin');
  const adminIds = (admins ?? []).map((a) => a.user_id as string);

  const emailFor = async (uid: string): Promise<string | null> => {
    const { data } = await supabase.auth.admin.getUserById(uid);
    return data.user?.email ?? null;
  };

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const task of tasks ?? []) {
    const recipientIds = task.assigned_to ? [task.assigned_to as string] : adminIds;
    const addresses = (await Promise.all(recipientIds.map(emailFor))).filter(
      (e): e is string => !!e,
    );
    if (addresses.length === 0) {
      skipped++;
      continue; // left unreminded, so it is retried on the next run
    }

    const company = Array.isArray(task.companies) ? task.companies[0] : task.companies;
    const link = `${crmOrigin}/companies/${task.company_id}`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: addresses,
        subject: `Follow-up due: ${task.title}`,
        text: `${task.title}\nCompany: ${company?.name ?? 'Unknown'}\nDue: ${task.due_on}\n\nOpen in the CRM: ${link}`,
      }),
    });

    if (response.ok) {
      await supabase
        .from('tasks')
        .update({ reminded_at: new Date().toISOString() })
        .eq('id', task.id);
      sent++;
    } else {
      failed++;
    }
  }

  return NextResponse.json({ sent, failed, skipped });
}
