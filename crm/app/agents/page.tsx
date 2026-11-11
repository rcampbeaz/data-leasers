import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { runLeadTriage, runFollowUpDraft, decideDraft } from '@/lib/agent-actions';
import { setAgentControls } from '@/lib/admin-actions';

type Draft = {
  id: string;
  kind: string;
  title: string | null;
  body: string;
  status: string;
  created_at: string;
};

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ran?: string }>;
}) {
  const { error, ran } = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const canRun = me?.role === 'admin' || me?.role === 'introducer';
  const isAdmin = me?.role === 'admin';

  // Staff can read app_settings under row-level security, so this page does not
  // need the service-role client it used to build just to read one row.
  const [{ data: settings }, { data: drafts }, { data: leads }, { data: companies }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'agents').maybeSingle(),
    supabase
      .from('agent_drafts')
      .select('id, kind, title, body, status, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('leads').select('id, company').order('created_at', { ascending: false }).limit(100),
    supabase.from('companies').select('id, name').order('name').limit(200),
  ]);

  const controls = (settings?.value ?? { enabled: false, daily_cap: 0 }) as { enabled: boolean; daily_cap: number };

  return (
    <main className="page">
      <header className="page-head">
        <h1>Agents</h1>
        <p className="muted">
          Agents write drafts only. Nothing is sent from here. Approving a draft records the decision; sending is not
          built yet.
        </p>
      </header>

      {error ? <p className="notice blocked">{error}</p> : null}
      {ran ? <p className="notice">Run finished. Check the drafts below.</p> : null}

      <section className="panel">
        <h2>Status</h2>
        <p>
          Agents are <strong>{controls.enabled ? 'on' : 'off'}</strong>. Daily cap: {controls.daily_cap} runs.
        </p>
        {isAdmin ? (
          <form action={setAgentControls} className="form-row">
            <label><input type="checkbox" name="enabled" defaultChecked={controls.enabled} /> Agents enabled</label>
            <label>Daily cap <input type="number" name="dailyCap" min={0} max={500} defaultValue={controls.daily_cap} /></label>
            <button className="btn" type="submit">Save</button>
          </form>
        ) : null}
      </section>

      {canRun ? (
        <section className="panel">
          <h2>Run an agent</h2>
          <form action={runLeadTriage} className="form-row">
            <select name="leadId" required>
              <option value="">Choose a lead</option>
              {(leads ?? []).map((l) => (
                <option key={l.id} value={l.id}>{l.company}</option>
              ))}
            </select>
            <button className="btn" type="submit">Triage lead</button>
          </form>
          <form action={runFollowUpDraft} className="form-row">
            <select name="companyId" required>
              <option value="">Choose a company</option>
              {(companies ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="btn" type="submit">Draft follow-up</button>
          </form>
        </section>
      ) : null}

      <section>
        <h2>Drafts</h2>
        {(drafts ?? []).length === 0 ? <p className="muted">No drafts yet.</p> : null}
        {((drafts ?? []) as Draft[]).map((d) => (
          <article key={d.id} className="panel">
            <header>
              <strong>{d.title ?? d.kind}</strong>{' '}
              <span className="stage">{d.status}</span>{' '}
              <span className="muted">{new Date(d.created_at).toLocaleString('en-US')}</span>
            </header>
            <pre className="wrap-cell">{d.body}</pre>
            {canRun && d.status === 'pending' ? (
              <form action={decideDraft} className="form-row">
                <input type="hidden" name="draftId" value={d.id} />
                <button className="btn" type="submit" name="decision" value="approved">Approve</button>
                <button className="btn" type="submit" name="decision" value="rejected">Reject</button>
              </form>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}
