import { channelSpec } from '@/lib/social';
import { createIntakeClient } from '@/lib/supabase';

// One email per post that stops for good. A post whose sending run died is not one of these: it goes
// out with the sweep's digest below, which is the only caller for that case. A spent retry ladder or a dead token is exactly the case
// where waiting for somebody to open the Marketing page is the wrong design.
//
// It is sent at the moment a post enters 'needs_manual'. That state is excluded from claiming, so
// the transition happens once and so does the message. A post that is retried and stops again is a
// new stop, and gets its own message.
//
// The exception is the sweep: a dead run can leave a backlog of abandoned posts at once, so those go
// out as a single message listing them. One list is more useful than twenty emails, and it keeps the
// publisher's work per tick bounded.
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

export type AbandonedPost = {
  platform: string;
  body: string;
  channelStatus: string;
  scheduledFor: string;
};

function label(platform: string): string {
  return channelSpec(platform)?.label ?? platform;
}

// Phoenix, because that is the clock the console runs on and the clock the reader is looking at.
function when(scheduledFor: string): string {
  return new Date(scheduledFor).toLocaleString('en-US', {
    timeZone: 'America/Phoenix',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function consoleUrl(): string {
  const origin = process.env.CRM_ORIGIN ?? 'https://app.dataleasers.com';
  return `${origin}/marketing`;
}

// The people who can actually fix this: reconnect the channel, mark it active, retry the post.
async function adminAddresses(): Promise<string[]> {
  const supabase = createIntakeClient();
  const { data: admins } = await supabase.from('crm_staff').select('user_id').eq('role', 'admin');

  const addresses: string[] = [];
  for (const admin of (admins ?? []) as { user_id: string }[]) {
    const { data } = await supabase.auth.admin.getUserById(admin.user_id);
    const email = data.user?.email;
    if (email) addresses.push(email);
  }
  return addresses;
}

async function sendMail(subject: string, text: string): Promise<AlertOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL;
  if (!apiKey || !from) return 'skipped';

  const addresses = await adminAddresses();
  if (addresses.length === 0) return 'skipped';

  try {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: addresses, subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function alertStoppedPost(post: StoppedPost): Promise<AlertOutcome> {
  const name = label(post.platform);
  // Retry refuses while the channel is not active, so the advice depends on why it stopped rather
  // than offering a button that will only say no.
  const missing = post.channelStatus === 'missing';
  const inactive = post.channelStatus !== 'active';

  const text = [
    `A ${name} post stopped and is waiting for a person.`,
    '',
    `Channel: ${name} — ${
      missing
        ? 'this channel is no longer connected'
        : inactive
          ? `the channel is ${post.channelStatus}`
          : 'connected'
    }`,
    `Was due: ${when(post.scheduledFor)} (Phoenix)`,
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
    `Open the Marketing console: ${consoleUrl()}`,
  ].join('\n');

  return sendMail(`Post stopped: ${name} — ${post.detail.slice(0, 60)}`, text);
}

// The sweep's message. Every post in it stopped for the same reason — a run died mid-send — and every
// one of them may already be live, so the advice is the same for all of them and belongs once, at the
// top, rather than repeated under each entry.
export async function alertAbandonedPosts(posts: AbandonedPost[]): Promise<AlertOutcome> {
  if (posts.length === 0) return 'skipped';

  const entries = posts.map((post, index) => {
    const name = label(post.platform);
    const body = post.body.length > 300 ? `${post.body.slice(0, 300)}…` : post.body;
    return [
      `${index + 1}. ${name} — ${post.channelStatus === 'active' ? 'connected' : `channel is ${post.channelStatus}`}, was due ${when(post.scheduledFor)} (Phoenix)`,
      `   ${body.replace(/\s+/g, ' ')}`,
    ].join('\n');
  });

  const count = posts.length;
  const text = [
    `The run that was sending ${count === 1 ? 'a post' : `${count} posts`} died before it could record what happened, so ${count === 1 ? 'it' : 'any of them'} may already be live on the channel.`,
    '',
    count === 1
      ? 'It is stopped in the console until somebody looks. Open the account and check: if the post is there, cancel it; if it is not, press Retry and it goes back in the queue.'
      : 'They are stopped in the console until somebody looks. Open each account and check: if a post is there, cancel it; if it is not, press Retry and it goes back in the queue.',
    '',
    ...entries,
    '',
    `Open the Marketing console: ${consoleUrl()}`,
  ].join('\n');

  return sendMail(
    count === 1
      ? `A post stopped: its sending run died before recording what happened`
      : `${count} posts stopped: a sending run died before recording what happened`,
    text,
  );
}
