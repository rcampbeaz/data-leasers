import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff, todayIso } from '@/lib/data';
import { STAGES } from '@/lib/pipeline';
import { BarChart, DonutChart, LineChart } from '@/components/charts';

const DAY = 24 * 60 * 60 * 1000;

// Last 12 calendar months, oldest first, as "Mon YY" labels.
function lastMonths(count: number) {
  const now = new Date();
  const months: { key: string; label: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
    });
  }
  return months;
}

export default async function DashboardPage() {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const today = todayIso();
  const since = new Date(Date.now() - 365 * DAY).toISOString();
  const thirtyDaysAgo = Date.now() - 30 * DAY;
  const weekAhead = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10);

  const [leadsRes, companiesRes, datasetsRes, tasksRes, historyRes] = await Promise.all([
    supabase.from('leads').select('created_at').gte('created_at', since),
    supabase.from('companies').select('id, name, stage, close_reason, closed_at, next_action, next_action_due'),
    supabase.from('datasets').select('status'),
    supabase.from('tasks').select('id, title, due_on, done').eq('done', false),
    supabase
      .from('stage_history')
      .select('from_stage, to_stage, changed_at, companies(name)')
      .order('changed_at', { ascending: false })
      .limit(8),
  ]);

  const leads = leadsRes.data ?? [];
  const companies = companiesRes.data ?? [];
  const datasets = datasetsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const history = (historyRes.data ?? []) as unknown as {
    from_stage: string | null;
    to_stage: string;
    changed_at: string;
    companies: { name: string } | { name: string }[] | null;
  }[];

  const error = leadsRes.error || companiesRes.error || datasetsRes.error || tasksRes.error;

  // KPIs
  const newLeads30 = leads.filter((l) => new Date(l.created_at).getTime() >= thirtyDaysAgo).length;
  const openCompanies = companies.filter((c) => c.stage !== 'Closed').length;
  const wonThisYear = companies.filter(
    (c) => c.close_reason === 'Won' && c.closed_at && new Date(c.closed_at).getUTCFullYear() === new Date().getUTCFullYear(),
  ).length;
  const overdueTasks = tasks.filter((t) => t.due_on < today).length;
  const dueThisWeek = tasks.filter((t) => t.due_on >= today && t.due_on <= weekAhead).length;
  const blockedDatasets = datasets.filter((d) => d.status === 'Blocked').length;

  // Leads per month
  const months = lastMonths(12);
  const leadCounts = new Map(months.map((m) => [m.key, 0]));
  for (const l of leads) {
    const d = new Date(l.created_at);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (leadCounts.has(key)) leadCounts.set(key, (leadCounts.get(key) ?? 0) + 1);
  }
  const leadSeries = months.map((m) => ({ label: m.label, value: leadCounts.get(m.key) ?? 0 }));

  // Companies per stage (open pipeline)
  const stageSeries = STAGES.map((s) => ({
    label: s,
    value: companies.filter((c) => c.stage === s).length,
  }));

  // Dataset status
  const statusColors: Record<string, string> = {
    Approved: '#0F7C7A',
    Review: '#B45309',
    Blocked: '#8A1C14',
  };
  const datasetSeries = ['Approved', 'Review', 'Blocked'].map((s) => ({
    label: s,
    value: datasets.filter((d) => d.status === s).length,
    color: statusColors[s],
  }));

  // Upcoming and overdue next actions
  const actions = companies
    .filter((c) => c.stage !== 'Closed' && c.next_action_due)
    .sort((a, b) => String(a.next_action_due).localeCompare(String(b.next_action_due)))
    .slice(0, 6);

  const name = (c: (typeof history)[number]['companies']) => (Array.isArray(c) ? c[0]?.name : c?.name) ?? 'Unknown';

  return (
    <main className="page">
      <header className="page-head">
        <h1>Dashboard</h1>
        <p className="muted">
          {me ? `Welcome back, ${me.full_name.split(' ')[0]}.` : 'Welcome back.'} Figures update when the page loads.
        </p>
      </header>

      {error ? <p className="notice blocked">Some figures could not load. Check your staff access.</p> : null}

      <section className="kpis" aria-label="Key figures">
        <div className="kpi"><span>New leads, last 30 days</span><strong>{newLeads30}</strong></div>
        <div className="kpi"><span>Open companies</span><strong>{openCompanies}</strong></div>
        <div className="kpi"><span>Won this year</span><strong>{wonThisYear}</strong></div>
        <div className="kpi"><span>Tasks overdue</span><strong className={overdueTasks ? 'overdue' : ''}>{overdueTasks}</strong></div>
        <div className="kpi"><span>Tasks due this week</span><strong>{dueThisWeek}</strong></div>
        <div className="kpi"><span>Blocked datasets</span><strong className={blockedDatasets ? 'overdue' : ''}>{blockedDatasets}</strong></div>
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>Enquiries, last 12 months</h2>
          <LineChart data={leadSeries} ariaLabel="Line chart of enquiries per month for the last 12 months" />
        </section>
        <section className="panel">
          <h2>Dataset status</h2>
          <DonutChart data={datasetSeries} ariaLabel="Donut chart of dataset status: approved, review and blocked" />
        </section>
      </div>

      <section className="panel">
        <h2>Companies by pipeline stage</h2>
        <BarChart data={stageSeries} ariaLabel="Bar chart of companies in each pipeline stage" />
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>Next actions</h2>
          {actions.length === 0 ? (
            <p className="muted">No dated next actions yet.</p>
          ) : (
            <ul className="list">
              {actions.map((c) => {
                const overdue = (c.next_action_due as string) < today;
                return (
                  <li key={c.id}>
                    <Link href={`/companies/${c.id}`}>{c.name}</Link>
                    {c.next_action ? ` - ${c.next_action}` : ''}{' '}
                    <span className={overdue ? 'overdue' : 'muted'}>
                      {c.next_action_due}{overdue ? ' (overdue)' : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Recent pipeline changes</h2>
          {history.length === 0 ? (
            <p className="muted">No stage changes yet.</p>
          ) : (
            <ul className="list">
              {history.map((h, i) => (
                <li key={i}>
                  <Link href={`/pipeline`}>{name(h.companies)}</Link> moved{' '}
                  {h.from_stage ? <>from <strong>{h.from_stage}</strong> </> : null}to <strong>{h.to_stage}</strong>{' '}
                  <span className="muted small">{new Date(h.changed_at).toLocaleDateString('en-GB')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
