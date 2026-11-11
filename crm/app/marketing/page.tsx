import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { CHANNELS, channelSpec, providerConfigured } from '@/lib/social';
import { addChannel, cancelPost, generateDraft, scheduleContent } from '@/lib/social-actions';

type ContentRow = {
  id: string;
  title: string | null;
  body: string;
  variants: Record<string, string> | null;
  link: string | null;
  status: string;
  created_at: string;
};

type PostRow = {
  id: string;
  status: string;
  scheduled_for: string;
  body: string;
  permalink: string | null;
  last_error: string | null;
  attempts: number;
  channel: { platform: string; display_name: string } | null;
};

// A joined channel comes back as an object or a one-item array depending on the
// relationship, so the label is read defensively rather than assumed.
function channelLabel(channel: unknown): string {
  const row = (Array.isArray(channel) ? channel[0] : channel) as { platform?: string } | null | undefined;
  if (!row?.platform) return 'unknown';
  return channelSpec(row.platform)?.label ?? row.platform;
}

// The next hour in Phoenix, as the value a datetime-local input expects. Phoenix is
// UTC-7 all year, which is why the offset is a constant.
function defaultSlot(): string {
  return new Date(Date.now() + 60 * 60 * 1000 - 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; drafted?: string; scheduled?: string; channel?: string }>;
}) {
  const { error, drafted, scheduled, channel } = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const isAdmin = me?.role === 'admin';
  const canWrite = me?.role === 'admin' || me?.role === 'introducer';

  const [{ data: channels }, { data: contents }, { data: posts }] = await Promise.all([
    supabase.from('social_channels').select('id, platform, display_name, status, token_expires_at, last_ok_at').order('platform'),
    supabase
      .from('social_contents')
      .select('id, title, body, variants, link, status, created_at')
      .in('status', ['draft', 'approved'])
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('social_posts')
      .select('id, status, scheduled_for, body, permalink, last_error, attempts, channel:social_channels(platform, display_name)')
      .order('scheduled_for', { ascending: false })
      .limit(30),
  ]);

  const channelRows = (channels ?? []) as {
    id: string;
    platform: string;
    display_name: string;
    status: string;
    token_expires_at: string | null;
    last_ok_at: string | null;
  }[];
  const draftRows = (contents ?? []) as unknown as ContentRow[];
  const postRows = (posts ?? []) as unknown as PostRow[];
  const due = defaultSlot();

  return (
    <main className="page">
      <header className="page-head">
        <h1>Marketing</h1>
        <p className="muted">
          Write once, schedule per channel, and read what actually went out. An agent drafts; a
          person schedules. Every numeric claim needs its source in the same post.
        </p>
      </header>

      {error ? <p className="notice blocked">{error}</p> : null}
      {drafted ? <p className="notice">Draft written. Check it below, then schedule it.</p> : null}
      {scheduled ? <p className="notice">Scheduled. The publisher picks it up within a few minutes.</p> : null}
      {channel ? <p className="notice">Channel connected.</p> : null}

      {!providerConfigured() ? (
        <p className="notice review">
          No publishing provider is configured. Drafts and schedules work, but nothing can be sent
          until <code>SOCIAL_API_URL</code> and <code>SOCIAL_API_KEY</code> are set on the server.
        </p>
      ) : null}

      <section className="panel">
        <h2>Channels</h2>
        {channelRows.length === 0 ? (
          <p className="muted">
            No channels yet. Connect the LinkedIn page first: it is the only network whose audience
            matches the companies this site sells to.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Platform</th><th>Account</th><th>Status</th><th>Token expires</th><th>Last success</th></tr>
            </thead>
            <tbody>
              {channelRows.map((c) => (
                <tr key={c.id}>
                  <td>{channelSpec(c.platform)?.label ?? c.platform}</td>
                  <td>{c.display_name}</td>
                  <td>
                    <span className={`status ${c.status === 'active' ? 'approved' : 'blocked'}`}>{c.status}</span>
                  </td>
                  <td>{c.token_expires_at ? new Date(c.token_expires_at).toLocaleDateString('en-US') : '-'}</td>
                  <td>{c.last_ok_at ? new Date(c.last_ok_at).toLocaleString('en-US') : 'never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {isAdmin ? (
          <form action={addChannel} className="inline-form">
            <select name="platform" defaultValue="linkedin">
              {CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <input name="displayName" placeholder="Account name" required maxLength={200} />
            <input name="externalId" placeholder="Provider profile id" required maxLength={200} />
            <input type="date" name="tokenExpiresAt" />
            <button className="btn" type="submit">Connect</button>
          </form>
        ) : null}
      </section>

      {canWrite ? (
        <section className="panel">
          <h2>Draft with an agent</h2>
          <p className="muted">
            The agent writes channel variants from a topic. It is told not to invent figures, not to
            name the buyer, and not to promise an outcome. Runs are capped on the Agents page.
          </p>
          <form action={generateDraft} className="stack">
            <label>What is the post about?
              <input name="topic" required maxLength={400} placeholder="Why a 40-person accounting firm's old ticket notes are worth money" />
            </label>
            <label>Link to include (optional)
              <input name="link" maxLength={1000} placeholder="https://dataleasers.com/what-you-can-sell.html" />
            </label>
            <button className="btn" type="submit">Write the draft</button>
          </form>
        </section>
      ) : null}

      <section>
        <h2>Ready to schedule</h2>
        {draftRows.length === 0 ? <p className="muted">No drafts waiting.</p> : null}
        {draftRows.map((d) => (
          <article key={d.id} className="panel">
            <header>
              <strong>{d.title ?? 'Untitled draft'}</strong>{' '}
              <span className="muted">{new Date(d.created_at).toLocaleString('en-US')}</span>
            </header>
            <pre className="wrap-cell">{d.body}</pre>
            {d.variants && Object.keys(d.variants).length > 0 ? (
              <p className="muted small">
                Variants: {Object.entries(d.variants).map(([key, value]) => `${channelSpec(key)?.label ?? key} (${value.length} chars)`).join(' · ')}
              </p>
            ) : (
              <p className="muted small">One version only. It will be used for every channel chosen.</p>
            )}
            {canWrite ? (
              <form action={scheduleContent.bind(null, d.id)} className="stack">
                <fieldset>
                  <legend>Channels</legend>
                  {CHANNELS.map((c) => (
                    <label key={c.key} className="check">
                      <input type="checkbox" name="channels" value={c.key} defaultChecked={Boolean(d.variants?.[c.key])} />
                      {' '}{c.label}
                    </label>
                  ))}
                </fieldset>
                <label>Send at (Phoenix time)
                  <input type="datetime-local" name="scheduledFor" defaultValue={due} required />
                </label>
                <button className="btn" type="submit">Schedule</button>
              </form>
            ) : null}
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Queue and history</h2>
        {postRows.length === 0 ? <p className="muted">Nothing scheduled or sent yet.</p> : (
          <table className="table">
            <thead>
              <tr><th>When (Phoenix)</th><th>Channel</th><th>Status</th><th>Post</th><th>Result</th><th></th></tr>
            </thead>
            <tbody>
              {postRows.map((p) => {
                const when = new Date(new Date(p.scheduled_for).getTime() - 7 * 60 * 60 * 1000);
                return (
                  <tr key={p.id}>
                    <td>{when.toISOString().slice(0, 16).replace('T', ' ')}</td>
                    <td>{channelLabel(p.channel)}</td>
                    <td><span className={`status ${p.status === 'published' ? 'approved' : p.status === 'failed' || p.status === 'needs_manual' ? 'blocked' : 'review'}`}>{p.status}</span></td>
                    <td className="wrap-cell">{p.body.slice(0, 140)}{p.body.length > 140 ? '…' : ''}</td>
                    <td className="wrap-cell">
                      {p.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer">Open post</a> : null}
                      {p.last_error ? <span className="muted small"> {p.last_error}</span> : null}
                      {!p.permalink && !p.last_error ? '-' : null}
                    </td>
                    <td>
                      {canWrite && (p.status === 'scheduled' || p.status === 'failed') ? (
                        <form action={cancelPost.bind(null, p.id)}>
                          <button className="btn" type="submit">Cancel</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
