import { SWEEP_STATE_KEY, channelSpec, retryAdvice } from '@/lib/social';
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

// A sweep that has stopped working leaves a held post held for ever, and the queue's note promises it
// will be stopped. The publisher's response is the only other place the error shows, and a cron reads
// it, so the failure is written where the console can put it in front of a person.
//
// Clearing it is not done here. The sweep deletes the record in its own transaction (see 0020), so a
// healthy tick writes nothing at all and a tick that fails cannot erase its own warning.
//
// Recording is best effort: whatever is wrong with the sweep, and whatever is wrong with this note,
// the posts that are fine still have to go out this tick.
//
// It is also written only when what it says changes. A sweep stuck on the same error is not news, and a
// row rewritten every few minutes to say the same thing is a write nobody reads. That costs one read on
// a tick that is already failing; the healthy path takes no read, because it does not call this at all.
//
// degraded means the sweep is running but on the older two-argument signature — the database has the
// code but not 0020 — so the console says the database is behind instead of saying the sweep is broken.
export async function recordSweepFailure(
  message: string,
  { degraded = false }: { degraded?: boolean } = {},
): Promise<void> {
  try {
    const supabase = createIntakeClient();
    const { data: existing } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', SWEEP_STATE_KEY)
      .maybeSingle();
    const current = existing?.value as { error?: unknown; degraded?: unknown } | null | undefined;
    // `at` is left out of the comparison on purpose: it records when this message started, so
    // refreshing it would make the row differ from itself on every tick and defeat the check.
    if (current && current.error === message && (current.degraded === true) === degraded) return;

    const at = new Date().toISOString();
    await supabase.from('app_settings').upsert(
      { key: SWEEP_STATE_KEY, value: { error: message, at, ...(degraded ? { degraded: true } : {}) }, updated_at: at },
      { onConflict: 'key' },
    );
  } catch {
    // Nothing to do here: the caller still reports the failure in its response.
  }
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
  // Describing the channel, not advising on it: the advice comes from retryAdvice, so it cannot
  // offer a step that Retry refuses.
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
    retryAdvice(post.channelStatus),
    '',
    `Open the Marketing console: ${consoleUrl()}`,
  ].join('\n');

  return sendMail(`Post stopped: ${name} — ${post.detail.slice(0, 60)}`, text);
}

// The sweep's message. Every post in it stopped for the same reason — a run died mid-send — and every
// one of them may already be live, so the look-first check belongs to all of them. What follows it
// depends on the channel, though; that part is repeated per entry.
export async function alertAbandonedPosts(posts: AbandonedPost[]): Promise<AlertOutcome> {
  if (posts.length === 0) return 'skipped';

  const entries = posts.map((post, index) => {
    const name = label(post.platform);
    const body = post.body.length > 300 ? `${post.body.slice(0, 300)}…` : post.body;
    // One digest can hold a post on a revoked token and a post whose channel is fine, so the step is
    // per entry — and it comes from the same decision retryPost makes, rather than a second copy of
    // it that can drift.
    const missing = post.channelStatus === 'missing';
    const inactive = post.channelStatus !== 'active';
    const nextStep = retryAdvice(post.channelStatus, { checkFirst: true });
    return [
      `${index + 1}. ${name} — ${
        missing
          ? 'channel no longer connected'
          : inactive
            ? `channel is ${post.channelStatus}`
            : 'channel connected'
      }, was due ${when(post.scheduledFor)} (Phoenix)`,
      `   ${body.replace(/\s+/g, ' ')}`,
      `   ${nextStep}`,
    ].join('\n');
  });

  const count = posts.length;
  const text = [
    `The run that was sending ${count === 1 ? 'a post' : `${count} posts`} died before it could record what happened, so ${count === 1 ? 'it' : 'any of them'} may already be live on the channel.`,
    '',
    count === 1
      ? 'It is stopped in the console until somebody looks. The next step is under it.'
      : 'They are stopped in the console until somebody looks. Each one carries its own next step, because the channels are not all in the same state.',
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
