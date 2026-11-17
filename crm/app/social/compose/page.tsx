import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff, loadMediaLibrary } from '@/lib/data';
import Composer, { type ChannelOption } from './composer';

export default async function ComposePage() {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const canPost = me?.role === 'admin' || me?.role === 'introducer';

  const { data, error } = await supabase
    .from('social_channels')
    .select('id, platform, handle, display_name, status')
    .eq('active', true)
    .order('platform');

  const channels = (data ?? []) as ChannelOption[];
  const library = await loadMediaLibrary(supabase);

  return (
    <main className="page">
      <header className="page-head">
        <h1>New post</h1>
        <p className="muted">
          Written once, checked against each channel&rsquo;s limits, then stored as a draft or a
          scheduled post.
        </p>
      </header>

      <nav className="filters" aria-label="Social">
        <Link href="/social">Queue</Link>
        <Link href="/social/calendar">Calendar</Link>
        <Link href="/social/channels">Channels</Link>
        <Link href="/social/media">Media</Link>
        <Link href="/social/compose" className="active">
          New post
        </Link>
      </nav>

      {!canPost ? (
        <p className="notice blocked">Your role can see the queue but not write to it.</p>
      ) : error ? (
        <p className="notice blocked">
          Could not load the channels. Run <code>0009_social.sql</code> in Supabase, then reload.
        </p>
      ) : channels.length === 0 ? (
        <p className="notice review">
          No channels yet. <Link href="/social/channels">Add the four accounts</Link> first, then come
          back.
        </p>
      ) : (
        <Composer channels={channels} library={library} />
      )}
    </main>
  );
}
