import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { setTaskDone } from '@/lib/admin-actions';
import { currentStaff, todayIso } from '@/lib/data';

type Task = {
  id: string;
  title: string;
  due_on: string;
  done: boolean;
  companies: { id: string; name: string } | null;
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  // Viewers can read tasks but cannot change them (matches the database policy).
  const canEdit = me?.role === 'admin' || me?.role === 'introducer';
  const today = todayIso();
  const showDone = show === 'done';

  let query = supabase
    .from('tasks')
    .select('id, title, due_on, done, companies(id, name)')
    .order('due_on', { ascending: true })
    .limit(200);
  if (!showDone) query = query.eq('done', false);
  const { data, error } = await query;
  const tasks = (data ?? []) as unknown as Task[];

  const overdue = tasks.filter((t) => !t.done && t.due_on < today);
  const dueToday = tasks.filter((t) => !t.done && t.due_on === today);

  return (
    <main className="page">
      <header className="page-head">
        <h1>Tasks</h1>
        <p className="muted">Follow-ups across all companies. Overdue and due-today items are shown first.</p>
      </header>

      <nav className="filters">
        <Link href="/tasks" className={showDone ? '' : 'active'}>Open</Link>
        <Link href="/tasks?show=done" className={showDone ? 'active' : ''}>Include done</Link>
      </nav>

      {error ? <p className="notice blocked">Could not load tasks.</p> : null}
      {!error && overdue.length > 0 ? <p className="notice blocked">{overdue.length} overdue.</p> : null}
      {!error && dueToday.length > 0 ? <p className="notice">{dueToday.length} due today.</p> : null}

      {tasks.length === 0 && !error ? <p className="muted">No tasks.</p> : null}

      {tasks.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Due</th>
              <th>Task</th>
              <th>Company</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const late = !t.done && t.due_on < today;
              return (
                <tr key={t.id} className={late ? 'overdue' : undefined}>
                  <td>{new Date(t.due_on + 'T00:00:00').toLocaleDateString('en-GB')}{late ? ' (overdue)' : ''}</td>
                  <td>{t.title}</td>
                  <td>
                    {t.companies ? <Link href={`/companies/${t.companies.id}`}>{t.companies.name}</Link> : '-'}
                  </td>
                  <td>
                    {canEdit ? (
                      <form action={setTaskDone}>
                        <input type="hidden" name="taskId" value={t.id} />
                        <input type="hidden" name="done" value={t.done ? 'false' : 'true'} />
                        <button className="btn" type="submit">{t.done ? 'Reopen' : 'Mark done'}</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
