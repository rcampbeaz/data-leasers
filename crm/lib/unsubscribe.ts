import { createIntakeClient } from '@/lib/supabase';

// One implementation of "remove this address", used by the page a person lands on and the POST a
// mail client makes. The token is a random uuid on the contact, so the link is the capability: no
// session and no secret in the URL.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A bad token and a write that did not complete are different answers. "Invalid" is the person's
// mistake and nothing more is needed; "failed" means we owe them the removal by hand.
export type UnsubscribeOutcome = { ok: true; email: string } | { ok: false; reason: 'invalid' | 'failed' };

const clean = (token: string | null | undefined) => (token ?? '').trim();

// Read-only lookup, for the page that has to show whose address it is about to remove. Nothing is
// written here: the removal itself is a POST, so a link scanner that fetches the URL cannot
// unsubscribe someone who never clicked.
export async function unsubscribeTarget(token: string | null | undefined): Promise<string | null> {
  const value = clean(token);
  // Validated before the query: an arbitrary string against a uuid column raises a database error,
  // which would look like an outage rather than a bad link.
  if (!UUID.test(value)) return null;

  const { data } = await createIntakeClient()
    .from('outreach_contacts')
    .select('id, email')
    .eq('unsubscribe_token', value)
    .maybeSingle();

  return data ? (data.email as string) : null;
}

export async function unsubscribeByToken(
  token: string | null | undefined,
): Promise<UnsubscribeOutcome> {
  const value = clean(token);
  if (!UUID.test(value)) return { ok: false, reason: 'invalid' };

  const admin = createIntakeClient();

  const { data: contact } = await admin
    .from('outreach_contacts')
    .select('id, email')
    .eq('unsubscribe_token', value)
    .maybeSingle();
  if (!contact) return { ok: false, reason: 'invalid' };

  // Global suppression first: even if a later step failed, the address is on the list that every
  // send checks. An address already on the list is the state we want, not an error to swallow, so
  // a duplicate is ignored and every other failure is reported.
  const { error: suppressError } = await admin
    .from('suppressions')
    .upsert(
      { email: contact.email, reason: 'unsubscribed', source: 'unsubscribe link' },
      { onConflict: 'email', ignoreDuplicates: true },
    );
  if (suppressError) return { ok: false, reason: 'failed' };

  const { error: contactError } = await admin
    .from('outreach_contacts')
    .update({ status: 'unsubscribed' })
    .eq('id', contact.id);
  if (contactError) return { ok: false, reason: 'failed' };

  // Every live enrolment, not just one: the same address may sit in two sequences. A sequence that
  // is already finished is left as it is, because its history is not ours to rewrite.
  const { error: stopError } = await admin
    .from('sequence_enrolments')
    .update({ status: 'stopped', stopped_reason: 'Unsubscribed' })
    .eq('contact_id', contact.id)
    .in('status', ['pending_approval', 'active', 'sending', 'paused']);
  if (stopError) return { ok: false, reason: 'failed' };

  return { ok: true, email: contact.email };
}
