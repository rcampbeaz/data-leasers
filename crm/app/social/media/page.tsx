import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { removeAsset } from '@/lib/media-actions';
import { embeddedRows } from '@/lib/embed';
import { phoenixLabel } from '@/lib/social';

type UsedBy = { id: string; state: string; scheduled_for: string | null; body: string };

type Asset = {
  id: string;
  public_url: string;
  kind: string;
  mime_type: string;
  byte_size: number;
  alt_text: string;
  rights_note: string;
  created_at: string;
  // Typed for both shapes: whoever reads it goes through embeddedRows().
  social_posts: UsedBy[] | UsedBy | null;
};

const SAVED: Record<string, string> = {
  removed: 'Asset removed.',
  'removed-storage': 'Asset removed, but its file could not be deleted from storage.',
};

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error: message, saved } = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const canWrite = me?.role === 'admin' || me?.role === 'introducer';

  const { data, error } = await supabase
    .from('social_media')
    .select(
      'id, public_url, kind, mime_type, byte_size, alt_text, rights_note, created_at, social_posts(id, state, scheduled_for, body)',
    )
    .order('created_at', { ascending: false })
    .limit(200);

  const assets = (data ?? []) as unknown as Asset[];
  const unused = assets.filter(
    (asset) => embeddedRows<UsedBy>(asset.social_posts).length === 0,
  ).length;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Media</h1>
        <p className="muted">
          Every asset uploaded from the composer, with the rights note recorded at upload and the
          posts using it. This is the list to check when someone asks what we are licensed to
          publish.
        </p>
      </header>

      <nav className="filters" aria-label="Social">
        <Link href="/social">Queue</Link>
        <Link href="/social/calendar">Calendar</Link>
        <Link href="/social/channels">Channels</Link>
        <Link href="/social/media" className="active">
          Media
        </Link>
        <Link href="/social/compose">New post</Link>
      </nav>

      {message ? <p className="notice blocked">{message}</p> : null}
      {saved ? <p className="notice">{SAVED[saved] ?? 'Saved.'}</p> : null}
      {error ? (
        <p className="notice blocked">
          Could not load the media library. Run <code>0011_social_media.sql</code> and{' '}
          <code>0012_social_media_link.sql</code> in Supabase, then reload.
        </p>
      ) : null}

      {assets.length > 0 ? (
        <p className="muted small">
          {assets.length} asset{assets.length === 1 ? '' : 's'}
          {unused > 0 ? `, ${unused} not used by any post` : ''}. An asset can only be removed
          while no post uses it.
        </p>
      ) : null}

      {assets.length === 0 && !error ? (
        <p className="muted">Nothing uploaded yet.</p>
      ) : (
        <div className="asset-grid">
          {assets.map((asset) => {
            const posts = embeddedRows<UsedBy>(asset.social_posts);
            return (
              <section className="asset" key={asset.id}>
                {asset.kind === 'video' ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video className="asset-thumb" src={asset.public_url} controls muted playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="asset-thumb" src={asset.public_url} alt={asset.alt_text} />
                )}

                <p className="small">
                  <strong>{asset.alt_text}</strong>
                </p>
                <p className="small">
                  <span className="muted">Rights:</span> {asset.rights_note}
                </p>
                <p className="muted small">
                  {asset.kind} · {size(asset.byte_size)} · {phoenixLabel(asset.created_at, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>

                {posts.length === 0 ? (
                  <p className="muted small">Not used by any post.</p>
                ) : (
                  <ul className="list small">
                    {posts.map((post) => (
                      <li key={post.id}>
                        {post.state === 'draft' || post.state === 'scheduled' ? (
                          <Link href={`/social/edit/${post.id}`}>
                            {post.state === 'scheduled' && post.scheduled_for
                              ? phoenixLabel(post.scheduled_for)
                              : 'Draft'}
                          </Link>
                        ) : (
                          <span>
                            {post.state}
                            {post.scheduled_for ? ` · ${phoenixLabel(post.scheduled_for)}` : ''}
                          </span>
                        )}
                        {' — '}
                        {post.body.slice(0, 60)}
                      </li>
                    ))}
                  </ul>
                )}

                {canWrite && posts.length === 0 ? (
                  <form action={removeAsset.bind(null, asset.id)}>
                    <button className="link-button" type="submit">
                      Remove
                    </button>
                  </form>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
