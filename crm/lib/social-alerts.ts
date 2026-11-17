import { channelSpec } from '@/lib/social';
import { createIntakeClient } from '@/lib/supabase';

// One email per post that stops for good. A spent retry ladder or a dead token is exactly the case
// where waiting for somebody to open the Marketing page is the wrong design.
//
// It is sent at the moment a post enters 'needs_manual'. That state is excluded from claiming, so
// the transition happens once and so does the message. A post that is retried and stops again is a
// new stop, and gets its own message.
//
// Everything here is best effort. A post must never be held in 'publishing' because an email was
// slow or refused, and the caller reports what happened rather than relying on the queue to say so.

const RESEND_URL = 'https://api.resend.com/emails';

export type AlertOutcome = 'sent' | 'skipped' | 'failed';

export type StoppedPost = {
  platform: string;
  body: string;
  code: string;
  detail: string;
  channelStatus: string;
  scheduledFor: string;
};

export async function alertStoppedPost(post: StoppedPost): Promise<AlertOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL;
  if (!apiKey || !from) return 'skipped';

  // The people who can actually fix this: reconnect the channel, mark it active, retry the post.
  const supabase = createIntakeClient();
  const { data: admins } = await supabase.from('crm_staff').select('user_id').eq('role', 'admin');

  const addresses: string[] = [];
  for (const admin of (admins ?? []) as { user_id: string }[]) {
    const { data } = await supabase.auth.admin.getUserById(admin.user_id);
    const email = data.user?.email;
    if (email) addresses.push(email);
  }
  if (addresses.length === 0) return 'skipped';

  const label = channelSpec(post.platform)?.label ?? post.platform;
  const when = new Date(post.scheduledFor).toLocaleString('en-US', {
    timeZone: 'America/Phoenix',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const origin = process.env.CRM_ORIGIN ?? 'https://app.dataleasers.com';
  // Retry refuses while the channel is not active, so the advice depends on why it stopped rather
  // than offering a button that will only say no.
  const missing = post.channelStatus === 'missing';
  const inactive = post.channelStatus !== 'active';

  const text = [
    `A ${label} post stopped and is waiting for a person.`,
    '',
    `Channel: ${label} — ${
      missing
        ? 'this channel is no longer connected'
        : inactive
          ? `the channel is ${post.channelStatus}`
          : 'connected'
    }`,
    `Was due: ${when} (Phoenix)`,
    `Reason: ${post.detail} (${post.code})`,
    '',
    `Post: ${post.body.slice(0, 400)}${post.body.length > 400 ? '…' : ''}`,
    '',
    missing
      ? 'The account this post was queued for is no longer connected, and the post still points at the channel that has gone, so Retry cannot help. Connect the account again on the Channels tab, then cancel this post and schedule the content to the new channel.'
      : inactive
        ? 'Reconnect the channel with the provider, press Mark active on the Channels tab, then Retry the post.'
        : 'Press Retry on the post once the cause has been fixed. Nothing else will send it.',
    '',
    `Open the Marketing console: ${origin}/marketing`,
  ].join('\n');

  try {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: addresses,
        subject: `Post stopped: ${label} — ${post.detail.slice(0, 60)}`,
        text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
