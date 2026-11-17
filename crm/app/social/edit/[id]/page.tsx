import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { PLATFORM_LABELS, utcToPhoenixInput, type Platform } from '@/lib/social';
import Composer, { type ChannelOption, type ComposerPost } from '../../compose/composer';

type StoredPost = {
  id: string;
  body: string;
  link_url: string | null;
  media_url: string | null;
  media_alt: string | null;
  state: string;
  scheduled_for: string | null;
  social_post_channels: { channel_id: string; body: string | null }[] | null;
};

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const canPost = me?.role === 'admin' || me?.role === 'introducer';

  const { data, error } = await supabase
    .from('social_posts')
    .select(
      'id, body, link_url, media_url, media_alt, state, scheduled_for, social_post_channels(channel_id, body)',
    )
    .eq('id', id)
    .maybeSingle();

  // A malformed id comes back as a database error, which is the same thing to the
  // person who followed the link: there is no such post.
  if (!error && !data) notFound();
  if (error) notFound();

  const stored = data as unknown as StoredPost;

  const { data: channelRows, error: channelError } = await supabase
    .from('social_channels')
    .select('id, platform, handle, display_name, status')
    .eq('active', true)
    .order('platform');

  const channels = (channelRows ?? []) as ChannelOption[];
  const offered = new Set(channels.map((channel) => channel.id));
  const storedLinks = stored.social_post_channels ?? [];

  // A post keeps its channel rows when a channel is switched off. Anything inactive is
  // left out of the selection below: it would otherwise be a ticked box with no visible
  // checkbox, so every save would fail on a channel that cannot be unticked.
  let dropped: { platform: string; handle: string }[] = [];
  if (storedLinks.length > 0) {
    const { data: referenced } = await supabase
      .from('social_channels')
      .select('id, platform, handle, active')
      .in('id', storedLinks.map((link) => link.channel_id));
    dropped = (
      (referenced ?? []) as { id: string; platform: string; handle: string; active: boolean }[]
    )
      .filter((channel) => !channel.active)
      .map((channel) => ({ platform: channel.platform, handle: channel.handle }));
  }

  const initial: ComposerPost = {
    id: stored.id,
    body: stored.body,
    linkUrl: stored.link_url,
    mediaUrl: stored.media_url,
    mediaAlt: stored.media_alt,
    scheduledFor: stored.scheduled_for ? utcToPhoenixInput(stored.scheduled_for) : null,
    channels: storedLinks
      .filter((link) => offered.has(link.channel_id))
      .map((link) => ({ channelId: link.channel_id, body: link.body })),
  };

  // Editing is for what has not gone out yet. A cancelled or published post is a
  // record of a decision, so it is rewritten by writing a new post, not edited.
  const editable = stored.state === 'draft' || stored.state === 'scheduled';

  return (
    <main className="page">
      <header className="page-head">
        <h1>Edit post</h1>
        <p className="muted">
          {stored.state === 'scheduled' && stored.scheduled_for
            ? 'Scheduled. Changing the time, the text or the media re-runs every check before it saves.'
            : 'A draft. It runs the same checks as a new post when you save it.'}
        </p>
      </header>

      <nav className="filters" aria-label="Social">
        <Link href="/social">Queue</Link>
        <Link href="/social/calendar">Calendar</Link>
        <Link href="/social/channels">Channels</Link>
        <Link href="/social/compose">New post</Link>
      </nav>

      {dropped.length > 0 ? (
        <p className="notice review">
          {`This post is also queued for ${dropped
            .map(
              (channel) =>
                `${PLATFORM_LABELS[channel.platform as Platform] ?? channel.platform} ${channel.handle}`,
            )
            .join(', ')}, which ${dropped.length === 1 ? 'is' : 'are'} no longer active. ${
            dropped.length === 1 ? 'It is' : 'They are'
          } not in the channel list, so saving will remove ${
            dropped.length === 1 ? 'it' : 'them'
          } from this post.`}
        </p>
      ) : null}

      {!canPost ? (
        <p className="notice blocked">Your role can see the queue but not write to it.</p>
      ) : !editable ? (
        <p className="notice blocked">
          Only a draft or a scheduled post can be edited. This one is {stored.state}.
        </p>
      ) : channelError ? (
        <p className="notice blocked">
          Could not load the channels. Run <code>0009_social.sql</code> in Supabase, then reload.
        </p>
      ) : channels.length === 0 ? (
        <p className="notice review">
          No channels are listed, so there is nothing to post to.{' '}
          <Link href="/social/channels">Add a channel</Link> first.
        </p>
      ) : (
        <Composer channels={channels} post={initial} />
      )}
    </main>
  );
}
