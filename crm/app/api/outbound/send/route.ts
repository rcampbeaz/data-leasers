import { NextResponse } from 'next/server';
import { createIntakeClient } from '@/lib/supabase';
import {
  complianceFooter,
  normaliseEmail,
  renderEmail,
  sendGuard,
  unsubscribeUrl,
} from '@/lib/outbound';

export const dynamic = 'force-dynamic';

// The outbound sender. Called by cron with CRON_SECRET. Nothing here sends unless the
// enrolment was approved by a person, the contact is not suppressed, the address's country
// accepts its lawful basis, and the sender plus postal address are configured.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });

  const header = request.headers.get('authorization') ?? '';
  const given = header.replace(/^Bearer\s+/i, '') || request.headers.get('x-cron-secret') || '';
  if (given !== secret) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.OUTBOUND_FROM_EMAIL;
  const postalAddress = process.env.POSTAL_ADDRESS;
  if (!apiKey || !from || !postalAddress) {
    // Fail closed: an email without a sender or a postal address is not lawful to send.
    return NextResponse.json(
      { error: 'Outbound is not configured: RESEND_API_KEY, OUTBOUND_FROM_EMAIL and POSTAL_ADDRESS are required.' },
      { status: 503 },
    );
  }

  const admin = createIntakeClient();
  const { data: claimed, error } = await admin.rpc('claim_outbound_sends', { batch_size: 10 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const enrolments = (claimed ?? []) as {
    id: string;
    sequence_id: string;
    contact_id: string;
    current_position: number;
  }[];

  const results: { id: string; outcome: string; detail?: string }[] = [];

  for (const enrolment of enrolments) {
    const finish = async (status: string, extra: Record<string, unknown> = {}) => {
      await admin
        .from('sequence_enrolments')
        .update({ status, ...extra })
        .eq('id', enrolment.id);
    };

    const [{ data: contact }, { data: suppressed }, { data: steps }] = await Promise.all([
      admin
        .from('outreach_contacts')
        .select('id, email, country, basis, status, unsubscribe_token')
        .eq('id', enrolment.contact_id)
        .maybeSingle(),
      admin.from('suppressions').select('email'),
      admin
        .from('sequence_steps')
        .select('id, position, delay_days, subject, body')
        .eq('sequence_id', enrolment.sequence_id)
        .order('position'),
    ]);

    if (!contact) {
      await finish('stopped', { stopped_reason: 'Contact no longer exists' });
      results.push({ id: enrolment.id, outcome: 'stopped', detail: 'contact missing' });
      continue;
    }

    if (contact.status !== 'active') {
      await finish('stopped', { stopped_reason: `Contact is ${contact.status}` });
      results.push({ id: enrolment.id, outcome: 'stopped', detail: `contact ${contact.status}` });
      continue;
    }

    const suppressedEmail = normaliseEmail(contact.email);
    const isSuppressed = (suppressed ?? []).some(
      (row: { email: string }) => normaliseEmail(row.email) === suppressedEmail,
    );
    const guard = sendGuard({
      email: contact.email,
      country: contact.country,
      basis: contact.basis,
      suppressed: isSuppressed,
    });
    if (!guard.ok) {
      // A guard failure is not retryable, and it must not quietly resume later either.
      await finish('stopped', { stopped_reason: guard.reason });
      await admin.from('outbound_sends').insert({
        enrolment_id: enrolment.id,
        contact_id: contact.id,
        subject: '(blocked before send)',
        body: guard.reason,
        status: 'skipped',
        error: guard.reason,
      });
      results.push({ id: enrolment.id, outcome: 'blocked', detail: guard.reason });
      continue;
    }

    const next = (steps ?? []).find(
      (step: { position: number }) => step.position === enrolment.current_position + 1,
    ) as { id: string; position: number; delay_days: number; subject: string; body: string } | undefined;

    if (!next) {
      await finish('completed');
      results.push({ id: enrolment.id, outcome: 'completed' });
      continue;
    }

    const footer = complianceFooter({
      postalAddress,
      unsubscribe: unsubscribeUrl(contact.unsubscribe_token as string),
    });
    const body = renderEmail({ body: next.body, footer });

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [contact.email], subject: next.subject, text: body }),
    });

    const raw = await response.text();
    if (!response.ok) {
      await admin.from('outbound_sends').insert({
        enrolment_id: enrolment.id,
        contact_id: contact.id,
        step_id: next.id,
        subject: next.subject,
        body,
        status: 'failed',
        error: raw.slice(0, 500),
      });
      // One retry tomorrow, then leave it for a person.
      const retry = new Date();
      retry.setDate(retry.getDate() + 1);
      await finish('active', { next_due_on: retry.toISOString().slice(0, 10) });
      results.push({ id: enrolment.id, outcome: 'failed', detail: raw.slice(0, 200) });
      continue;
    }

    let resendId: string | null = null;
    try {
      resendId = (JSON.parse(raw) as { id?: string }).id ?? null;
    } catch {
      resendId = null;
    }

    const remaining = (steps ?? []).find(
      (step: { position: number }) => step.position === next.position + 1,
    ) as { delay_days: number } | undefined;

    const due = new Date();
    if (remaining) {
      due.setDate(due.getDate() + Number(remaining.delay_days ?? 0));
    }

    await admin.from('outbound_sends').insert({
      enrolment_id: enrolment.id,
      contact_id: contact.id,
      step_id: next.id,
      subject: next.subject,
      body,
      status: 'sent',
      resend_id: resendId,
    });

    await finish(remaining ? 'active' : 'completed', {
      current_position: next.position,
      next_due_on: remaining ? due.toISOString().slice(0, 10) : null,
    });

    results.push({ id: enrolment.id, outcome: 'sent', detail: `step ${next.position}` });
  }

  return NextResponse.json({ claimed: enrolments.length, results });
}
