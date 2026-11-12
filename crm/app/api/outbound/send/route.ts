import { NextResponse } from 'next/server';
import { createIntakeClient } from '@/lib/supabase';
import {
  complianceFooter,
  normaliseEmail,
  renderEmail,
  sendGuard,
  unsubscribeHeaders,
  unsubscribeUrl,
} from '@/lib/outbound';
import { domainOf } from '@/lib/deliverability';
import { firstNameOf, renderMessage } from '@/lib/template-render';

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

    const [{ data: contact }, { data: steps }] = await Promise.all([
      admin
        .from('outreach_contacts')
        .select('id, email, country, basis, status, unsubscribe_token, full_name, role_title, company:companies(name)')
        .eq('id', enrolment.contact_id)
        .maybeSingle(),
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

    // One indexed lookup for this address. Reading the whole suppression table on every
    // batch worked until the list was large, then it became the slowest part of a send.
    const suppressedEmail = normaliseEmail(contact.email);
    const { data: suppressed } = await admin
      .from('suppressions')
      .select('email')
      .eq('email', suppressedEmail)
      .maybeSingle();
    const isSuppressed = Boolean(suppressed);
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

    // A domain hold is not a suppression: the contact stays in the pipeline and resumes when the
    // domain is released. The step is not consumed, so the message that was due is still due.
    const heldDomain = domainOf(contact.email);
    if (heldDomain) {
      const { data: hold } = await admin
        .from('domain_holds')
        .select('domain')
        .eq('domain', heldDomain)
        .is('released_at', null)
        .maybeSingle();
      if (hold) {
        const retry = new Date();
        retry.setDate(retry.getDate() + 1);
        await finish('active', { next_due_on: retry.toISOString().slice(0, 10) });
        results.push({ id: enrolment.id, outcome: 'held', detail: heldDomain });
        continue;
      }
    }

    const next = (steps ?? []).find(
      (step: { position: number }) => step.position === enrolment.current_position + 1,
    ) as { id: string; position: number; delay_days: number; subject: string; body: string } | undefined;

    if (!next) {
      await finish('completed');
      results.push({ id: enrolment.id, outcome: 'completed' });
      continue;
    }

    // Merge fields are filled here and only here, so the approved text, the sent text and the copy
    // kept in outbound_sends are the same string.
    const companyRow = (Array.isArray(contact.company) ? contact.company[0] : contact.company) as
      | { name?: string | null }
      | null;
    const rendered = renderMessage(
      { subject: next.subject, body: next.body },
      {
        first_name: firstNameOf(contact.full_name as string | null),
        full_name: (contact.full_name as string | null) ?? '',
        role_title: (contact.role_title as string | null) ?? '',
        email: contact.email as string,
        company: companyRow?.name ?? '',
      },
    );

    const footer = complianceFooter({
      postalAddress,
      unsubscribe: unsubscribeUrl(contact.unsubscribe_token as string),
    });
    const body = renderEmail({ body: rendered.body, footer });

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [contact.email],
        subject: rendered.subject,
        text: body,
        // Created per message, because the token belongs to this contact.
        headers: unsubscribeHeaders(contact.unsubscribe_token as string),
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      await admin.from('outbound_sends').insert({
        enrolment_id: enrolment.id,
        contact_id: contact.id,
        step_id: next.id,
        subject: rendered.subject,
        body,
        status: 'failed',
        error: raw.slice(0, 500),
      });
      // Retry once a day, but not forever: after three rejections the reason is the address
      // or the domain, and another attempt only damages the sending reputation.
      const { count: failures } = await admin
        .from('outbound_sends')
        .select('id', { count: 'exact', head: true })
        .eq('enrolment_id', enrolment.id)
        .eq('status', 'failed');
      if ((failures ?? 0) >= 3) {
        await finish('paused', {
          stopped_reason: 'Provider rejected three attempts; check the address and the sending domain.',
        });
        results.push({ id: enrolment.id, outcome: 'paused', detail: raw.slice(0, 200) });
        continue;
      }
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
