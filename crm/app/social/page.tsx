import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import {
  cancelPost,
  deletePost,
  publishDueNow,
  reschedulePost,
  retryPost,
} from '@/lib/social-actions';
import { PLATFORM_LABELS, phoenixLabel, utcToPhoenixInput, type Platform } from '@/lib/social';

type ChannelLink = {
  status: string;
  error: string | null;
  remote_id: string | null;
  social_channels: { platform: string; handle: string } | null;
};

type QueueRow = {
  id: string;
  body: string;
  state: string;
  scheduled_for: string | null;
  published_at: string | null;
  social_post_channels: ChannelLink[] | null;
};

const SAVED: Record<string, string> = {
  scheduled: 'Post scheduled.',
  draft: 'Draft saved.',
  moved: 'Post moved.',
  updated: 'Changes saved.',
  cancelled: 'Post cancelled.',
  deleted: 'Draft deleted.',
  retried: 'Queued for another attempt.',
  ran: 'Publishing run finished. Results are below.',
};

const FIELDS =
  'id, body, state, scheduled_for, published_at, social_post_channels(status, error, remote_id, social_channels(platform, handle))';

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

// What each channel did, which is the only place a part-failure is visible: the post's own
// state says "partial", and this says which platform is the reason.
function Delivery({ row }: { row: QueueRow }) {
  const links = row.social_post_channels ?? [];
  if (links.length === 0) return <span className="muted">None</span>;
  return (
    <>
      {links.map((link, index) => {
        const platform = link.social_channels?.platform;
        const simulated = link.remote_id?.startsWith('stub:') ?? false;
        const pill =
          link.status === 'published'
            ? 'status approved'
            : link.status === 'failed'
              ? 'status blocked'
              : 'status review';
        return (
          <div key={`${row.id}-${index}`} className="delivery">
            <span className="badge">
              {platform ? (PLATFORM_LABELS[platform as Platform] ?? platform) : 'Unknown'}
            </span>
            <span className={pill}>{link.status}</span>
            {simulated ? <span className="muted small"> simulated</span> : null}
            {link.error ? <div className="issue error">{link.error}</div> : null}
          </div>
        );
      })}
    </>
  );
}

function stateClass(state: string): string {
  if (state === 'published') return 'status approved';
  if (state === 'partial') return 'status review';
  return 'status blocked';
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
  const isAdmin = me?.role === 'admin';

  const [{ data: scheduled, error: scheduledError }, { data: drafts }, { data: recent }] =
    await Promise.all([
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
      supabase
        .from('social_posts')
        .select(FIELDS)
        .in('state', ['published', 'partial', 'failed'])
        .order('updated_at', { ascending: false })
        .limit(20),
    ]);

  const upcoming = (scheduled ?? []) as unknown as QueueRow[];
  const draftList = (drafts ?? []) as unknown as QueueRow[];
  const delivered = (recent ?? []) as unknown as QueueRow[];

  return (
    <main className="page">
      <header className="page-head">
        <h1>Social</h1>
        <p className="muted">
          Everything waiting to go out, and what happened to what already has, in Phoenix time.
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
          Could not load the queue. Run <code>0009_social.sql</code> and{' '}
          <code>0010_social_publish.sql</code> in Supabase, then reload.
        </p>
      ) : null}

      {isAdmin ? (
        <form action={publishDueNow} className="form-row">
          <button className="btn" type="submit">
            Publish due posts now
          </button>
          <span className="muted small">
            Runs the same sweep as the cron job. Simulated deliveries are marked below.
          </span>
        </form>
      ) : null}

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
                    {canWrite ? <Link href={`/social/edit/${post.id}`}>Edit</Link> : null}
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
                    {canWrite ? <Link href={`/social/edit/${post.id}`}>Edit</Link> : null}
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

      <section className="panel">
        <h2>Recent</h2>
        {delivered.length === 0 ? (
          <p className="muted">Nothing has been sent yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>State</th>
                <th>Post</th>
                <th>Channels</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {delivered.map((post) => (
                <tr key={post.id}>
                  <td>
                    <span className={stateClass(post.state)}>{post.state}</span>
                    {post.published_at ? (
                      <span className="muted small">
                        <br />
                        {phoenixLabel(post.published_at)}
                      </span>
                    ) : null}
                  </td>
                  <td className="wrap-cell">{post.body.slice(0, 160)}</td>
                  <td>
                    <Delivery row={post} />
                  </td>
                  <td>
                    {canWrite && (post.state === 'failed' || post.state === 'partial') ? (
                      <form action={retryPost.bind(null, post.id)}>
                        <button className="link-button" type="submit">
                          Retry
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
