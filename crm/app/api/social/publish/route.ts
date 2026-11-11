import { NextResponse } from 'next/server';
import { createIntakeClient } from '@/lib/supabase';
import { publishPost, retryDelayMinutes, type Channel } from '@/lib/social';

export const dynamic = 'force-dynamic';

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
  // off stops a queue that is already full.
  const { data: setting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'marketing')
    .maybeSingle();
  const controls = (setting?.value ?? {}) as { publishing_enabled?: boolean };
  if (controls.publishing_enabled === false) {
    return NextResponse.json(
      { paused: true, message: 'Publishing is switched off in the Marketing console.' },
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

  const results: { id: string; outcome: string; detail?: string }[] = [];

  for (const post of posts) {
    const { data: channel } = await admin
      .from('social_channels')
      .select('id, platform, status')
      .eq('id', post.channel_id)
      .maybeSingle();

    if (!channel || channel.status !== 'active') {
      await admin
        .from('social_posts')
        .update({
          status: 'needs_manual',
          last_error_code: 'channel_inactive',
          last_error: channel ? `Channel is ${channel.status}` : 'Channel is missing',
        })
        .eq('id', post.id);
      results.push({ id: post.id, outcome: 'needs_manual', detail: 'channel inactive' });
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
      results.push({ id: post.id, outcome: 'needs_reauth', detail: result.message });
      continue;
    }

    const delay = result.retryable ? retryDelayMinutes(post.attempts) : null;
    const nextRetry = delay === null ? null : new Date(Date.now() + delay * 60_000).toISOString();

    await admin
      .from('social_posts')
      .update({
        status: 'failed',
        last_error_code: result.code,
        last_error: result.message,
        next_retry_at: nextRetry,
      })
      .eq('id', post.id);
    results.push({
      id: post.id,
      outcome: delay === null ? 'gave_up' : `retry_in_${delay}m`,
      detail: result.message,
    });
  }

  return NextResponse.json({ claimed: posts.length, results });
}
