import { createIntakeClient } from './supabase';
import { PLATFORM_LABELS, postErrors, type Platform } from './social';
import { getProvider, type PublishResult, type SocialProvider } from './social-provider';

// The publishing engine. It runs without a session, so it uses the service-role client:
// a cron job has no cookie to authenticate with, and row-level security would hide the
// rows it is there to send.

const MAX_ATTEMPTS = 3;
// One entry per retry, so the second attempt waits two minutes and the third ten.
const RETRY_MINUTES = [2, 10];
const PROVIDER_TIMEOUT_MS = 30_000;
// A claim is kept alive per channel (see touch() below), so this only has to be longer
// than one provider call, not longer than a whole run.
const STALE_CLAIM_MINUTES = 10;
const RUN_LIMIT = 20;

type Client = ReturnType<typeof createIntakeClient>;

type LinkRow = {
  id: string;
  channel_id: string;
  body: string | null;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  social_channels: {
    platform: string;
    handle: string;
    external_id: string | null;
    active: boolean;
  } | null;
};

type PostRow = {
  id: string;
  body: string;
  link_url: string | null;
  media_url: string | null;
  media_alt: string | null;
  failure_notified_at: string | null;
  social_post_channels: LinkRow[] | null;
};

export type RunReport = {
  provider: string;
  claimed: number;
  published: number;
  retrying: number;
  failed: number;
  emailsSent: number;
  // 'error' means the post was claimed but recording its result failed; it stays in
  // 'publishing' until the stale sweep puts it back.
  results: { id: string; state: string }[];
};

export async function publishDue(now: Date = new Date()): Promise<RunReport> {
  const supabase = createIntakeClient();
  const provider = getProvider();
  const nowIso = now.toISOString();

  await supabase
    .from('social_posts')
    .update({ state: 'scheduled', updated_at: nowIso })
    .eq('state', 'publishing')
    .lt('updated_at', new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000).toISOString());

  // A post is due when its own time has passed and no channel is still waiting on a retry
  // clock. Both halves are needed: scheduled_for is the record of when the post was meant
  // to go out and is never moved, so on its own it would make a retrying post look due on
  // every sweep. The waiting is read from the channel rows, where the retry clock lives.
  const { data: candidates, error } = await supabase
    .from('social_posts')
    .select('id, social_post_channels(next_attempt_at)')
    .eq('state', 'scheduled')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    // Read more rows than one run will claim: a post waiting on a retry clock is filtered
    // out below, and it should not take a slot from a post that is genuinely due.
    .limit(RUN_LIMIT * 5);
  if (error) throw new Error('Could not read the due posts.');

  const ids = (
    (candidates ?? []) as unknown as {
      id: string;
      social_post_channels: { next_attempt_at: string | null }[] | null;
    }[]
  )
    .filter((post) =>
      (post.social_post_channels ?? []).every(
        (link) => !link.next_attempt_at || Date.parse(link.next_attempt_at) <= now.getTime(),
      ),
    )
    .map((post) => post.id)
    .slice(0, RUN_LIMIT);
  if (ids.length === 0) {
    return {
      provider: provider.name,
      claimed: 0,
      published: 0,
      retrying: 0,
      failed: 0,
      emailsSent: 0,
      results: [],
    };
  }

  // The claim is the update's own return value: only rows still in 'scheduled' come back,
  // so two runs a second apart cannot both send the same post. Reading first and updating
  // second would leave exactly that gap.
  const { data: claimed, error: claimError } = await supabase
    .from('social_posts')
    .update({ state: 'publishing', updated_at: nowIso })
    .in('id', ids)
    .eq('state', 'scheduled')
    .select(
      'id, body, link_url, media_url, media_alt, failure_notified_at, social_post_channels(id, channel_id, body, status, attempts, next_attempt_at, social_channels(platform, handle, external_id, active))',
    );
  if (claimError) throw new Error('Could not claim the due posts.');

  let published = 0;
  let retrying = 0;
  let failed = 0;
  let emailsSent = 0;
  const results: { id: string; state: string }[] = [];

  for (const post of (claimed ?? []) as unknown as PostRow[]) {
    try {
      const outcome = await publishPost(supabase, provider, post, now);
      results.push({ id: post.id, state: outcome.state });
      published += outcome.published;
      retrying += outcome.retrying;
      failed += outcome.failed;
      if (outcome.emailed) emailsSent++;
    } catch {
      // One post failing to record its result should not abandon the rest of the run. It
      // stays claimed and the stale sweep will pick it up, already-published channels and
      // all, because those are skipped on the second pass.
      results.push({ id: post.id, state: 'error' });
    }
  }

  return {
    provider: provider.name,
    claimed: results.length,
    published,
    retrying,
    failed,
    emailsSent,
    results,
  };
}

async function setLink(supabase: Client, id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('social_post_channels').update(patch).eq('id', id);
  // Thrown, not swallowed: a write that failed here would otherwise leave the channel
  // looking unsent and it would be sent again on the next sweep.
  if (error) throw new Error('Could not record a channel result.');
}

// Keeps the claim fresh while a post is being worked on, so the stale sweep only reclaims
// posts whose run has actually stopped. Without this the window would have to be as long
// as the slowest possible run, which is what lets a live run and a reclaim overlap.
async function touch(supabase: Client, postId: string) {
  await supabase
    .from('social_posts')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', postId);
}

async function publishPost(
  supabase: Client,
  provider: SocialProvider,
  post: PostRow,
  now: Date,
): Promise<{ state: string; published: number; retrying: number; failed: number; emailed: boolean }> {
  const links = post.social_post_channels ?? [];
  const nowIso = now.toISOString();
  const errors: string[] = [];
  let published = 0;
  let failed = 0;
  let waiting = 0;

  if (links.length === 0) errors.push('The post has no channels, so nothing could be sent.');

  for (const link of links) {
    // A channel that already has an answer is not asked again.
    if (link.status === 'published') {
      published++;
      continue;
    }
    if (link.status === 'failed' || link.status === 'skipped') {
      if (link.status === 'failed') failed++;
      continue;
    }
    if (link.next_attempt_at && Date.parse(link.next_attempt_at) > now.getTime()) {
      waiting++;
      continue;
    }

    const channel = link.social_channels;
    const label = channel
      ? `${PLATFORM_LABELS[channel.platform as Platform] ?? channel.platform} ${channel.handle}`
      : 'Unknown channel';

    if (!channel || !channel.active) {
      await setLink(supabase, link.id, {
        status: 'failed',
        error: `${label} is no longer active.`,
        next_attempt_at: null,
      });
      failed++;
      errors.push(`${label}: the channel is no longer active.`);
      continue;
    }

    const platform = channel.platform as Platform;

    // The checks run again here, not only in the composer. A post can sit in the queue
    // for weeks: a channel gets switched off, the text is edited into something a
    // platform refuses, or the media address stops resolving. Sending is the last place
    // to notice, and the only place where noticing still helps.
    const problems = postErrors({
      body: post.body,
      linkUrl: post.link_url,
      mediaUrl: post.media_url,
      channels: [{ platform, body: link.body }],
    });
    if (problems.length > 0) {
      await setLink(supabase, link.id, {
        status: 'failed',
        error: problems[0],
        next_attempt_at: null,
      });
      failed++;
      errors.push(problems[0]);
      continue;
    }

    await touch(supabase, post.id);

    let result: PublishResult;
    try {
      result = await provider.publish({
        platform,
        handle: channel.handle,
        externalId: channel.external_id,
        body: link.body ?? post.body,
        linkUrl: post.link_url,
        mediaUrl: post.media_url,
        mediaAlt: post.media_alt,
        idempotencyKey: `${post.id}:${link.channel_id}`,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      // A provider that throws or times out is a retryable failure. Letting it escape would
      // leave the post in 'publishing' until the stale sweep put it back.
      result = {
        ok: false,
        error: error instanceof Error ? error.message : 'The provider threw without a message.',
        retryable: true,
      };
    }

    if (result.ok) {
      await setLink(supabase, link.id, {
        status: 'published',
        remote_id: result.remoteId,
        permalink: result.permalink,
        error: null,
        next_attempt_at: null,
        published_at: nowIso,
        provider: provider.name,
        attempts: link.attempts + 1,
      });
      published++;
      continue;
    }

    // attempts is at most MAX_ATTEMPTS - 1 whenever a retry is scheduled, so the index is
    // always inside RETRY_MINUTES.
    const attempts = link.attempts + 1;
    const willRetry = result.retryable && attempts < MAX_ATTEMPTS;
    const next = willRetry
      ? new Date(now.getTime() + RETRY_MINUTES[attempts - 1] * 60_000).toISOString()
      : null;

    await setLink(supabase, link.id, {
      status: willRetry ? 'scheduled' : 'failed',
      attempts,
      error: result.error.slice(0, 2000),
      next_attempt_at: next,
      provider: provider.name,
    });

    if (willRetry) waiting++;
    else failed++;
    errors.push(`${label}: ${result.error}`);
  }

  const state =
    waiting > 0 ? 'scheduled' : published === 0 ? 'failed' : failed === 0 ? 'published' : 'partial';

  const patch: Record<string, unknown> = { state, updated_at: nowIso };
  if (state === 'published' || state === 'partial') patch.published_at = nowIso;
  // scheduled_for is deliberately left alone. It records when the post was meant to go
  // out; a retry has its own clock on the channel rows, which the due query reads. Moving
  // it would rewrite history and make the calendar jump every time an attempt slipped.

  const { error: stateError } = await supabase
    .from('social_posts')
    .update(patch)
    .eq('id', post.id);
  if (stateError) throw new Error('Could not record the post state.');

  const emailed =
    state === 'failed' || state === 'partial'
      ? await notifyFailure(supabase, post, state, errors, now)
      : false;

  return { state, published, retrying: waiting, failed, emailed };
}

// One message per post, not one per sweep. The timestamp is written whether or not the
// send succeeded: a post that has genuinely failed should not keep emailing every ten
// minutes because Resend is having a bad day.
async function notifyFailure(
  supabase: Client,
  post: PostRow,
  state: string,
  errors: string[],
  now: Date,
): Promise<boolean> {
  if (post.failure_notified_at) return false;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL;
  const to = (process.env.SOCIAL_ALERT_EMAIL ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  const origin = process.env.CRM_ORIGIN ?? '';

  if (!apiKey || !from || to.length === 0) {
    await supabase
      .from('social_posts')
      .update({ failure_notified_at: now.toISOString() })
      .eq('id', post.id);
    return false;
  }

  const text = [
    `A social post ended up ${state}.`,
    '',
    post.body.slice(0, 500),
    '',
    ...errors.slice(0, 10),
    '',
    origin ? `Open the queue: ${origin}/social` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: `Social post ${state}: ${(errors[0] ?? 'see the queue').slice(0, 90)}`,
      text,
    }),
  });

  await supabase
    .from('social_posts')
    .update({ failure_notified_at: now.toISOString() })
    .eq('id', post.id);

  return response.ok;
}
