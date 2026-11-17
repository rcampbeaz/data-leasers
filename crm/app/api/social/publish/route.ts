import { NextResponse } from 'next/server';
import { createIntakeClient } from '@/lib/supabase';
import {
  SWEEP_AFTER_MINUTES,
  SWEEP_STATE_KEY,
  publishPost,
  retryDelayMinutes,
  type Channel,
} from '@/lib/social';
import { alertAbandonedPosts, alertStoppedPost, recordSweepFailure } from '@/lib/social-alerts';

export const dynamic = 'force-dynamic';

// PostgREST answers a function it cannot find by that name and those arguments with PGRST202. Anything
// else — a permission error, a statement that failed — is a real sweep failure and is reported as one.
function isMissingFunction(error: { code?: string; message: string }): boolean {
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message);
}

// What came back from the sweep, in the shape the caller needs: the rows it stopped, and one message to
// show a person when there is something to say. A database behind the code is the only case where both
// a message and real work happen — the older signature still stops held posts, and only the notice it
// cannot clear is missing — so that is a flag on a successful run rather than a case of its own.
type SweepRun = {
  data: unknown[] | null;
  problem: string | null;
  degraded: boolean;
};

// 0020 widened the sweep's signature so the sweep can clear the console's warning itself, and a database
// that has not had 0020 rejects the widened call outright. A sweep that stops running is far worse than
// the notice it cannot clear, so fall back to the two-argument form.
async function sweepHeldPosts(admin: ReturnType<typeof createIntakeClient>): Promise<SweepRun> {
  const widened = await admin.rpc('sweep_stale_social_posts', {
    // The same number the queue's note quotes, so the two cannot disagree.
    stale_after_minutes: SWEEP_AFTER_MINUTES,
    // Clearing the warning is the sweep's own job: only the sweep finishing proves it works, and doing
    // it there costs a healthy tick no extra statement and no read.
    clear_state_key: SWEEP_STATE_KEY,
  });
  if (!widened.error) {
    return { data: widened.data as unknown[] | null, problem: null, degraded: false };
  }
  if (!isMissingFunction(widened.error)) {
    return { data: null, problem: widened.error.message, degraded: false };
  }

  const narrow = await admin.rpc('sweep_stale_social_posts', {
    stale_after_minutes: SWEEP_AFTER_MINUTES,
  });
  if (narrow.error) return { data: null, problem: narrow.error.message, degraded: false };
  return {
    data: (narrow.data ?? null) as unknown[] | null,
    problem: widened.error.message,
    degraded: true,
  };
}

// The publisher. Called by cron every few minutes with CRON_SECRET, never from a page.
// It claims due posts atomically, publishes each one, and records exactly what happened.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }

  const header = request.headers.get('authorization') ?? '';
  const given = header.replace(/^Bearer\s+/i, '') || request.headers.get('x-cron-secret') || '';
  if (given !== secret) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const admin = createIntakeClient();

  // The kill switch. It is read at send time, not at schedule time, so switching it
  // off stops a queue that is already full. It is honoured after the sweep and before the claim:
  // the pause means nothing new may be sent, not that a post already stuck may be left stuck.
  const { data: setting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'marketing')
    .maybeSingle();
  const controls = (setting?.value ?? {}) as { publishing_enabled?: boolean };
  const paused = controls.publishing_enabled === false;

  // Anything a dead run abandoned stops here rather than being sent again. The sweep has already put
  // those rows in needs_manual; this announces them, because the post may be live on the channel and
  // only a person can check. A sweep that fails is reported in the response and recorded for the
  // console, but does not stop publishing: the rest of the queue still goes out, and a sweep problem
  // is no reason to hold posts that are fine. A database behind the code falls back rather than
  // failing, so the sweep keeps running and only the warning says the migration is missing.
  const sweep = await sweepHeldPosts(admin);
  const swept = sweep.data;

  // Where the console can see it. The response below is read by whatever calls this route on a timer,
  // and nobody watches that; the Marketing page is where a person looks, and where the queue's note
  // says a held post will be stopped. Written best effort and never fatal: the posts that are fine
  // still go out this tick. A working sweep writes nothing here — it deletes the record in its own
  // transaction — except when the database is behind, where the sweep cannot reach the delete.
  if (sweep.problem) {
    await recordSweepFailure(sweep.problem, sweep.degraded);
  }

  const sweptResults: { id: string; outcome: string; detail?: string; alert?: string }[] = [];
  const sweptPosts = (swept ?? []) as {
    id: string;
    channel_id: string;
    body: string;
    scheduled_for: string;
    last_error: string | null;
  }[];

  if (sweptPosts.length > 0) {
    // One channel lookup for the whole sweep rather than one per post, and one message rather than
    // one per post: a backlog left by an outage can be dozens of rows, and fifty emails say less than
    // one list. The sweep is capped in SQL for the same reason — the rest is taken on the next tick.
    const { data: channels } = await admin
      .from('social_channels')
      .select('id, platform, status')
      .in('id', [...new Set(sweptPosts.map((post) => post.channel_id))]);
    const byId = new Map((channels ?? []).map((c) => [String(c.id), c]));

    const alert = await alertAbandonedPosts(
      sweptPosts.map((post) => {
        const channel = byId.get(post.channel_id);
        return {
          platform: channel ? String(channel.platform) : 'unknown',
          body: post.body,
          channelStatus: channel ? String(channel.status) : 'missing',
          scheduledFor: post.scheduled_for,
        };
      }),
    );

    for (const post of sweptPosts) {
      sweptResults.push({
        id: post.id,
        outcome: 'needs_manual',
        detail: post.last_error ?? 'A publishing run died before recording an outcome.',
        alert,
      });
    }
  }

  // Nothing is claimed while publishing is off, so the queue stays exactly where it is — but the rows
  // the sweep just resolved have been resolved, and the response says which.
  if (paused) {
    return NextResponse.json(
      {
        paused: true,
        message: 'Publishing is switched off in the Marketing console.',
        swept: sweptResults,
        ...(sweep.problem ? { sweepError: sweep.problem } : {}),
      },
      { status: 409 },
    );
  }

  const { data: claimed, error } = await admin.rpc('claim_social_posts', { batch_size: 10 });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const posts = (claimed ?? []) as {
    id: string;
    channel_id: string;
    body: string;
    first_comment: string | null;
    media: unknown;
    scheduled_for: string;
    attempts: number;
  }[];

  const results: { id: string; outcome: string; detail?: string; alert?: string }[] = [];

  for (const post of posts) {
    const { data: channel } = await admin
      .from('social_channels')
      .select('id, platform, status')
      .eq('id', post.channel_id)
      .maybeSingle();

    if (!channel || channel.status !== 'active') {
      const detail = channel ? `Channel is ${channel.status}` : 'Channel is missing';
      await admin
        .from('social_posts')
        .update({
          status: 'needs_manual',
          last_error_code: 'channel_inactive',
          last_error: detail,
        })
        .eq('id', post.id);

      // Every way into needs_manual announces itself. This one is the quietest of them: nothing
      // will happen to the post on any later run, and no provider was even called.
      const alert = await alertStoppedPost({
        platform: channel ? String(channel.platform) : 'unknown',
        body: post.body,
        code: 'channel_inactive',
        detail,
        channelStatus: channel ? String(channel.status) : 'missing',
        scheduledFor: post.scheduled_for,
      });
      results.push({ id: post.id, outcome: 'needs_manual', detail, alert });
      continue;
    }

    const media = Array.isArray(post.media) ? (post.media as string[]) : [];
    const result = await publishPost({
      channel: channel.platform as Channel,
      body: post.body,
      firstComment: post.first_comment ?? undefined,
      mediaUrls: media,
      scheduledFor: post.scheduled_for,
      idempotencyKey: post.id,
    });

    if (result.ok) {
      await admin
        .from('social_posts')
        .update({
          status: 'published',
          provider_post_id: result.providerPostId || null,
          permalink: result.permalink ?? null,
          published_at: new Date().toISOString(),
          last_error_code: null,
          last_error: null,
          next_retry_at: null,
        })
        .eq('id', post.id);
      await admin
        .from('social_channels')
        .update({ last_ok_at: new Date().toISOString(), last_error: null })
        .eq('id', channel.id);
      results.push({ id: post.id, outcome: 'published' });
      continue;
    }

    // An expired or revoked token is not retryable: say so on the channel, loudly,
    // rather than failing the same post every few minutes.
    if (result.code === 'auth') {
      await admin
        .from('social_channels')
        .update({ status: 'needs_reauth', last_error: result.message })
        .eq('id', channel.id);
      await admin
        .from('social_posts')
        .update({
          status: 'needs_manual',
          last_error_code: result.code,
          last_error: result.message,
        })
        .eq('id', post.id);
      const alert = await alertStoppedPost({
        platform: String(channel.platform),
        body: post.body,
        code: result.code,
        detail: result.message,
        channelStatus: 'needs_reauth',
        scheduledFor: post.scheduled_for,
      });
      results.push({ id: post.id, outcome: 'needs_reauth', detail: result.message, alert });
      continue;
    }

    // An ending that is not a retry has to leave the queue. claim_social_posts takes any 'failed'
    // row whose next_retry_at is null or in the past, so a failure that can never fix itself — or
    // one that has used the whole backoff ladder — would be claimed and sent again on every cron
    // tick, forever, while the response claimed it had given up. 'needs_manual' is the state that
    // stops and waits for a person.
    const delay = result.retryable ? retryDelayMinutes(post.attempts) : null;
    const nextRetry = delay === null ? null : new Date(Date.now() + delay * 60_000).toISOString();

    await admin
      .from('social_posts')
      .update({
        status: delay === null ? 'needs_manual' : 'failed',
        last_error_code: result.code,
        last_error: result.message,
        next_retry_at: nextRetry,
      })
      .eq('id', post.id);
    // Only the endings that stop are worth waking somebody for; a retry is still happening on its own.
    const alert =
      delay === null
        ? await alertStoppedPost({
            platform: String(channel.platform),
            body: post.body,
            code: result.code,
            detail: result.message,
            channelStatus: String(channel.status),
            scheduledFor: post.scheduled_for,
          })
        : null;

    results.push({
      id: post.id,
      outcome:
        delay === null ? (result.retryable ? 'gave_up' : 'not_retryable') : `retry_in_${delay}m`,
      detail: result.message,
      ...(alert ? { alert } : {}),
    });
  }

  return NextResponse.json({
    claimed: posts.length,
    swept: sweptResults,
    ...(sweep.problem ? { sweepError: sweep.problem } : {}),
    results,
  });
}
