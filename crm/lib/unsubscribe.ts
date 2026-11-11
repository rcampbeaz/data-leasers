import { createIntakeClient } from '@/lib/supabase';

// One implementation of "remove this address", used by both the page a person lands on and the
// POST a mail client makes. The token is a random uuid on the contact, so the link is the
// capability: no session and no secret in the URL.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type UnsubscribeOutcome = { ok: true; email: string } | { ok: false };

export async function unsubscribeByToken(
  token: string | null | undefined,
): Promise<UnsubscribeOutcome> {
  const clean = (token ?? '').trim();
  // Validated before the query: an arbitrary string against a uuid column raises a database
  // error, which would look like an outage rather than a bad link.
  if (!UUID.test(clean)) return { ok: false };

  const admin = createIntakeClient();

  const { data: contact } = await admin
    .from('outreach_contacts')
    .select('id, email')
    .eq('unsubscribe_token', clean)
    .maybeSingle();
  if (!contact) return { ok: false };

  // Global suppression first: even if a later step failed, the address is on the list that
  // every send checks.
  await admin
    .from('suppressions')
    .insert({ email: contact.email, reason: 'unsubscribed', source: 'unsubscribe link' });

  await admin.from('outreach_contacts').update({ status: 'unsubscribed' }).eq('id', contact.id);

  await admin
    .from('sequence_enrolments')
    .update({ status: 'stopped', stopped_reason: 'Unsubscribed' })
    .eq('contact_id', contact.id)
    .in('status', ['pending_approval', 'active', 'sending', 'paused']);

  return { ok: true, email: contact.email };
}
