import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { SWEEP_AFTER_MINUTES, SWEEP_STATE_KEY } from '@/lib/social';
import { phoenix } from '@/lib/time';

export const dynamic = 'force-dynamic';

type SweepWarning = { error?: string; at?: string; degraded?: boolean } | null;

// How long ago something happened, in the words a person would use. Ages are differences between two
// instants, so this is plain arithmetic; anything shown as a time of day goes through phoenix().
function since(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return 'never';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const countOf = async (
  supabase: Awaited<ReturnType<typeof createStaffClient>>,
  status: string,
): Promise<number> => {
  const { count } = await supabase
    .from('social_posts')
    .select('id', { count: 'exact', head: true })
    .eq('status', status);
  return count ?? 0;
};

// Quiet hours are the failure this page exists for: a sweep that stops running, a post stuck in
// 'publishing', or a claimed outbound send that never recorded an outcome all look like nothing
// happening. The numbers below are what "nothing happening" looks like when it is wrong.
export default async function HealthPage() {
  const supabase = await createStaffClient();

  const [{ data: sweepRow, error: settingsError }, scheduled, publishing, needsManual, failed] =
    await Promise.all([
      supabase.from('app_settings').select('value, updated_at').eq('key', SWEEP_STATE_KEY).maybeSingle(),
      countOf(supabase, 'scheduled'),
      countOf(supabase, 'publishing'),
      countOf(supabase, 'needs_manual'),
      countOf(supabase, 'failed'),
    ]);

  const warning = (sweepRow?.value ?? null) as SweepWarning;

  const [
    { data: stuck },
    { data: waiting },
    { data: lastPublished },
    { count: sending },
    { data: lastSend },
  ] = await Promise.all([
      supabase
        .from('social_posts')
        .select('id, claimed_at, scheduled_for')
        .eq('status', 'publishing')
        .order('claimed_at', { ascending: true, nullsFirst: true })
        .limit(1),
      supabase
        .from('social_posts')
        .select('id, scheduled_for')
        .eq('status', 'needs_manual')
        .order('scheduled_for', { ascending: true })
        .limit(1),
      supabase
        .from('social_posts')
        .select('published_at')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(1),
      supabase
        .from('sequence_enrolments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sending'),
      supabase
        .from('outbound_sends')
        .select('sent_at, status')
        .order('sent_at', { ascending: false })
        .limit(1),
    ]);

  const stuckRow = (stuck ?? [])[0] as { claimed_at: string | null; scheduled_for: string } | undefined;
  const stuckMinutes = stuckRow
    ? Math.floor((Date.now() - Date.parse(stuckRow.claimed_at ?? stuckRow.scheduled_for)) / 60_000)
    : 0;
  const overdue = stuckRow !== undefined && stuckMinutes >= SWEEP_AFTER_MINUTES;
  const waitingRow = (waiting ?? [])[0] as { scheduled_for: string } | undefined;
  const sendRow = (lastSend ?? [])[0] as { sent_at: string; status: string } | undefined;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Scheduler health</h1>
        <p className="muted">
          What the publishing and outbound jobs did last, and anything waiting for a person. The
          marketing queue itself is on <Link href="/marketing">Social &amp; marketing</Link>.
        </p>
      </header>

      {settingsError ? (
        <p className="notice blocked">Could not read the scheduler record. Admin access is needed.</p>
      ) : null}

      {warning ? (
        <p className="notice blocked">
          The last sweep failed {since(warning.at)}: {warning.error ?? 'no message recorded'}
          {warning.degraded ? ' The database looks behind the code, so the sweep fell back.' : ''}
        </p>
      ) : (
        <p className="notice approved">
          No sweep warning recorded. A successful sweep clears it, so this is the healthy state.
        </p>
      )}

      <section className="kpis" aria-label="Queue and outbound state">
        <div className="kpi">
          <span>Queued posts</span>
          <strong>{scheduled}</strong>
        </div>
        <div className="kpi">
          <span>Waiting for a person</span>
          <strong className={needsManual ? 'overdue' : ''}>{needsManual}</strong>
        </div>
        <div className="kpi">
          <span>Failed posts</span>
          <strong className={failed ? 'overdue' : ''}>{failed}</strong>
        </div>
        <div className="kpi">
          <span>Being published now</span>
          <strong className={overdue ? 'overdue' : ''}>{publishing}</strong>
        </div>
        <div className="kpi">
          <span>Outbound sends claimed</span>
          <strong className={sending ? 'overdue' : ''}>{sending ?? 0}</strong>
        </div>
      </section>

      <section>
        <h2>What this means</h2>
        <ul className="list">
          <li>
            <strong>Being published now</strong> is normally 0. A post held here for more than{' '}
            {SWEEP_AFTER_MINUTES} minutes means a publishing run died, and the next sweep will move it
            to needs a person rather than re-send it.
          </li>
          <li>
            <strong>Outbound sends claimed</strong> is also normally 0. An enrolment stays at
            &lsquo;sending&rsquo; only while a run is in flight; one left behind is an email whose
            outcome was never recorded, so check the Cold email page for it.
          </li>
          <li>
            <strong>Waiting for a person</strong> counts posts that stopped for good — a spent retry
            ladder, a dead token, or a run that died. Retry and Cancel are on the marketing queue.
          </li>
        </ul>
      </section>

      <section>
        <h2>Last activity</h2>
        <table className="table">
          <tbody>
            <tr>
              <th>Oldest stuck post</th>
              <td>
                {stuckRow
                  ? `${since(stuckRow.claimed_at ?? stuckRow.scheduled_for)} (due ${phoenix(stuckRow.scheduled_for, { dateStyle: 'medium', timeStyle: 'short' })})`
                  : 'none'}
              </td>
            </tr>
            <tr>
              <th>Oldest post waiting for a person</th>
              <td>
                {waitingRow
                  ? `due ${phoenix(waitingRow.scheduled_for, { dateStyle: 'medium', timeStyle: 'short' })}`
                  : 'none'}
              </td>
            </tr>
            <tr>
              <th>Last post published</th>
              <td>{lastPublished?.[0] ? since((lastPublished[0] as { published_at: string }).published_at) : 'never'}</td>
            </tr>
            <tr>
              <th>Last outbound send</th>
              <td>{sendRow ? `${since(sendRow.sent_at)} (${sendRow.status})` : 'never'}</td>
            </tr>
            <tr>
              <th>Sweep record updated</th>
              <td>{sweepRow?.updated_at ? since(String(sweepRow.updated_at)) : 'never'}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
