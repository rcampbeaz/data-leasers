import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { cancelPost, deletePost, reschedulePost } from '@/lib/social-actions';
import {
  PLATFORM_LABELS,
  phoenixLabel,
  utcToPhoenixInput,
  type Platform,
} from '@/lib/social';

type ChannelLink = {
  status: string;
  social_channels: { platform: string; handle: string } | null;
};

type QueueRow = {
  id: string;
  body: string;
  state: string;
  scheduled_for: string | null;
  social_post_channels: ChannelLink[] | null;
};

const SAVED: Record<string, string> = {
  scheduled: 'Post scheduled.',
  draft: 'Draft saved.',
  moved: 'Post moved.',
  cancelled: 'Post cancelled.',
  deleted: 'Draft deleted.',
};

const FIELDS =
  'id, body, state, scheduled_for, social_post_channels(status, social_channels(platform, handle))';

function Channels({ row }: { row: QueueRow }) {
  const channels = row.social_post_channels ?? [];
  if (channels.length === 0) return <span className="muted">None</span>;
  return (
    <>
      {channels.map((link, index) => {
        const platform = link.social_channels?.platform;
        return (
          <span className="badge" key={`${row.id}-${index}`}>
            {platform ? (PLATFORM_LABELS[platform as Platform] ?? platform) : 'Unknown'}
          </span>
        );
      })}
    </>
  );
}

function Move({ row }: { row: QueueRow }) {
  return (
    <form action={reschedulePost.bind(null, row.id)} className="inline-form">
      <input
        type="datetime-local"
        name="when"
        aria-label="Publish at, Phoenix time"
        defaultValue={row.scheduled_for ? utcToPhoenixInput(row.scheduled_for) : ''}
      />
      <button className="link-button" type="submit">
        {row.state === 'scheduled' ? 'Move' : 'Schedule'}
      </button>
    </form>
  );
}

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error: message, saved } = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const canWrite = me?.role === 'admin' || me?.role === 'introducer';

  const [{ data: scheduled, error: scheduledError }, { data: drafts }] = await Promise.all([
    supabase
      .from('social_posts')
      .select(FIELDS)
      .eq('state', 'scheduled')
      .order('scheduled_for', { ascending: true })
      .limit(100),
    supabase
      .from('social_posts')
      .select(FIELDS)
      .eq('state', 'draft')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const upcoming = (scheduled ?? []) as unknown as QueueRow[];
  const draftList = (drafts ?? []) as unknown as QueueRow[];

  return (
    <main className="page">
      <header className="page-head">
        <h1>Social</h1>
        <p className="muted">
          Everything waiting to go out, in Phoenix time. Writing a post takes one idea and adapts it
          per channel.
        </p>
      </header>

      <nav className="filters" aria-label="Social">
        <Link href="/social" className="active">
          Queue
        </Link>
        <Link href="/social/calendar">Calendar</Link>
        <Link href="/social/channels">Channels</Link>
        <Link href="/social/compose">New post</Link>
      </nav>

      {message ? <p className="notice blocked">{message}</p> : null}
      {saved ? <p className="notice">{SAVED[saved] ?? 'Saved.'}</p> : null}
      {scheduledError ? (
        <p className="notice blocked">
          Could not load the queue. Run <code>0009_social.sql</code> in Supabase, then reload.
        </p>
      ) : null}

      <p className="notice review">
        Publishing is not wired yet. Scheduling records the decision now; the publishing engine
        sends it in the next phase.
      </p>

      <section className="panel">
        <h2>Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="muted">Nothing scheduled.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Publishes</th>
                <th>Post</th>
                <th>Channels</th>
                <th>Move</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((post) => (
                <tr key={post.id}>
                  <td>{post.scheduled_for ? phoenixLabel(post.scheduled_for) : '-'}</td>
                  <td className="wrap-cell">{post.body.slice(0, 160)}</td>
                  <td>
                    <Channels row={post} />
                  </td>
                  <td>{canWrite ? <Move row={post} /> : null}</td>
                  <td>
                    {canWrite ? (
                      <form action={cancelPost.bind(null, post.id)}>
                        <button className="link-button" type="submit">
                          Cancel
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Drafts</h2>
        {draftList.length === 0 ? (
          <p className="muted">No drafts.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Channels</th>
                <th>Schedule</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draftList.map((post) => (
                <tr key={post.id}>
                  <td className="wrap-cell">{post.body.slice(0, 160)}</td>
                  <td>
                    <Channels row={post} />
                  </td>
                  <td>{canWrite ? <Move row={post} /> : null}</td>
                  <td>
                    {canWrite ? (
                      <form action={deletePost.bind(null, post.id)}>
                        <button className="link-button" type="submit">
                          Delete
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
