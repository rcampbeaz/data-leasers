import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { BarChart } from '@/components/charts';
import { releaseDomainHold } from '@/lib/domain-actions';
import {
  domainReport,
  formatRate,
  isMonthKey,
  monthLabel,
  monthlyReport,
  recentMonths,
  shiftMonth,
  totalOf,
  type SendLike,
  type SuppressionLike,
} from '@/lib/deliverability';

export const dynamic = 'force-dynamic';

const MONTHS = 6;

const VERDICT_CLASS: Record<string, string> = {
  ok: 'approved',
  watch: 'review',
  stop: 'blocked',
};

function emailOf(contact: unknown): string | null {
  const row = (Array.isArray(contact) ? contact[0] : contact) as { email?: string } | null | undefined;
  return row?.email ?? null;
}

export default async function DeliverabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; released?: string; error?: string }>;
}) {
  const { month, released, error: message } = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const canRelease = me?.role === 'admin' || me?.role === 'introducer';

  const months = recentMonths(MONTHS);
  const selected = isMonthKey(month) ? month : months[months.length - 1];
  const earliest = selected < months[0] ? `${selected}-01` : `${months[0]}-01`;

  const [{ data: sendData, error: sendError }, { data: suppressionData, error: suppressionError }] =
    await Promise.all([
      supabase
        .from('outbound_sends')
        .select('status, sent_at, contact:outreach_contacts(email)')
        .gte('sent_at', earliest)
        .order('sent_at', { ascending: false })
        .limit(5000),
      supabase
        .from('suppressions')
        .select('email, reason, created_at')
        .gte('created_at', earliest)
        .limit(5000),
    ]);

  const { data: holdData, error: holdError } = await supabase
    .from('domain_holds')
    .select('domain, reason, sent, complained, complaint_rate, created_at')
    .is('released_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  const holdRows = (holdData ?? []) as unknown as {
    domain: string;
    reason: string;
    sent: number;
    complained: number;
    complaint_rate: number | null;
    created_at: string;
  }[];

  const sendRows: SendLike[] = ((sendData ?? []) as unknown as {
    status: string;
    sent_at: string;
    contact: unknown;
  }[]).map((row) => ({
    status: row.status,
    sent_at: row.sent_at,
    email: emailOf(row.contact),
  }));

  const suppressions = (suppressionData ?? []) as unknown as SuppressionLike[];
  const monthly = monthlyReport(sendRows, suppressions, months);
  const domains = domainReport(sendRows, suppressions, selected);
  const monthTotal = totalOf(domains);
  const error = sendError || suppressionError;

  const chart = monthly.map((m) => ({ label: m.label, value: m.sent }));
  const worst = domains.filter((d) => d.verdict !== 'ok');

  return (
    <main className="page">
      <header className="page-head">
        <h1>Deliverability</h1>
        <p className="muted">
          What went out each month, and what came back, split by the recipient's domain. Complaint
          rate is the figure that gets a sending domain blocked; bounce rate is the warning that
          comes first.
        </p>
      </header>

      {error ? (
        <p className="notice blocked">
          The report could not load. Has migration <code>0011_outbound.sql</code> been run?
        </p>
      ) : null}
      {message ? <p className="notice blocked">{message}</p> : null}
      {released ? (
        <p className="notice">
          Released. The sweep leaves that domain alone for a week, then holds it again if the rate
          is still over the line.
        </p>
      ) : null}

      <nav className="filters" aria-label="Month">
        <Link href={`/deliverability?month=${shiftMonth(selected, -1)}`}>← Earlier</Link>
        {months.map((key) => (
          <Link key={key} href={`/deliverability?month=${key}`} className={key === selected ? 'active' : ''}>
            {monthLabel(key)}
          </Link>
        ))}
        {selected < months[months.length - 1] ? (
          <Link href={`/deliverability?month=${shiftMonth(selected, 1)}`}>Later →</Link>
        ) : null}
      </nav>

      <section className="kpis" aria-label={`Figures for ${monthLabel(selected)}`}>
        <div className="kpi"><span>Sent</span><strong>{monthTotal.sent}</strong></div>
        <div className="kpi">
          <span>Bounce rate</span>
          <strong className={monthTotal.verdict === 'ok' ? '' : 'overdue'}>
            {formatRate(monthTotal.sent > 0 ? monthTotal.bounced / monthTotal.sent : null)}
          </strong>
        </div>
        <div className="kpi">
          <span>Complaint rate</span>
          <strong className={monthTotal.verdict === 'ok' ? '' : 'overdue'}>
            {formatRate(monthTotal.sent > 0 ? monthTotal.complained / monthTotal.sent : null)}
          </strong>
        </div>
        <div className="kpi"><span>Unsubscribed</span><strong>{monthTotal.unsubscribed}</strong></div>
        <div className="kpi"><span>Suppressions added</span><strong>{monthTotal.added}</strong></div>
        <div className="kpi"><span>Domains mailed</span><strong>{domains.filter((d) => d.sent > 0).length}</strong></div>
      </section>

      <section className="panel">
        <h2>Sent per month</h2>
        {monthTotal.sent === 0 && monthly.every((m) => m.sent === 0) ? (
          <p className="muted">Nothing has been sent yet, so there is nothing to chart.</p>
        ) : (
          <BarChart data={chart} ariaLabel="Bar chart of outbound emails sent per month" />
        )}
      </section>

      <section className="panel">
        <h2>By month</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Sent</th>
              <th>Bounced</th>
              <th>Complaints</th>
              <th>Unsubscribed</th>
              <th>Suppressions</th>
              <th>Bounce</th>
              <th>Complaint</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((m) => (
              <tr key={m.key}>
                <td>
                  <Link href={`/deliverability?month=${m.key}`}>{m.label}</Link>
                </td>
                <td>{m.sent}</td>
                <td>{m.bounced}</td>
                <td>{m.complained}</td>
                <td>{m.unsubscribed}</td>
                <td>{m.added}</td>
                <td>{formatRate(m.bounceRate)}</td>
                <td>{formatRate(m.complaintRate)}</td>
                <td><span className={`status ${VERDICT_CLASS[m.verdict]}`}>{m.verdict}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>By domain, {monthLabel(selected)}</h2>
        {domains.length === 0 ? (
          <p className="muted">Nothing sent in this month, and nothing recorded against it.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Sent</th>
                <th>Bounced</th>
                <th>Complaints</th>
                <th>Unsubscribed</th>
                <th>Suppressions</th>
                <th>Bounce</th>
                <th>Complaint</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.domain}>
                  <td>{d.domain}</td>
                  <td>{d.sent}</td>
                  <td>{d.bounced}</td>
                  <td>{d.complained}</td>
                  <td>{d.unsubscribed}</td>
                  <td>{d.added}</td>
                  <td>{formatRate(d.bounceRate)}</td>
                  <td>{formatRate(d.complaintRate)}</td>
                  <td><span className={`status ${VERDICT_CLASS[d.verdict]}`}>{d.verdict}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {worst.length > 0 ? (
          <p className="notice review">
            {worst.length} domain{worst.length === 1 ? '' : 's'} outside the safe band.{' '}
            {worst.some((d) => d.verdict === 'stop')
              ? 'A domain at stop should be suppressed wholesale before the next send.'
              : 'Watch the next batch to that domain before adding volume.'}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <h2>Held domains</h2>
        <p className="muted">
          The hourly sweep holds a domain when its complaint rate is at or above 0.1% over the last
          30 days and it has sent at least 50 messages in that window — enough volume for the rate
          to mean something. A hold stops new mail to that domain; contacts stay in the pipeline and
          resume when it is released. A released domain is left alone by the sweep for a week.
        </p>
        {holdError ? (
          <p className="notice blocked">Holds could not load. Has migration <code>0013</code> been run?</p>
        ) : holdRows.length === 0 ? (
          <p className="muted">No domain is held.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Domain</th><th>Sent</th><th>Complaints</th><th>Rate</th><th>Why</th><th></th></tr>
            </thead>
            <tbody>
              {holdRows.map((h) => (
                <tr key={h.domain}>
                  <td>{h.domain}</td>
                  <td>{h.sent}</td>
                  <td>{h.complained}</td>
                  <td>{h.complaint_rate === null ? '—' : `${(h.complaint_rate * 100).toFixed(2)}%`}</td>
                  <td className="wrap-cell muted small">{h.reason}</td>
                  <td>
                    {canRelease ? (
                      <form action={releaseDomainHold.bind(null, h.domain)} className="inline-form">
                        <input name="note" placeholder="Why release it" maxLength={400} />
                        <button className="btn" type="submit">Release</button>
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
        <h2>Where these figures come from</h2>
        <ul className="list">
          <li>
            <strong>Sent</strong> counts messages the provider accepted, from the send log. A
            provider rejection is a failure, not a bounce, so it is not counted here.
          </li>
          <li>
            <strong>Bounced</strong> and <strong>complaints</strong> count suppression rows with
            those reasons, dated when they were recorded. The provider's webhook records a
            permanent bounce and a spam complaint automatically; anything reported by hand is
            recorded on the Outbound page. A zero still means "nothing recorded", not "nothing
            happened", because a temporary bounce is deliberately not counted as a bounce.
          </li>
          <li>
            <strong>Verdicts.</strong> Complaint: watch at 0.05%, stop at 0.1% - the published
            bulk-sender guidance is to stay under 0.1%. Bounce: watch at 2%, stop at 5%. A month
            with no sends shows a rate of - rather than 0%, because nothing sent is not the same as
            nothing bounced.
          </li>
          <li>
            <strong>Per domain</strong> is where a reputation problem lives: one bad list can sit
            inside an acceptable overall rate, and the domain view is what shows it.
          </li>
        </ul>
      </section>
    </main>
  );
}
