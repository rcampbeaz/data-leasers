'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createIntakeClient, createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { publishDue } from '@/lib/social-publish';
import {
  PLATFORMS,
  charCount,
  phoenixToUtc,
  postErrors,
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

type CheckedDraft = {
  body: string;
  linkUrl: string | null;
  mediaUrl: string | null;
  mediaAlt: string | null;
  scheduledFor: string | null;
  // The override only, or null to mean "use the post body".
  channels: { channelId: string; body: string | null }[];
};

// Everything a post must satisfy before it is stored or scheduled, in one place.
// createPost and updatePost both call this, which is what stops the two paths from
// drifting apart the way the queue and the composer did.
async function checkDraft(
  supabase: Awaited<ReturnType<typeof createStaffClient>>,
  draft: PostDraft,
): Promise<{ error: string } | CheckedDraft> {
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

  const forChecks: { platform: Platform; body: string | null }[] = [];
  for (const channel of wanted) {
    const platform = platformById.get(channel.channelId);
    if (!platform) {
      return {
        error: 'One of the chosen channels is no longer active. Reload the page and it will be unticked.',
      };
    }
    forChecks.push({ platform, body: channel.body });
  }

  // The server repeats every check the composer made. A browser can be told to skip
  // them; this cannot.
  const errors = postErrors({
    body,
    linkUrl: draft.linkUrl,
    mediaUrl: draft.mediaUrl,
    channels: forChecks,
  });
  if (errors.length > 0) return { error: errors[0] };

  const scheduledFor = draft.scheduledFor ? phoenixToUtc(draft.scheduledFor) : null;
  if (draft.scheduledFor && !scheduledFor) {
    return { error: 'That is not a date and time I can read.' };
  }
  if (scheduledFor && Date.parse(scheduledFor) < Date.now() - 60_000) {
    return { error: 'That time has already passed. Choose a later time, or save it as a draft.' };
  }

  // An override is only stored when it actually differs, so a later edit to the
  // master copy still reaches every channel that was left alone.
  return {
    body,
    linkUrl: draft.linkUrl?.trim() || null,
    mediaUrl: draft.mediaUrl?.trim() || null,
    mediaAlt: draft.mediaAlt?.trim() || null,
    scheduledFor,
    channels: wanted.map((channel) => {
      const override = channel.body?.trim();
      return {
        channelId: channel.channelId,
        body: override && override !== body ? override : null,
      };
    }),
  };
}

// Called from the composer in the browser, so a validation failure comes back as a
// message beside the form instead of a redirect that would throw the draft away.
export async function createPost(draft: PostDraft): Promise<CreatePostResult> {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) {
    return { error: 'Your role does not allow posting.' };
  }

  const checked = await checkDraft(supabase, draft);
  if ('error' in checked) return checked;
  const { body, linkUrl, mediaUrl, mediaAlt, scheduledFor, channels } = checked;

  const { data: post, error: insertError } = await supabase
    .from('social_posts')
    .insert({
      body,
      link_url: linkUrl,
      media_url: mediaUrl,
      media_alt: mediaAlt,
      state: scheduledFor ? 'scheduled' : 'draft',
      scheduled_for: scheduledFor,
      created_by: me.user_id,
    })
    .select('id')
    .single();
  if (insertError || !post) return { error: 'Could not save the post.' };

  const rows = channels.map((channel) => ({
    post_id: post.id,
    channel_id: channel.channelId,
    body: channel.body,
    status: scheduledFor ? 'scheduled' : 'pending',
  }));

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

  // A time is not the only thing scheduling needs. This path used to write the time
  // alone, so a draft the composer would have refused — an Instagram post with no
  // image, say — could be given a publish slot and fail there instead. The post and
  // its channels are read back and put through the same checks the composer uses.
  const { data: post, error: readError } = await supabase
    .from('social_posts')
    .select('id, body, link_url, media_url, social_post_channels(body, social_channels(platform, active))')
    .eq('id', postId)
    .in('state', ['draft', 'scheduled'])
    .maybeSingle();
  if (readError) redirect(`${path}?error=${encodeURIComponent('Could not read the post.')}`);
  if (!post) {
    redirect(`${path}?error=${encodeURIComponent('That post is no longer waiting to go out.')}`);
  }

  const stored = post as unknown as {
    body: string;
    link_url: string | null;
    media_url: string | null;
    social_post_channels:
      | { body: string | null; social_channels: { platform: string; active: boolean } | null }[]
      | null;
  };

  const links = stored.social_post_channels ?? [];
  if (links.length === 0) {
    redirect(
      `${path}?error=${encodeURIComponent('That post has no channels, so there is nothing to publish.')}`,
    );
  }

  const channels: { platform: Platform; body: string | null }[] = [];
  for (const link of links) {
    const platform = link.social_channels?.platform as Platform | undefined;
    if (!platform || !link.social_channels?.active) {
      redirect(
        `${path}?error=${encodeURIComponent('That post targets a channel that is no longer active.')}`,
      );
    }
    channels.push({ platform, body: link.body });
  }

  const problems = postErrors({
    body: stored.body,
    linkUrl: stored.link_url,
    mediaUrl: stored.media_url,
    channels,
  });
  if (problems.length > 0) {
    redirect(`${path}?error=${encodeURIComponent(`Cannot schedule. ${problems[0]}`)}`);
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

// Editing a post that has not gone out yet. It runs the same checks as creating one,
// and replaces the channel set rather than merging it, so unticking a channel really
// does take the post off that channel.
export async function updatePost(postId: string, draft: PostDraft): Promise<CreatePostResult> {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) {
    return { error: 'Your role does not allow editing a post.' };
  }

  const { data: existing, error: readError } = await supabase
    .from('social_posts')
    .select('id, state')
    .eq('id', postId)
    .maybeSingle();
  if (readError) {
    return { error: 'Could not read the post. Check that 0009_social.sql has been run.' };
  }
  if (!existing) return { error: 'That post no longer exists.' };
  const state = (existing as { state: string }).state;
  if (state !== 'draft' && state !== 'scheduled') {
    return { error: `A ${state} post cannot be edited. Write a new one instead.` };
  }

  const checked = await checkDraft(supabase, draft);
  if ('error' in checked) return checked;

  const { error: updateError } = await supabase
    .from('social_posts')
    .update({
      body: checked.body,
      link_url: checked.linkUrl,
      media_url: checked.mediaUrl,
      media_alt: checked.mediaAlt,
      state: checked.scheduledFor ? 'scheduled' : 'draft',
      scheduled_for: checked.scheduledFor,
      updated_at: new Date().toISOString(),
    })
    .eq('id', postId)
    .in('state', ['draft', 'scheduled']);
  if (updateError) return { error: 'Could not save the changes.' };

  const rows = checked.channels.map((channel) => ({
    post_id: postId,
    channel_id: channel.channelId,
    body: channel.body,
    status: checked.scheduledFor ? 'scheduled' : 'pending',
  }));

  const { error: upsertError } = await supabase
    .from('social_post_channels')
    .upsert(rows, { onConflict: 'post_id,channel_id' });
  if (upsertError) return { error: 'Could not save the channels for this post.' };

  // An upsert adds and updates but never removes, so a channel that was unticked has
  // to be deleted explicitly or the post stays queued for it.
  const { data: current, error: listError } = await supabase
    .from('social_post_channels')
    .select('id, channel_id')
    .eq('post_id', postId);
  if (!listError) {
    const keep = new Set(rows.map((row) => row.channel_id));
    const drop = ((current ?? []) as { id: string; channel_id: string }[])
      .filter((row) => !keep.has(row.channel_id))
      .map((row) => row.id);
    if (drop.length > 0) {
      await supabase.from('social_post_channels').delete().in('id', drop);
    }
  }

  await audit(me.user_id, 'social_post', postId, 'edited', {
    state: checked.scheduledFor ? 'scheduled' : 'draft',
    channels: rows.length,
  });

  refresh();
  redirect('/social?saved=updated');
}

// Runs the same sweep the cron does, so a post can be tested without waiting for the
// schedule or hand-running curl on the server.
export async function publishDueNow() {
  const path = '/social';
  const { me } = await requireWriter(path);
  if (me.role !== 'admin') {
    redirect(`${path}?error=${encodeURIComponent('Only an admin can run the publisher.')}`);
  }

  try {
    await publishDue();
  } catch (error) {
    redirect(
      `${path}?error=${encodeURIComponent(error instanceof Error ? error.message : 'The run failed.')}`,
    );
  }

  refresh();
  redirect(`${path}?saved=ran`);
}

// A post whose result could not be recorded sits in 'publishing', where no other part of
// the queue looks for it. Releasing it puts it back in the sweep without waiting for the
// stale timer. Channels that already published keep that status and are skipped.
export async function releasePost(postId: string) {
  const path = '/social';
  const { supabase, me } = await requireWriter(path);
  if (me.role !== 'admin') {
    redirect(`${path}?error=${encodeURIComponent('Only an admin can release a held post.')}`);
  }

  const { data: post, error: readError } = await supabase
    .from('social_posts')
    .select('id, state, updated_at')
    .eq('id', postId)
    .maybeSingle();
  if (readError) redirect(`${path}?error=${encodeURIComponent('Could not read the post.')}`);
  if (!post) redirect(`${path}?error=${encodeURIComponent('That post no longer exists.')}`);

  const held = post as { state: string; updated_at: string | null };
  if (held.state !== 'publishing') {
    redirect(`${path}?error=${encodeURIComponent('That post is not being held by a run.')}`);
  }

  // A live run refreshes this timestamp before every send, so a recent one means the post
  // may still be in flight. Releasing it then could send the same channel twice, which is
  // worse than waiting for the sweep to do it.
  if (held.updated_at && Date.parse(held.updated_at) > Date.now() - 2 * 60_000) {
    redirect(
      `${path}?error=${encodeURIComponent('That post is still being worked on. It releases itself if the run has died.')}`,
    );
  }

  const nowIso = new Date().toISOString();

  // A channel waiting on a retry clock further out would be skipped by the next sweep, so
  // releasing also brings its attempt forward.
  const { error: linkError } = await supabase
    .from('social_post_channels')
    .update({ next_attempt_at: nowIso })
    .eq('post_id', postId)
    .in('status', ['scheduled', 'pending']);
  if (linkError) redirect(`${path}?error=${encodeURIComponent('Could not release the post.')}`);

  const { error } = await supabase
    .from('social_posts')
    .update({ state: 'scheduled', updated_at: nowIso })
    .eq('id', postId)
    .eq('state', 'publishing');
  if (error) redirect(`${path}?error=${encodeURIComponent('Could not release the post.')}`);

  await audit(me.user_id, 'social_post', postId, 'released', {});
  refresh();
  redirect(`${path}?saved=released`);
}

// A post that ended up failed or partial is not a dead end: the channels that failed go
// back in the queue with a clean attempt count, and the next sweep sends them again.
// Channels that already published are left alone, so nothing is posted twice.
export async function retryPost(postId: string) {
  const path = '/social';
  const { supabase, me } = await requireWriter(path);

  const { data: post, error: readError } = await supabase
    .from('social_posts')
    .select('id, state')
    .eq('id', postId)
    .maybeSingle();
  if (readError) redirect(`${path}?error=${encodeURIComponent('Could not read the post.')}`);
  if (!post) redirect(`${path}?error=${encodeURIComponent('That post no longer exists.')}`);

  const state = (post as { state: string }).state;
  if (state !== 'failed' && state !== 'partial') {
    redirect(`${path}?error=${encodeURIComponent('Only a post that failed or went out partly can be retried.')}`);
  }

  const nowIso = new Date().toISOString();
  const { error: linkError } = await supabase
    .from('social_post_channels')
    .update({ status: 'scheduled', error: null, attempts: 0, next_attempt_at: nowIso })
    .eq('post_id', postId)
    .eq('status', 'failed');
  if (linkError) redirect(`${path}?error=${encodeURIComponent('Could not queue the retry.')}`);

  // scheduled_for is not touched: the post was meant to go out at that time, and a retry
  // does not change the intent. The channels above carry the retry clock instead.
  const { error: postError } = await supabase
    .from('social_posts')
    .update({
      state: 'scheduled',
      failure_notified_at: null,
      updated_at: nowIso,
    })
    .eq('id', postId);
  if (postError) redirect(`${path}?error=${encodeURIComponent('Could not queue the retry.')}`);

  await audit(me.user_id, 'social_post', postId, 'retried', {});
  refresh();
  redirect(`${path}?saved=retried`);
}
