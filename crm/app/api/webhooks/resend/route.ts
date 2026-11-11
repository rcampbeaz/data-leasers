import { NextResponse } from 'next/server';
import { createIntakeClient } from '@/lib/supabase';
import { classifyResendEvent, verifySvixSignature } from '@/lib/resend-webhook';

export const dynamic = 'force-dynamic';

// Resend calls this when a message bounces or a recipient marks it as spam. Both become a
// suppression, because both mean the address must not be mailed again - one because it does not
// exist, the other because the person does not want it.
//
// The signature is checked before the body is read as JSON, and the route fails closed if no
// signing secret is configured. It is excluded from the auth middleware: the caller is the
// provider, which has no session.

const MAX_BODY = 100_000;

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'webhook is not configured' }, { status: 503 });
  }

  const payload = await request.text();
  if (payload.length > MAX_BODY) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  }

  const verdict = verifySvixSignature({
    id: request.headers.get('svix-id') ?? '',
    timestamp: request.headers.get('svix-timestamp') ?? '',
    signature: request.headers.get('svix-signature') ?? '',
    payload,
    secret,
  });
  if (!verdict.ok) {
    return NextResponse.json({ error: 'invalid signature', reason: verdict.reason }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const event = classifyResendEvent(body);
  if (event.kind === 'ignore') {
    return NextResponse.json({ ok: true, ignored: event.reason });
  }
  if (event.kind === 'bounce' && !event.permanent) {
    // A transient bounce is the far end being busy, not a dead address.
    return NextResponse.json({ ok: true, ignored: 'transient bounce' });
  }

  const admin = createIntakeClient();
  const reason = event.kind === 'complaint' ? 'complaint' : 'bounced';
  const contactStatus = event.kind === 'complaint' ? 'paused' : 'bounced';
  const stoppedReason = event.kind === 'complaint' ? 'Complained' : 'Bounced';
  const recorded: string[] = [];

  for (const email of event.emails) {
    const { error } = await admin.from('suppressions').upsert(
      { email, reason, note: event.detail, source: 'resend webhook' },
      { onConflict: 'email', ignoreDuplicates: true },
    );
    if (error) {
      // One bad address must not stop the rest of the batch being recorded.
      continue;
    }

    const { data: contacts } = await admin
      .from('outreach_contacts')
      .select('id')
      .eq('email', email);
    const ids = (contacts ?? []).map((row) => String(row.id));

    if (ids.length > 0) {
      await admin.from('outreach_contacts').update({ status: contactStatus }).in('id', ids);
      await admin
        .from('sequence_enrolments')
        .update({ status: 'stopped', stopped_reason: stoppedReason })
        .in('contact_id', ids)
        .in('status', ['pending_approval', 'active', 'sending', 'paused']);
    }

    recorded.push(email);
  }

  return NextResponse.json({ ok: true, recorded, reason });
}
