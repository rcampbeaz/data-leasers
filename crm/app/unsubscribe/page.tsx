import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { unsubscribeByToken, unsubscribeTarget } from '@/lib/unsubscribe';

export const dynamic = 'force-dynamic';

// One-click unsubscribe. The token is a random uuid stored on the contact, so the link needs no
// secret and cannot be guessed. Opening this page does not remove anyone: it asks, and the button
// posts. Mail scanners and chat clients fetch links they are shown, and a URL that unsubscribes on
// a GET removes people who never clicked. The POST at /api/unsubscribe is what a mail client's own
// unsubscribe button calls, and that POST is a deliberate action by the person.

async function confirmUnsubscribe(token: string) {
  'use server';
  const outcome = await unsubscribeByToken(token);
  redirect(outcome.ok ? '/unsubscribe?done=1' : '/unsubscribe?failed=1');
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: 520, margin: '10vh auto', padding: '0 24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24 }}>{title}</h1>
      {children}
      <p style={{ lineHeight: 1.6 }}>
        Data Leasers, LLC · <a href="https://dataleasers.com/privacy.html">Privacy</a>
      </p>
    </main>
  );
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; done?: string; failed?: string }>;
}) {
  const { token, done, failed } = await searchParams;

  if (done === '1') {
    return (
      <Frame title="You have been removed.">
        <p style={{ lineHeight: 1.6 }}>
          No further messages will be sent to this address. Nothing else is required.
        </p>
      </Frame>
    );
  }

  if (failed === '1') {
    return (
      <Frame title="That did not go through.">
        <p style={{ lineHeight: 1.6 }}>
          The link is valid, but the change could not be saved just now. Reply to any message from us
          and we will remove you by hand.
        </p>
      </Frame>
    );
  }

  const email = await unsubscribeTarget(token);

  if (!email) {
    return (
      <Frame title="That unsubscribe link is not valid.">
        <p style={{ lineHeight: 1.6 }}>
          If you keep receiving messages you did not ask for, reply to any of them and we will remove
          you by hand.
        </p>
      </Frame>
    );
  }

  return (
    <Frame title="Remove this address?">
      <p style={{ lineHeight: 1.6 }}>
        <strong>{email}</strong> will be removed from every list we hold, and any sequence it is in
        will stop.
      </p>
      <form action={confirmUnsubscribe.bind(null, token ?? '')}>
        <button
          type="submit"
          style={{ fontSize: 16, padding: '10px 18px', cursor: 'pointer' }}
        >
          Yes, remove me
        </button>
      </form>
      <p style={{ lineHeight: 1.6 }}>
        Nothing has changed yet. If you opened this by accident, close the page.
      </p>
    </Frame>
  );
}
