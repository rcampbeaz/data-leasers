import { createIntakeClient } from './supabase';
import { PLATFORM_LABELS, postErrors, type Platform } from './social';
import { getProvider, type PublishResult, type SocialProvider } from './social-provider';

// The publishing engine. It runs without a session, so it uses the service-role client:
// a cron job has no cookie to authenticate with, and row-level security would hide the
// rows it is there to send.

const MAX_ATTEMPTS = 3;
// Waits before the second and third attempt at the same channel, in minutes.
const RETRY_MINUTES = [2, 10];
// A run that dies mid-flight leaves posts in 'publishing'. They go back to the queue once
// they are old enough that no live run could still own them.
const STALE_CLAIM_MINUTES = 15;
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

  const { data: due, error } = await supabase
    .from('social_posts')
    .select('id')
    .eq('state', 'scheduled')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(RUN_LIMIT);
  if (error) throw new Error('Could not read the due posts.');

  const ids = (due ?? []).map((row) => (row as { id: string }).id);
  if (ids.length === 0) {
    return { provider: provider.name, claimed: 0, published: 0, retrying: 0, failed: 0, emailsSent: 0, results: [] };
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
    const outcome = await publishPost(supabase, provider, post, now);
    results.push({ id: post.id, state: outcome.state });
    published += outcome.published;
    retrying += outcome.retrying;
    failed += outcome.failed;
    if (outcome.emailed) emailsSent++;
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
  await supabase.from('social_post_channels').update(patch).eq('id', id);
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
  let earliestRetry: string | null = null;

  if (links.length === 0) {
    await supabase.from('social_posts').update({ state: 'failed', updated_at: nowIso }).eq('id', post.id);
    const emailed = await notifyFailure(
      supabase,
      { ...post, state: 'failed' },
      ['The post has no channels, so nothing could be sent.'],
      now,
    );
    return { state: 'failed', published: 0, retrying: 0, failed: 1, emailed };
  }

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
      if (!earliestRetry || link.next_attempt_at < earliestRetry) earliestRetry = link.next_attempt_at;
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
      });
    } catch (error) {
      // A provider that throws is treated as a retryable failure. The alternative is a
      // post stuck in 'publishing' until the stale claim puts it back.
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

    const attempts = link.attempts + 1;
    const willRetry = result.retryable && attempts < MAX_ATTEMPTS;
    const backoff = RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)];
    const next = willRetry ? new Date(now.getTime() + backoff * 60_000).toISOString() : null;

    await setLink(supabase, link.id, {
      status: willRetry ? 'scheduled' : 'failed',
      attempts,
      error: result.error.slice(0, 2000),
      next_attempt_at: next,
      provider: provider.name,
    });

    if (willRetry && next) {
      waiting++;
      if (!earliestRetry || next < earliestRetry) earliestRetry = next;
    } else {
      failed++;
    }
    errors.push(`${label}: ${result.error}`);
  }

  const state =
    waiting > 0 ? 'scheduled' : failed === 0 ? 'published' : published > 0 ? 'partial' : 'failed';

  const patch: Record<string, unknown> = { state, updated_at: nowIso };
  if (state === 'published' || state === 'partial') patch.published_at = nowIso;
  // A waiting retry moves the post's own clock, so the next sweep finds it without a
  // second query across the channel rows.
  if (state === 'scheduled') patch.scheduled_for = earliestRetry ?? nowIso;

  await supabase.from('social_posts').update(patch).eq('id', post.id);

  const emailed =
    state === 'failed' || state === 'partial'
      ? await notifyFailure(supabase, { ...post, state }, errors, now)
      : false;

  return { state, published, retrying: waiting, failed, emailed };
}

// One message per post, not one per sweep. The timestamp is written whether or not the
// send succeeded: a post that has genuinely failed should not keep emailing every ten
// minutes because Resend is having a bad day.
async function notifyFailure(
  supabase: Client,
  post: PostRow & { state: string },
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
    `A social post ended up ${post.state}.`,
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
      subject: `Social post ${post.state}: ${(errors[0] ?? 'see the queue').slice(0, 90)}`,
      text,
    }),
  });

  await supabase
    .from('social_posts')
    .update({ failure_notified_at: now.toISOString() })
    .eq('id', post.id);

  return response.ok;
}
