import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createIntakeClient } from '@/lib/supabase';
import { extractEmail } from '@/lib/outbound';

// Turns a forwarded email into an activity on a company, so a thread can be logged
// without retyping it. Forward to an address that posts here, and include the
// company id in the subject or the JSON body.
//
// Protected by a shared secret in the x-inbound-secret header, compared in constant
// time. This route is excluded from the auth middleware in crm/middleware.ts.

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'inbound email is not configured' }, { status: 503 });
  }
  if (!sameSecret(request.headers.get('x-inbound-secret') ?? '', expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { company_id?: string; from?: string; subject?: string; text?: string }
    | null;
  if (!body?.company_id) {
    return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
  }

  const from = String(body.from ?? '').slice(0, 320);
  const subject = String(body.subject ?? '').slice(0, 300);
  const text = String(body.text ?? '').slice(0, 4000);
  const summary = [`From: ${from || 'unknown'}`, subject ? `Subject: ${subject}` : null, text || null]
    .filter(Boolean)
    .join('\n');

  const supabase = createIntakeClient();
  const { data: company } = await supabase
    .from('companies')
    .select('id')
    .eq('id', body.company_id)
    .maybeSingle();
  if (!company) return NextResponse.json({ error: 'company not found' }, { status: 404 });

  const { error } = await supabase.from('activities').insert({
    company_id: body.company_id,
    kind: 'email',
    body: summary,
  });
  if (error) return NextResponse.json({ error: 'could not save the email' }, { status: 500 });

  // A reply stops the sequence. Matching on the sender address is enough here: if the
  // address is one we are mailing, nothing further should go out without a person
  // looking at it first.
  // A forwarded From header is `Name <addr>`, so the address has to be pulled out before it
  // can match. Without this a reply looks like it came from nobody and the sequence keeps going.
  const replyAddress = extractEmail(from);
  if (replyAddress.includes('@')) {
    const { data: contact } = await supabase
      .from('outreach_contacts')
      .select('id')
      .eq('email', replyAddress)
      .maybeSingle();

    if (contact) {
      await supabase
        .from('sequence_enrolments')
        .update({ status: 'replied', stopped_reason: 'Replied by email' })
        .eq('contact_id', contact.id)
        .in('status', ['pending_approval', 'active', 'sending', 'paused']);
      await supabase.from('outreach_contacts').update({ status: 'replied' }).eq('id', contact.id);
    }
  }

  return NextResponse.json({ ok: true });
}
