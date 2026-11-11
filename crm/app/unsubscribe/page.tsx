import { createIntakeClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// One-click unsubscribe. The token is a random uuid stored on the contact, so the link
// needs no secret and cannot be guessed. Unsubscribing suppresses the address globally,
// marks the contact, and stops every live enrolment.
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const admin = createIntakeClient();

  let message = 'That unsubscribe link is not valid.';
  let detail = 'If you keep receiving messages you did not ask for, reply to any of them and we will remove you by hand.';

  if (token) {
    const { data: contact } = await admin
      .from('outreach_contacts')
      .select('id, email')
      .eq('unsubscribe_token', token)
      .maybeSingle();

    if (contact) {
      await admin
        .from('suppressions')
        .insert({ email: contact.email, reason: 'unsubscribed', source: 'unsubscribe link' });

      await admin
        .from('outreach_contacts')
        .update({ status: 'unsubscribed' })
        .eq('id', contact.id);

      await admin
        .from('sequence_enrolments')
        .update({ status: 'stopped', stopped_reason: 'Unsubscribed' })
        .eq('contact_id', contact.id)
        .in('status', ['pending_approval', 'active', 'sending', 'paused']);

      message = 'You have been removed.';
      detail = 'No further messages will be sent to this address. Nothing else is required.';
    }
  }

  return (
    <main style={{ maxWidth: 520, margin: '10vh auto', padding: '0 24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24 }}>{message}</h1>
      <p style={{ lineHeight: 1.6 }}>{detail}</p>
      <p style={{ lineHeight: 1.6 }}>
        Data Leasers, LLC · <a href="https://dataleasers.com/privacy.html">Privacy</a>
      </p>
    </main>
  );
}
