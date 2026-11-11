import { unsubscribeByToken } from '@/lib/unsubscribe';

export const dynamic = 'force-dynamic';

// One-click unsubscribe. The token is a random uuid stored on the contact, so the link needs
// no secret and cannot be guessed. Unsubscribing suppresses the address globally, marks the
// contact, and stops every live enrolment. The same work is reachable as a POST at
// /api/unsubscribe for mail clients that offer their own unsubscribe button.
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const outcome = await unsubscribeByToken(token);

  const message = outcome.ok ? 'You have been removed.' : 'That unsubscribe link is not valid.';
  const detail = outcome.ok
    ? 'No further messages will be sent to this address. Nothing else is required.'
    : 'If you keep receiving messages you did not ask for, reply to any of them and we will remove you by hand.';

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
