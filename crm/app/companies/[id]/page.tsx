import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createStaffClient } from '@/lib/supabase';
import { loadStaff, todayIso } from '@/lib/data';
import { STAGES, suggestStage, type DatasetStatus, type Stage } from '@/lib/pipeline';
import {
  addActivity,
  addContact,
  addDataset,
  addTask,
  moveStage,
  setDatasetStatus,
  toggleTask,
  updateCompany,
} from '@/lib/actions';

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createStaffClient();

  const { data: company } = await supabase
    .from('companies')
    .select('id, name, stage, close_reason, source, owner_id, introduced_by, next_action, next_action_due, lead_id, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!company) notFound();

  const [contacts, activities, datasets, tasks, history, staff] = await Promise.all([
    supabase.from('contacts').select('id, name, email, role_title').eq('company_id', id).order('created_at'),
    supabase.from('activities').select('id, kind, body, call_at, created_at').eq('company_id', id).order('created_at', { ascending: false }),
    supabase.from('datasets').select('id, name, status, status_reason').eq('company_id', id).order('created_at'),
    supabase.from('tasks').select('id, title, due_on, done, assigned_to').eq('company_id', id).order('due_on'),
    supabase.from('stage_history').select('from_stage, to_stage, changed_at').eq('company_id', id).order('changed_at', { ascending: false }),
    loadStaff(supabase),
  ]);

  const staffName = (uid: string | null) => staff.find((s) => s.user_id === uid)?.full_name ?? '-';

  // Suggested stage: shown for a person to confirm, never applied here.
  const datasetRows = (datasets.data ?? []).map((d) => ({ status: d.status as DatasetStatus }));
  const suggestion = suggestStage({
    stage: company.stage as Stage,
    closeReason: company.close_reason,
    datasets: datasetRows,
    noteCount: (activities.data ?? []).filter((a) => a.kind === 'note').length,
    callAt: null,
  });
  const suggestionOnly = suggestion && !suggestion.auto ? suggestion : null;

  const updateCompanyWithId = updateCompany.bind(null, id);
  const addActivityWithId = addActivity.bind(null, id);
  const moveStageWithId = moveStage.bind(null, id);
  const addContactWithId = addContact.bind(null, id);
  const addDatasetWithId = addDataset.bind(null, id);
  const addTaskWithId = addTask.bind(null, id);

  return (
    <main className="page">
      <header className="page-head">
        <p className="muted small"><Link href="/companies">Companies</Link> / {company.name}</p>
        <h1>{company.name}</h1>
        <p><span className="stage">{company.stage}</span>{company.close_reason ? <span className="muted"> ({company.close_reason})</span> : null}</p>
      </header>

      {error ? <p className="notice blocked">{error}</p> : null}
      {suggestionOnly ? (
        <p className="notice review">Suggested next stage: {suggestionOnly.to}. {suggestionOnly.reason}</p>
      ) : null}

      <div className="two-col">
        <section className="panel">
          <h2>Stage</h2>
          <form action={moveStageWithId} className="inline-form">
            <select name="stage" defaultValue={company.stage}>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select name="closeReason" defaultValue={company.close_reason ?? ''}>
              <option value="">Close reason (if Closed)</option>
              <option>Won</option><option>Lost</option><option>Paused</option><option>Not a fit</option>
            </select>
            <button className="btn" type="submit">Move</button>
          </form>

          <h2>Owner and introducer</h2>
          <form action={updateCompanyWithId} className="stack">
            <label>Owner
              <select name="ownerId" defaultValue={company.owner_id ?? ''}>
                <option value="">None</option>
                {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}
              </select>
            </label>
            <label>Introduced by
              <select name="introducedBy" defaultValue={company.introduced_by ?? ''}>
                <option value="">None</option>
                {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}
              </select>
            </label>
            <label>Next action
              <input name="nextAction" defaultValue={company.next_action ?? ''} maxLength={300} />
            </label>
            <label>Next action due
              <input type="date" name="nextActionDue" defaultValue={company.next_action_due ?? ''} />
            </label>
            <button className="btn" type="submit">Save</button>
          </form>
        </section>

        <section className="panel">
          <h2>Log a note, call or decision</h2>
          <form action={addActivityWithId} className="stack">
            <label>Type
              <select name="kind" defaultValue="note">
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="decision">Decision</option>
              </select>
            </label>
            <label>Date and time of call (for calls)
              <input type="datetime-local" name="callAt" />
            </label>
            <label>Details
              <textarea name="body" rows={4} maxLength={4000} />
            </label>
            <button className="btn" type="submit">Save entry</button>
          </form>
        </section>
      </div>

      <section className="panel">
        <h2>Datasets and rights status</h2>
        {datasetRows.length === 0 ? <p className="muted">No datasets yet.</p> : (
          <table className="table">
            <tbody>
              {(datasets.data ?? []).map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td><span className={`status ${d.status.toLowerCase()}`}>{d.status}</span></td>
                  <td className="wrap-cell">{d.status_reason ?? '-'}</td>
                  <td>
                    <form action={setDatasetStatus.bind(null, id, d.id)} className="inline-form">
                      <select name="status" defaultValue={d.status}>
                        <option>Approved</option><option>Review</option><option>Blocked</option>
                      </select>
                      <input name="reason" placeholder="Reason" maxLength={1000} />
                      <button className="btn" type="submit">Update</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={addDatasetWithId} className="inline-form">
          <input name="name" placeholder="Dataset name" required maxLength={200} />
          <select name="status" defaultValue="Review">
            <option>Approved</option><option>Review</option><option>Blocked</option>
          </select>
          <input name="reason" placeholder="Reason" maxLength={1000} />
          <button className="btn" type="submit">Add dataset</button>
        </form>
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>Contacts</h2>
          {(contacts.data ?? []).length === 0 ? <p className="muted">No contacts yet.</p> : (
            <ul className="list">
              {(contacts.data ?? []).map((c) => (
                <li key={c.id}>{c.name}{c.role_title ? `, ${c.role_title}` : ''}{c.email ? <> · <a href={`mailto:${c.email}`}>{c.email}</a></> : null}</li>
              ))}
            </ul>
          )}
          <form action={addContactWithId} className="stack">
            <input name="name" placeholder="Name" required maxLength={200} />
            <input name="roleTitle" placeholder="Role" maxLength={200} />
            <input name="email" type="email" placeholder="Email" maxLength={320} />
            <button className="btn" type="submit">Add contact</button>
          </form>
        </section>

        <section className="panel">
          <h2>Tasks and reminders</h2>
          {(tasks.data ?? []).length === 0 ? <p className="muted">No tasks yet.</p> : (
            <ul className="list">
              {(tasks.data ?? []).map((t) => {
                const overdue = !t.done && t.due_on < todayIso();
                return (
                  <li key={t.id} className={overdue ? 'overdue' : ''}>
                    <form action={toggleTask.bind(null, id, t.id, !t.done)}>
                      <button className="link-button" type="submit">{t.done ? 'Reopen' : 'Done'}</button>
                    </form>
                    {t.title} · due {t.due_on}{overdue ? ' (overdue)' : ''} · {staffName(t.assigned_to)}
                  </li>
                );
              })}
            </ul>
          )}
          <form action={addTaskWithId} className="stack">
            <input name="title" placeholder="What needs doing" required maxLength={300} />
            <input type="date" name="dueOn" required />
            <select name="assignedTo" defaultValue="">
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}
            </select>
            <button className="btn" type="submit">Add task</button>
          </form>
        </section>
      </div>

      <section className="panel">
        <h2>Timeline</h2>
        {(activities.data ?? []).length === 0 ? <p className="muted">Nothing logged yet.</p> : (
          <ul className="list">
            {(activities.data ?? []).map((a) => (
              <li key={a.id}>
                <strong>{a.kind}</strong>
                {a.call_at ? ` on ${new Date(a.call_at).toLocaleString('en-US')}` : ''}
                {' · '}{new Date(a.created_at).toLocaleDateString('en-US')}
                {a.body ? <div className="wrap-cell">{a.body}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Stage history</h2>
        {(history.data ?? []).length === 0 ? <p className="muted">No changes yet.</p> : (
          <ul className="list small">
            {(history.data ?? []).map((h, i) => (
              <li key={i}>{h.from_stage ?? 'Start'} to {h.to_stage} · {new Date(h.changed_at).toLocaleString('en-US')}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
