import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { CHANNELS, channelSpec, providerConfigured } from '@/lib/social';
import {
  addChannel,
  attachImage,
  cancelPost,
  generateDraft,
  removeImage,
  scheduleContent,
  testAi,
  writePost,
} from '@/lib/social-actions';
import { approveContent, setMarketingControls } from '@/lib/marketing-controls';
import { mergeControls, type MarketingControls } from '@/lib/marketing-settings';
import { BarChart, DonutChart } from '@/components/charts';
import { SocialComposer } from '@/components/social-composer';

const DAY = 24 * 60 * 60 * 1000;

// Brand colours for the donut, in the same family the dashboard uses.
const PALETTE = ['var(--dl-teal)', '#F5C063', '#7C9CFF', '#6EE7A8', '#FF9C90', '#B7A6FF'];

// The page held a composer, a week view, three charts, a channel table, six switches and two queues,
// which is why it read as a wall. Tabs split it by what a person came to do.
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'compose', label: 'Compose' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'channels', label: 'Channels' },
  { key: 'settings', label: 'Settings' },
];

type ContentRow = {
  id: string;
  title: string | null;
  body: string;
  variants: Record<string, string> | null;
  link: string | null;
  media: string[] | null;
  status: string;
  created_at: string;
};

type PostRow = {
  id: string;
  status: string;
  scheduled_for: string;
  published_at: string | null;
  body: string;
  permalink: string | null;
  last_error: string | null;
  attempts: number;
  channel: { platform: string; display_name: string } | null;
};

// A joined channel comes back as an object or a one-item array depending on the
// relationship, so the label is read defensively rather than assumed.
function channelRow(channel: unknown): { platform: string; display_name: string } | null {
  const row = (Array.isArray(channel) ? channel[0] : channel) as
    | { platform?: string; display_name?: string }
    | null
    | undefined;
  if (!row?.platform) return null;
  return { platform: row.platform, display_name: row.display_name ?? row.platform };
}

function channelLabel(channel: unknown): string {
  const row = channelRow(channel);
  if (!row) return 'unknown';
  return channelSpec(row.platform)?.label ?? row.platform;
}

function platformColor(platform: string): string {
  const i = CHANNELS.findIndex((c) => c.key === platform);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

// The next hour in Phoenix, as the value a datetime-local input expects. Phoenix is
// UTC-7 all year, which is why the offset is a constant.
function defaultSlot(): string {
  return new Date(Date.now() + 60 * 60 * 1000 - 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    drafted?: string;
    scheduled?: string;
    channel?: string;
    saved?: string;
    wrote?: string;
    attached?: string;
    ai?: string;
    aiok?: string;
    tab?: string;
  }>;
}) {
  const { error, drafted, scheduled, channel, saved, wrote, attached, ai, aiok, tab } = await searchParams;
  // Compose first: it is the page people come back to, and the overview is one click away.
  const activeTab = TABS.some((t) => t.key === tab) ? String(tab) : 'compose';
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const isAdmin = me?.role === 'admin';
  const canWrite = me?.role === 'admin' || me?.role === 'introducer';

  const now = Date.now();
  const windowStart = new Date(now - 90 * DAY).toISOString();

  const [{ data: channels }, { data: contents }, { data: posts }, { data: setting }] =
    await Promise.all([
      supabase
        .from('social_channels')
        .select('id, platform, display_name, status, token_expires_at, last_ok_at')
        .order('platform'),
      supabase
        .from('social_contents')
        .select('id, title, body, variants, link, media, status, created_at')
        .in('status', ['draft', 'approved'])
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('social_posts')
        .select(
          'id, status, scheduled_for, published_at, body, permalink, last_error, attempts, channel:social_channels(platform, display_name)',
        )
        .gte('scheduled_for', windowStart)
        .order('scheduled_for', { ascending: false })
        .limit(500),
      supabase.from('app_settings').select('value').eq('key', 'marketing').maybeSingle(),
    ]);

  const controls: MarketingControls = mergeControls(setting?.value);

  // What the AI panel can say honestly: whether a provider is configured at all, and whether the
  // Agents page switch and cap actually allow a run right now.
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const [{ data: agentSetting }, { count: runsToday }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'agents').maybeSingle(),
    supabase
      .from('agent_runs')
      .select('id', { count: 'exact', head: true })
      .gte('started_at', startOfDayUtc.toISOString()),
  ]);
  const agents = (agentSetting?.value ?? { enabled: false, daily_cap: 0 }) as {
    enabled?: boolean;
    daily_cap?: number;
  };
  const aiConfigured = Boolean(process.env.OPENAI_API_KEY);

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

  // ---- figures -------------------------------------------------------------

  const scheduledNext7 = postRows.filter(
    (p) =>
      p.status === 'scheduled' &&
      new Date(p.scheduled_for).getTime() >= now &&
      new Date(p.scheduled_for).getTime() <= now + 7 * DAY,
  ).length;
  const published30 = postRows.filter(
    (p) => p.status === 'published' && new Date(p.published_at ?? p.scheduled_for).getTime() >= now - 30 * DAY,
  ).length;
  const needsAttention = postRows.filter((p) => p.status === 'failed' || p.status === 'needs_manual').length;
  const liveChannels = channelRows.filter((c) => c.status === 'active').length;
  const awaitingApproval = draftRows.filter((d) => d.status === 'draft').length;

  // Posts per day, last 14 days, oldest first.
  const days: { key: string; label: string }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    days.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    });
  }
  const perDay = new Map(days.map((d) => [d.key, 0]));
  for (const p of postRows) {
    if (p.status === 'cancelled') continue;
    const key = String(p.scheduled_for).slice(0, 10);
    if (perDay.has(key)) perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const perDaySeries = days.map((d) => ({ label: d.label, value: perDay.get(d.key) ?? 0 }));

  // Channel mix over the 90-day window.
  const mixCounts = new Map<string, number>();
  for (const p of postRows) {
    if (p.status === 'cancelled') continue;
    const row = channelRow(p.channel);
    const key = row?.platform ?? 'unknown';
    mixCounts.set(key, (mixCounts.get(key) ?? 0) + 1);
  }
  const mixSeries = Array.from(mixCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([platform, value]) => ({
      label: channelSpec(platform)?.label ?? platform,
      value,
      color: platformColor(platform),
    }));

  // Next seven days as columns, so a gap is visible at a glance instead of being a number in a table.
  // Grouped on the Phoenix date, which is the same clock the schedule form asks for.
  const phoenix = (iso: string, length: number) =>
    new Date(new Date(iso).getTime() - 7 * 60 * 60 * 1000).toISOString().slice(0, length);
  const upcoming = Array.from({ length: 7 }, (_, i) => {
    const key = phoenix(new Date(now + i * DAY).toISOString(), 10);
    const label =
      i === 0
        ? 'Today'
        : new Date(now + i * DAY).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          });
    return {
      key,
      label,
      today: i === 0,
      items: postRows
        .filter((p) => p.status !== 'cancelled' && phoenix(p.scheduled_for, 10) === key)
        .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)),
    };
  });

  const statusSeries = [
    { label: 'Scheduled', value: postRows.filter((p) => p.status === 'scheduled').length },
    { label: 'Published', value: postRows.filter((p) => p.status === 'published').length },
    { label: 'Failed', value: postRows.filter((p) => p.status === 'failed').length },
    { label: 'Needs manual', value: postRows.filter((p) => p.status === 'needs_manual').length },
  ];

  return (
    <main className="page">
      <header className="page-head">
        <h1>Marketing</h1>
        <p className="muted">
          Write once, schedule per channel, and read what actually went out. An agent drafts; a
          person schedules. Every numeric claim needs its source in the same post.
        </p>
      </header>

      <nav className="tabs" aria-label="Marketing sections">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={`/marketing?tab=${t.key}`}
            className={activeTab === t.key ? 'active' : undefined}
            aria-current={activeTab === t.key ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>

      {error ? <p className="notice blocked">{error}</p> : null}
      {saved ? <p className="notice">Switches saved. They apply to the next run.</p> : null}
      {drafted ? <p className="notice">Draft written. Check it below, then schedule it.</p> : null}
      {wrote ? <p className="notice">Post saved as a draft. Approve or schedule it below.</p> : null}
      {attached === '1' ? <p className="notice">Image attached to the draft.</p> : null}
      {ai && aiok === '1' ? <p className="notice">{ai}</p> : null}
      {attached === '0' ? <p className="notice">Image removed.</p> : null}
      {scheduled ? <p className="notice">Scheduled. The publisher picks it up within a few minutes.</p> : null}
      {channel ? <p className="notice">Channel connected.</p> : null}

      {!providerConfigured() ? (
        <p className="notice review">
          No publishing provider is configured. Drafts and schedules work, but nothing can be sent
          until <code>SOCIAL_API_URL</code> and <code>SOCIAL_API_KEY</code> are set on the server.
        </p>
      ) : null}
      {!controls.publishing_enabled ? (
        <p className="notice review">
          Publishing is switched off. Scheduled posts stay queued and nothing is sent until it is
          switched back on.
        </p>
      ) : null}

      {activeTab === 'overview' ? (
        <>
      <section className="kpis" aria-label="Marketing figures">
        <div className="kpi"><span>Drafts waiting</span><strong>{draftRows.length}</strong></div>
        <div className="kpi"><span>Awaiting approval</span><strong className={awaitingApproval ? 'overdue' : ''}>{awaitingApproval}</strong></div>
        <div className="kpi"><span>Scheduled, next 7 days</span><strong>{scheduledNext7}</strong></div>
        <div className="kpi"><span>Published, 30 days</span><strong>{published30}</strong></div>
        <div className="kpi"><span>Failed or manual</span><strong className={needsAttention ? 'overdue' : ''}>{needsAttention}</strong></div>
        <div className="kpi"><span>Channels live</span><strong>{liveChannels}</strong></div>
      </section>

      <section className="panel">
        <h2>Next seven days</h2>
        <div className="timeline">
          {upcoming.map((day) => (
            <div key={day.key} className={`timeline-day${day.today ? ' today' : ''}`}>
              <h3>{day.label}</h3>
              {day.items.length === 0 ? (
                <p className="slot-empty">Open</p>
              ) : (
                day.items.map((p) => (
                  <div key={p.id} className={`slot ${p.status}`}>
                    <time>
                      {phoenix(p.scheduled_for, 16).slice(11)} ·{' '}
                      {channelRow(p.channel)?.display_name ?? channelLabel(p.channel)}
                    </time>
                    <p>{p.body}</p>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
        <p className="muted small">
          Phoenix time. An empty column is a gap worth filling, not a fault; anything scheduled here is
          picked up by the publisher within a few minutes of its time.
        </p>
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>Posts per day, last 14 days</h2>
          {postRows.length === 0 ? (
            <p className="muted">Nothing scheduled yet, so there is nothing to chart.</p>
          ) : (
            <BarChart
              data={perDaySeries}
              ariaLabel="Bar chart of scheduled or published posts per day for the last 14 days"
            />
          )}
        </section>
        <section className="panel">
          <h2>Channel mix, 90 days</h2>
          {mixSeries.length === 0 ? (
            <p className="muted">No posts in the last 90 days.</p>
          ) : (
            <DonutChart data={mixSeries} ariaLabel="Donut chart of posts per social channel over the last 90 days" />
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Queue health, 90 days</h2>
        <BarChart
          data={statusSeries}
          ariaLabel="Bar chart of posts by status: scheduled, published, failed and needs manual"
        />
        {needsAttention > 0 ? (
          <p className="muted small">
            Failed posts retry on their own a few times; anything marked <strong>needs manual</strong>{' '}
            needs a person, usually because the provider rejected the account or the token expired.
          </p>
        ) : null}
      </section>
        </>
      ) : null}

      {activeTab === 'settings' ? (
      <section className="panel">
        <h2>Switches</h2>
        <p className="muted">
          These are real gates, not labels. Publishing off stops the sender even with a full queue;
          drafting off stops the agent spending anything; approval on means a draft cannot be
          scheduled until a person approves it.
        </p>
        {isAdmin ? (
          <form action={setMarketingControls} className="stack">
            <div className="switches">
              <label className="switch">
                <input type="checkbox" name="publishingEnabled" defaultChecked={controls.publishing_enabled} />
                <span className="track" aria-hidden="true" />
                <span className="switch-text">
                  <strong>Publishing</strong>
                  <span>Send scheduled posts. Off holds the queue without losing it.</span>
                </span>
              </label>
              <label className="switch">
                <input type="checkbox" name="draftingEnabled" defaultChecked={controls.drafting_enabled} />
                <span className="track" aria-hidden="true" />
                <span className="switch-text">
                  <strong>Agent drafting</strong>
                  <span>Let an agent write drafts. Still bounded by the daily cap on the Agents page.</span>
                </span>
              </label>
              <label className="switch">
                <input type="checkbox" name="requireApproval" defaultChecked={controls.require_approval} />
                <span className="track" aria-hidden="true" />
                <span className="switch-text">
                  <strong>Approval required</strong>
                  <span>A draft has to be approved before it can be scheduled.</span>
                </span>
              </label>
            </div>
            <button className="btn" type="submit">Save switches</button>
          </form>
        ) : (
          <ul className="list">
            <li>Publishing: <strong>{controls.publishing_enabled ? 'on' : 'off'}</strong></li>
            <li>Agent drafting: <strong>{controls.drafting_enabled ? 'on' : 'off'}</strong></li>
            <li>Approval required: <strong>{controls.require_approval ? 'yes' : 'no'}</strong></li>
          </ul>
        )}
      </section>
      ) : null}

      {activeTab === 'channels' ? (
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
      ) : null}

      {activeTab === 'compose' && canWrite ? (
        <section className="panel">
          <h2>Write a post</h2>
          <p className="muted small">
            No model needed. Pick the channels to see how the post lands and how much room is left in
            each, and attach an image here if you want one; the length and claim rules are enforced
            again when you schedule.
          </p>
          <SocialComposer
            action={writePost}
            connected={channelRows.filter((c) => c.status === 'active').map((c) => c.platform)}
          />
        </section>
      ) : null}

      {activeTab === 'compose' && canWrite ? (
        <section className="panel">
          <h2>Draft with an agent</h2>
          {!aiConfigured ? (
            <p className="notice blocked">
              AI writing is not configured on this server: there is no <code>OPENAI_API_KEY</code>. A
              free OpenAI-compatible provider works instead: set <code>OPENAI_BASE_URL</code> and{' '}
              <code>OPENAI_MODEL</code> to it. Redeploy after setting either.
            </p>
          ) : agents.enabled !== true ? (
            <p className="notice review">
              AI writing is switched off. Turn agents on in <a href="/agents">Agents</a>; the drafting
              switch in this console also has to stay on.
            </p>
          ) : (
            <p className="muted small">
              AI configured. {runsToday ?? 0} of {agents.daily_cap ?? 0} runs used today.
            </p>
          )}
          <p className="muted">
            The agent writes channel variants from a topic. It is told not to invent figures, not to
            name the buyer, and not to promise an outcome. Runs are capped on the Agents page.
          </p>
          <form action={testAi}>
            <button className="btn" type="submit">Test the AI connection</button>
          </form>
          <p className="muted small">
            Makes one call of a few tokens and reports what came back: the key being rejected, the
            model not existing and the address being wrong each read differently. It works while
            agents are switched off, and does not count against the daily cap.
          </p>
          <form action={generateDraft} className="stack">
            <label>What is the post about?
              <input name="topic" required maxLength={400} placeholder="Why a 40-person accounting firm's old ticket notes are worth money" />
            </label>
            <label>Link to include (optional)
              <input name="link" maxLength={1000} placeholder="https://dataleasers.com/what-you-can-sell.html" />
            </label>
            <button className="btn" type="submit" disabled={!aiConfigured || agents.enabled !== true}>
              Write the draft
            </button>
          </form>
        </section>
      ) : null}

      {activeTab === 'schedule' ? (
        <>
      <section>
        <h2>Ready to schedule</h2>
        {draftRows.length === 0 ? <p className="muted">No drafts waiting.</p> : null}
        {draftRows.map((d) => (
          <article key={d.id} className="panel">
            <header>
              <strong>{d.title ?? 'Untitled draft'}</strong>{' '}
              <span className={`status ${d.status === 'approved' ? 'approved' : 'review'}`}>{d.status}</span>{' '}
              <span className="muted">{new Date(d.created_at).toLocaleString('en-US')}</span>
            </header>
            <pre className="wrap-cell">{d.body}</pre>
            {d.media && d.media.length > 0 ? (
              <p>
                <img
                  src={d.media[0]}
                  alt="Image attached to this post"
                  style={{ maxWidth: 200, borderRadius: 8 }}
                />
              </p>
            ) : (
              <p className="muted small">No image attached. Instagram and TikTok cannot post without one.</p>
            )}
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
            {canWrite ? (
              <form action={attachImage.bind(null, d.id)} className="inline-form">
                <input type="file" name="image" accept="image/png,image/jpeg,image/webp" required />
                <button className="btn" type="submit">Attach image</button>
              </form>
            ) : null}
            {canWrite && d.media && d.media.length > 0 ? (
              <form action={removeImage.bind(null, d.id)}>
                <button className="btn danger" type="submit">Remove image</button>
              </form>
            ) : null}
            {canWrite && controls.require_approval && d.status === 'draft' ? (
              <form action={approveContent.bind(null, d.id)} className="inline-form">
                <span className="muted small">Approval is required before this can be scheduled.</span>
                <button className="btn" type="submit">Approve</button>
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
              {postRows.slice(0, 40).map((p) => {
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
                          <button className="btn danger" type="submit">Cancel</button>
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
        </>
      ) : null}
    </main>
  );
}
