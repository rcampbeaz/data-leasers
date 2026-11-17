import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import {
  CHANNELS,
  SWEEP_AFTER_MINUTES,
  SWEEP_STATE_KEY,
  channelSpec,
  providerConfigured,
  retryAdvice,
  retryRoute,
} from '@/lib/social';
import { phoenix, phoenixClock, phoenixDay, phoenixInput, phoenixStamp } from '@/lib/time';
import {
  addChannel,
  attachImage,
  cancelPost,
  generateDraft,
  retryPost,
  reactivateChannel,
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
const PALETTE = ['var(--dl-electric)', '#F5C063', '#7C9CFF', '#6EE7A8', '#FF9C90', '#B7A6FF'];

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
  channel: { platform: string; display_name: string; status: string } | null;
};

// A joined channel comes back as an object or a one-item array depending on the
// relationship, so the label is read defensively rather than assumed.
function channelRow(
  channel: unknown,
): { platform: string; display_name: string; status: string } | null {
  const row = (Array.isArray(channel) ? channel[0] : channel) as
    | { platform?: string; display_name?: string; status?: string }
    | null
    | undefined;
  if (!row?.platform) return null;
  return {
    platform: row.platform,
    display_name: row.display_name ?? row.platform,
    // Read for retryRoute, not for display: whether Retry is offered depends on it.
    status: row.status ?? 'missing',
  };
}

function channelLabel(channel: unknown): string {
  const row = channelRow(channel);
  if (!row) return 'unknown';
  return channelSpec(row.platform)?.label ?? row.platform;
}

// A post in 'publishing' is a claim nobody has resolved yet, and most of them are a send that is
// simply happening: the claim is taken, the provider is called, the row is updated, all in seconds.
// Only the age of the hold separates that from a run that died, so the age decides the wording.
// A couple of minutes is well past any normal send and still short enough that nobody sits on a dead
// one wondering.
//
// Such a row has no button of its own — Retry and Cancel both refuse a send that may be in flight — so
// this note is the only thing telling the reader what happens next; the threshold it quotes is the
// sweep's own, from SWEEP_AFTER_MINUTES, rather than a second copy of the number.
const STUCK_AFTER_MINUTES = 2;

// The only two things a sweep problem can mean, and they differ in what is true rather than in tone: a
// failing sweep means a held post will not clear itself, while a database behind the code means the
// sweep is still stopping them and only this notice is stuck. "Since" is when the current message
// started — the record is not rewritten on quiet ticks, so it is not the last time it was seen.
function sweepNotice(failure: { error: string; at: string | null; degraded: boolean }): {
  tone: string;
  text: string;
  since: string;
} {
  const since = failure.at
    ? ` ${failure.degraded ? 'Seen since' : 'Failing since'} ${phoenix(failure.at, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })} (Phoenix)`
    : '';
  if (failure.degraded) {
    return {
      tone: 'notice review',
      text: 'The database is behind this code. The sweep is running and still stops posts whose publishing run died, but the migration that lets it clear this notice has not been applied. Run 0020_sweep_clears_its_own_warning.sql; this notice goes away on the next publishing run.',
      since,
    };
  }
  return {
    tone: 'notice blocked',
    text: 'The sweep that stops posts whose publishing run died is failing, so a held post stays held until somebody looks at it — it will not clear itself. Publishing itself is unaffected.',
    since,
  };
}

// sweepBroken changes the second half of every wording: the age is still true, but the promise that a
// run will come along and stop it is not, so the row points at the warning instead of naming a step
// that is not coming.
function publishHold(claimedAt: unknown, sweepBroken: boolean): string {
  const at = typeof claimedAt === 'string' ? Date.parse(claimedAt) : Number.NaN;
  const sendingNow = sweepBroken
    ? 'Sending now. If the run dies here, nothing stops it: the sweep is failing — see the warning above.'
    : 'Sending now. A run that dies here is stopped by the sweep and the admins are emailed.';
  if (!Number.isFinite(at)) return sendingNow;

  const minutes = Math.max(0, (Date.now() - at) / 60_000);
  if (minutes < STUCK_AFTER_MINUTES) return sendingNow;

  const age =
    minutes < 120 ? `${Math.round(minutes)} minutes` : `${Math.round(minutes / 60)} hours`;

  if (sweepBroken) {
    return `Held by a publishing run for ${age}. The sweep that would stop it is failing, so it stays held until someone looks — see the warning above.`;
  }
  if (minutes < SWEEP_AFTER_MINUTES) {
    return `Held by a publishing run for ${age}. The sweep stops it once the hold passes ${SWEEP_AFTER_MINUTES} minutes, then emails the admins.`;
  }
  return `Held by a publishing run for ${age} — past the sweep's ${SWEEP_AFTER_MINUTES} minutes, so the next publishing run stops it and emails the admins.`;
}

function platformColor(platform: string): string {
  const i = CHANNELS.findIndex((c) => c.key === platform);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

// The console's clock lives in lib/time, so every page shows the same one.
function defaultSlot(): string {
  return phoenixInput(Date.now() + 60 * 60 * 1000);
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

  const POST_COLUMNS =
    'id, status, scheduled_for, published_at, body, permalink, last_error, attempts, channel:social_channels(platform, display_name, status)';

  const [
    { data: channels },
    { data: contents },
    { data: stopped },
    { data: posts },
    { data: claims },
    { data: setting },
    { data: sweepState },
  ] = await Promise.all([
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
      // A stopped post is not history. Nothing moves it without a person or the sweep, so an age
      // window would let it fall off the page and hide exactly the post that has to be dealt with.
      // 'publishing' belongs here for the same reason: a claim whose run died sits in that state and
      // is moved by nothing else, so before the sweep finds it the page is the only place it shows.
      supabase
        .from('social_posts')
        .select(POST_COLUMNS)
        .in('status', ['failed', 'needs_manual', 'publishing'])
        .order('scheduled_for', { ascending: false })
        .limit(200),
      // The window is for the rest: published, scheduled and cancelled rows, where old does mean
      // finished with. The exclusion keeps a stopped or held post from appearing in both lists.
      supabase
        .from('social_posts')
        .select(POST_COLUMNS)
        .gte('scheduled_for', windowStart)
        .not('status', 'in', '("failed","needs_manual","publishing")')
        .order('scheduled_for', { ascending: false })
        .limit(500),
      // claimed_at arrives with 0019, so it is read on its own and its failure is ignored: a database
      // that has not had the migration yet still loads the page, it just cannot say how long a claim
      // has been held. Deliberately not part of POST_COLUMNS, which would fail the whole queue.
      supabase.from('social_posts').select('id, claimed_at').eq('status', 'publishing'),
      supabase.from('app_settings').select('value').eq('key', 'marketing').maybeSingle(),
      // Written by the publisher when a sweep fails, deleted when one works again. Its absence is the
      // normal case: it means the sweep ran.
      supabase.from('app_settings').select('value').eq('key', SWEEP_STATE_KEY).maybeSingle(),
    ]);

  const controls: MarketingControls = mergeControls(setting?.value);

  // A row rather than a boolean, so the banner can quote the actual error — "it is failing" with no
  // reason is the kind of notice people learn to scroll past.
  const sweepStateValue = sweepState?.value as
    | { error?: unknown; at?: unknown; degraded?: unknown }
    | null
    | undefined;
  const sweepFailure =
    sweepStateValue && typeof sweepStateValue.error === 'string'
      ? {
          error: sweepStateValue.error,
          at: typeof sweepStateValue.at === 'string' ? sweepStateValue.at : null,
          // The sweep is running on the older signature: held posts are still stopped, so the queue's
          // note stays true and only the banner changes.
          degraded: sweepStateValue.degraded === true,
        }
      : null;
  const sweepNoticeText = sweepFailure ? sweepNotice(sweepFailure) : null;

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
  // Stopped first, so the cap further down cannot hide one behind newer history.
  const postRows = [
    ...((stopped ?? []) as unknown as PostRow[]),
    ...((posts ?? []) as unknown as PostRow[]),
  ];
  const claimsById = new Map(
    ((claims ?? []) as { id: string; claimed_at: string | null }[]).map((row) => [row.id, row.claimed_at]),
  );
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
      key: phoenixDay(d),
      label: phoenix(d, { month: 'short', day: 'numeric' }),
    });
  }
  const perDay = new Map(days.map((d) => [d.key, 0]));
  for (const p of postRows) {
    if (p.status === 'cancelled') continue;
    const key = phoenixDay(p.scheduled_for);
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
  const upcoming = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(now + i * DAY);
    const key = phoenixDay(day);
    const label = i === 0 ? 'Today' : phoenix(day, { weekday: 'short', month: 'short', day: 'numeric' });
    return {
      key,
      label,
      today: i === 0,
      items: postRows
        .filter((p) => p.status !== 'cancelled' && phoenixDay(p.scheduled_for) === key)
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
          Nothing can be sent yet. Drafts and schedules keep working. Set{' '}
          <code>FACEBOOK_PAGE_ID</code> and <code>FACEBOOK_PAGE_TOKEN</code> on the server to post to
          Facebook directly, or <code>SOCIAL_API_URL</code> and <code>SOCIAL_API_KEY</code> for the
          other networks.
        </p>
      ) : null}
      {!controls.publishing_enabled ? (
        <p className="notice review">
          Publishing is switched off. Scheduled posts stay queued and nothing is sent until it is
          switched back on.
        </p>
      ) : null}
      {sweepFailure && sweepNoticeText ? (
        <p className={sweepNoticeText.tone}>
          {sweepNoticeText.text}
          {sweepNoticeText.since ? `${sweepNoticeText.since}:` : ' Last error:'}{' '}
          <code>{sweepFailure.error}</code>
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
                      {phoenixClock(p.scheduled_for)} ·{' '}
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
              <tr><th>Platform</th><th>Account</th><th>Status</th><th>Token expires</th><th>Last success</th><th></th></tr>
            </thead>
            <tbody>
              {channelRows.map((c) => (
                <tr key={c.id}>
                  <td>{channelSpec(c.platform)?.label ?? c.platform}</td>
                  <td>{c.display_name}</td>
                  <td>
                    <span className={`status ${c.status === 'active' ? 'approved' : 'blocked'}`}>{c.status}</span>
                  </td>
                  <td>{c.token_expires_at ? phoenix(c.token_expires_at, { dateStyle: 'medium' }) : '-'}</td>
                  <td>{c.last_ok_at ? phoenix(c.last_ok_at, { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}</td>
                  <td>
                    {isAdmin && c.status !== 'active' ? (
                      <form action={reactivateChannel.bind(null, c.id)}>
                        <button className="btn" type="submit">Mark active</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="muted small">
          If a token has been reconnected with the provider, <strong>Mark active</strong> clears the
          error and lets the posts that channel was holding be retried. Until then, Retry refuses.
        </p>

        {isAdmin ? (
          <form action={addChannel} className="inline-form">
            <select name="platform" aria-label="Platform" defaultValue="linkedin">
              {CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <input name="displayName" placeholder="Account name" aria-label="Account name" required maxLength={200} />
            <input name="externalId" placeholder="Provider profile id" aria-label="Provider profile id" required maxLength={200} />
            <input type="date" name="tokenExpiresAt" aria-label="Token expires on" />
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
              <span className="muted">
                {phoenix(d.created_at, { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
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
              {/* Stopped posts are at the front of postRows, so this cap never drops one. */}
              {postRows.slice(0, 40).map((p) => {
                const stamp = phoenixStamp(p.scheduled_for);
                const channel = channelRow(p.channel);
                const retryAllowed = retryRoute(channel?.status ?? null) === 'retry';
                // Why Retry is not on offer, in the row itself: a tooltip is not reachable by
                // keyboard or touch. Null unless the button is actually disabled, so rows that can be
                // retried stay as they were.
                const retryBlocked =
                  (p.status === 'failed' || p.status === 'needs_manual') && !retryAllowed
                    ? retryAdvice(channel?.status ?? null)
                    : null;
                return (
                  <tr key={p.id}>
                    <td>{stamp}</td>
                    <td>{channelLabel(p.channel)}</td>
                    <td><span className={`status ${p.status === 'published' ? 'approved' : p.status === 'failed' || p.status === 'needs_manual' ? 'blocked' : 'review'}`}>{p.status}</span></td>
                    <td className="wrap-cell">{p.body.slice(0, 140)}{p.body.length > 140 ? '…' : ''}</td>
                    <td className="wrap-cell">
                      {p.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer">Open post</a> : null}
                      {/* The advice names the channel state and what to do about it, so the short
                          error says the same thing a second time. One line per row. */}
                      {p.last_error && !retryBlocked ? (
                        <span className="muted small"> {p.last_error}</span>
                      ) : null}
                      {/* Neither Retry nor Cancel applies to a send that may be in flight, so the row
                          says what is happening and what happens next instead of offering a button. */}
                      {p.status === 'publishing' ? (
                        <span className="muted small">
                          {' '}
                          {publishHold(claimsById.get(p.id), Boolean(sweepFailure && !sweepFailure.degraded))}
                        </span>
                      ) : null}
                      {retryBlocked ? (
                        <span className="muted small"> {retryBlocked}</span>
                      ) : null}
                      {!p.permalink && !p.last_error && p.status !== 'publishing' && !retryBlocked
                        ? '-'
                        : null}
                    </td>
                    <td>
                      <div className="cell-actions">
                        {canWrite &&
                        (p.status === 'failed' || p.status === 'needs_manual') ? (
                          // The same check retryPost refuses on, so the button cannot offer a send the
                          // action will answer with just the advice sentence.
                          retryAllowed ? (
                            <form action={retryPost.bind(null, p.id)}>
                              <button className="btn" type="submit">Retry</button>
                            </form>
                          ) : (
                            // The reason is the line in the Result cell: a title on a disabled
                            // button is not reachable by keyboard or touch.
                            <button className="btn" type="button" disabled>
                              Retry
                            </button>
                          )
                        ) : null}
                        {canWrite &&
                        (p.status === 'scheduled' ||
                          p.status === 'failed' ||
                          p.status === 'needs_manual') ? (
                          <form action={cancelPost.bind(null, p.id)}>
                            <button className="btn danger" type="submit">Cancel</button>
                          </form>
                        ) : null}
                      </div>
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
