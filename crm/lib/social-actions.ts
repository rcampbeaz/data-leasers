'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createIntakeClient, createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import {
  PLATFORMS,
  PLATFORM_LABELS,
  charCount,
  issuesForChannel,
  mediaKindFor,
  phoenixToUtc,
  type Platform,
  type PostDraft,
} from '@/lib/social';

function text(form: FormData, key: string, max: number): string | null {
  const value = String(form.get(key) ?? '').trim();
  return value ? value.slice(0, max) : null;
}

function refresh() {
  revalidatePath('/social');
  revalidatePath('/social/calendar');
  revalidatePath('/social/channels');
}

// Writes are checked against the staff table as well as row-level security, so a
// refused write names the problem rather than surfacing a database error.
async function requireWriter(path: string) {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) {
    redirect(`${path}?error=${encodeURIComponent('Your role does not allow that change.')}`);
  }
  return { supabase, me };
}

async function audit(
  actorId: string,
  entity: string,
  entityId: string,
  action: string,
  detail: Record<string, unknown> = {},
) {
  await createIntakeClient().from('audit_log').insert({
    actor_id: actorId,
    entity,
    entity_id: entityId,
    action,
    detail,
  });
}

export type CreatePostResult = { error: string } | void;

// Called from the composer in the browser, so a validation failure comes back as a
// message beside the form instead of a redirect that would throw the draft away.
export async function createPost(draft: PostDraft): Promise<CreatePostResult> {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) {
    return { error: 'Your role does not allow posting.' };
  }

  const body = draft.body.trim();
  if (!body) return { error: 'Write the post before saving it.' };
  if (charCount(body) > 10_000) return { error: 'That is too long to store as one post.' };

  const wanted = draft.channels.filter((c) => c.channelId);
  if (wanted.length === 0) return { error: 'Choose at least one channel.' };
  if (wanted.length > PLATFORMS.length * 2) return { error: 'Too many channels for one post.' };

  const { data: channelRows, error: channelError } = await supabase
    .from('social_channels')
    .select('id, platform, active')
    .in('id', wanted.map((c) => c.channelId));
  if (channelError) {
    return { error: 'Could not read the channels. Check that 0009_social.sql has been run.' };
  }

  const platformById = new Map<string, Platform>();
  for (const row of (channelRows ?? []) as { id: string; platform: string; active: boolean }[]) {
    if (!row.active) continue;
    platformById.set(row.id, row.platform as Platform);
  }

  const mediaKind = mediaKindFor(draft.mediaUrl?.trim() || null);
  const hasLink = Boolean(draft.linkUrl?.trim()) || /https?:\/\//i.test(body);

  // The server repeats every check the composer made. A browser can be told to skip
  // them; this cannot.
  for (const channel of wanted) {
    const platform = platformById.get(channel.channelId);
    if (!platform) return { error: 'One of the chosen channels is not active. Reload and try again.' };
    const channelText = channel.body?.trim() || body;
    const errors = issuesForChannel(platform, channelText, { mediaKind, hasLink }).filter(
      (issue) => issue.level === 'error',
    );
    if (errors.length > 0) {
      return { error: `${PLATFORM_LABELS[platform]}: ${errors[0].message}` };
    }
  }

  let scheduledFor: string | null = null;
  if (draft.scheduledFor) {
    scheduledFor = phoenixToUtc(draft.scheduledFor);
    if (!scheduledFor) return { error: 'That is not a date and time I can read.' };
    if (Date.parse(scheduledFor) < Date.now() - 60_000) {
      return { error: 'That time has already passed. Choose a later time, or save it as a draft.' };
    }
  }

  const { data: post, error: insertError } = await supabase
    .from('social_posts')
    .insert({
      body,
      link_url: draft.linkUrl?.trim() || null,
      media_url: draft.mediaUrl?.trim() || null,
      media_alt: draft.mediaAlt?.trim() || null,
      state: scheduledFor ? 'scheduled' : 'draft',
      scheduled_for: scheduledFor,
      created_by: me.user_id,
    })
    .select('id')
    .single();
  if (insertError || !post) return { error: 'Could not save the post.' };

  // An override is only stored when it actually differs, so a later edit to the
  // master copy still reaches every channel that was left alone.
  const rows = wanted.map((channel) => {
    const override = channel.body?.trim();
    return {
      post_id: post.id,
      channel_id: channel.channelId,
      body: override && override !== body ? override : null,
      status: scheduledFor ? 'scheduled' : 'pending',
    };
  });

  const { error: childError } = await supabase.from('social_post_channels').insert(rows);
  if (childError) {
    // Without its channels the post cannot be published, so it is not left behind.
    await supabase.from('social_posts').delete().eq('id', post.id);
    return { error: 'Could not attach the channels to the post.' };
  }

  await audit(me.user_id, 'social_post', post.id, 'created', {
    state: scheduledFor ? 'scheduled' : 'draft',
    scheduled_for: scheduledFor,
    channels: rows.length,
  });

  refresh();
  redirect(`/social?saved=${scheduledFor ? 'scheduled' : 'draft'}`);
}

export async function reschedulePost(postId: string, formData: FormData) {
  const path = '/social';
  const { supabase, me } = await requireWriter(path);

  const local = String(formData.get('when') ?? '').trim();
  const scheduledFor = phoenixToUtc(local);
  if (!scheduledFor) redirect(`${path}?error=${encodeURIComponent('Choose a date and time.')}`);
  if (Date.parse(scheduledFor) < Date.now() - 60_000) {
    redirect(`${path}?error=${encodeURIComponent('That time has already passed.')}`);
  }

  const { error } = await supabase
    .from('social_posts')
    .update({ scheduled_for: scheduledFor, state: 'scheduled', updated_at: new Date().toISOString() })
    .eq('id', postId)
    .in('state', ['draft', 'scheduled']);
  if (error) redirect(`${path}?error=${encodeURIComponent('Could not move the post.')}`);

  await supabase
    .from('social_post_channels')
    .update({ status: 'scheduled' })
    .eq('post_id', postId)
    .eq('status', 'pending');

  await audit(me.user_id, 'social_post', postId, 'rescheduled', { scheduled_for: scheduledFor });
  refresh();
  redirect(`${path}?saved=moved`);
}

export async function cancelPost(postId: string) {
  const path = '/social';
  const { supabase, me } = await requireWriter(path);

  const { error } = await supabase
    .from('social_posts')
    .update({ state: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', postId)
    .in('state', ['draft', 'scheduled']);
  if (error) redirect(`${path}?error=${encodeURIComponent('Could not cancel the post.')}`);

  await supabase.from('social_post_channels').update({ status: 'skipped' }).eq('post_id', postId);

  await audit(me.user_id, 'social_post', postId, 'cancelled', {});
  refresh();
  redirect(`${path}?saved=cancelled`);
}

// Only drafts are deletable. A post that has been scheduled or published is part of
// the record of what went out, so it is cancelled rather than removed.
export async function deletePost(postId: string) {
  const path = '/social';
  const { supabase, me } = await requireWriter(path);

  const { error } = await supabase.from('social_posts').delete().eq('id', postId).eq('state', 'draft');
  if (error) redirect(`${path}?error=${encodeURIComponent('Could not delete the draft.')}`);

  await audit(me.user_id, 'social_post', postId, 'deleted', {});
  refresh();
  redirect(`${path}?saved=deleted`);
}

export async function addChannel(formData: FormData) {
  const path = '/social/channels';
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || me.role !== 'admin') {
    redirect(`${path}?error=${encodeURIComponent('Only an admin can add a channel.')}`);
  }

  const platform = String(formData.get('platform') ?? '');
  const handle = text(formData, 'handle', 200);
  const identity = String(formData.get('identity') ?? 'page');
  if (!PLATFORMS.includes(platform as Platform)) {
    redirect(`${path}?error=${encodeURIComponent('Choose a platform.')}`);
  }
  if (!handle) redirect(`${path}?error=${encodeURIComponent('Enter the account handle.')}`);
  if (!['page', 'company', 'profile', 'business'].includes(identity)) {
    redirect(`${path}?error=${encodeURIComponent('Choose what the account posts as.')}`);
  }

  const { data, error } = await supabase
    .from('social_channels')
    .insert({
      platform,
      handle: handle.startsWith('@') ? handle : `@${handle}`,
      display_name: text(formData, 'displayName', 200),
      identity_kind: identity,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) {
    redirect(`${path}?error=${encodeURIComponent('Could not add the channel. It may already be listed.')}`);
  }

  await audit(me.user_id, 'social_channel', data.id, 'added', { platform, handle });
  refresh();
  redirect(`${path}?saved=channel`);
}
