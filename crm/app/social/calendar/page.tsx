import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import {
  gridRange,
  monthGrid,
  monthKey,
  monthLabel,
  parseMonthKey,
  phoenixClock,
  phoenixDayKey,
  PLATFORM_LABELS,
  type Platform,
} from '@/lib/social';

type Row = {
  id: string;
  body: string;
  scheduled_for: string;
  social_post_channels: { social_channels: { platform: string } | null }[] | null;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const { year, month } = parseMonthKey(m);
  const { from, to } = gridRange(year, month);

  const supabase = await createStaffClient();
  const { data, error } = await supabase
    .from('social_posts')
    .select('id, body, scheduled_for, social_post_channels(social_channels(platform))')
    .eq('state', 'scheduled')
    .gte('scheduled_for', from)
    .lt('scheduled_for', to)
    .order('scheduled_for');

  const rows = (data ?? []) as unknown as Row[];

  // Grouped by the Phoenix calendar day, not the UTC one, so a late-evening post
  // stays on the day it will actually be seen.
  const byDay = new Map<string, Row[]>();
  for (const row of rows) {
    const key = phoenixDayKey(row.scheduled_for);
    const list = byDay.get(key) ?? [];
    list.push(row);
    byDay.set(key, list);
  }

  const cells = monthGrid(year, month);
  const previous = new Date(Date.UTC(year, month - 1, 1));
  const next = new Date(Date.UTC(year, month + 1, 1));

  return (
    <main className="page">
      <header className="page-head">
        <h1>Calendar</h1>
        <p className="muted">
          Scheduled posts for the month, in Phoenix time. To move one, change its date in the queue.
        </p>
      </header>

      <nav className="filters" aria-label="Social">
        <Link href="/social">Queue</Link>
        <Link href="/social/calendar" className="active">
          Calendar
        </Link>
        <Link href="/social/channels">Channels</Link>
        <Link href="/social/media">Media</Link>
        <Link href="/social/compose">New post</Link>
      </nav>

      {error ? (
        <p className="notice blocked">
          Could not load the calendar. Run <code>0009_social.sql</code> in Supabase, then reload.
        </p>
      ) : null}

      <div className="filters" aria-label="Month">
        <Link href={`/social/calendar?m=${monthKey(previous.getUTCFullYear(), previous.getUTCMonth())}`}>
          Previous
        </Link>
        <span className="muted small" style={{ padding: '7px 4px' }}>
          {monthLabel(year, month)} · {rows.length} scheduled
        </span>
        <Link href={`/social/calendar?m=${monthKey(next.getUTCFullYear(), next.getUTCMonth())}`}>
          Next
        </Link>
        <Link href="/social/calendar">This month</Link>
      </div>

      <div className="cal" role="grid" aria-label={monthLabel(year, month)}>
        {WEEKDAYS.map((day) => (
          <div className="cal-head" key={day}>
            {day}
          </div>
        ))}
        {cells.map((cell) => {
          const posts = byDay.get(cell.key) ?? [];
          return (
            <div
              key={cell.key}
              className={`cal-cell ${cell.inMonth ? '' : 'out'}`}
              role="gridcell"
              aria-label={cell.key}
            >
              <span className="cal-day">{cell.day}</span>
              {posts.map((post) => {
                const platform = post.social_post_channels?.[0]?.social_channels?.platform;
                const label = platform ? (PLATFORM_LABELS[platform as Platform] ?? platform) : 'Post';
                return (
                  <span className="cal-item" key={post.id} title={post.body.slice(0, 200)}>
                    <strong>{phoenixClock(post.scheduled_for)}</strong> {label}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </main>
  );
}
