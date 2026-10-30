import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { todayIso } from '@/lib/data';

export default async function CompaniesPage() {
  const supabase = await createStaffClient();
  const { data: companies, error } = await supabase
    .from('companies')
    .select('id, name, stage, close_reason, next_action, next_action_due, updated_at')
    .order('updated_at', { ascending: false });

  const today = todayIso();

  return (
    <main className="page">
      <header className="page-head">
        <h1>Companies</h1>
        <p className="muted">Every company in the pipeline, including closed records. Most recently updated first.</p>
      </header>

      {error ? (
        <p className="notice blocked">Could not load companies. Check your staff access.</p>
      ) : (companies ?? []).length === 0 ? (
        <p className="muted">No companies yet. Create one from a lead on the Leads page.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Stage</th>
              <th>Next action</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {(companies ?? []).map((c) => {
              const overdue = c.next_action_due && c.next_action_due < today && c.stage !== 'Closed';
              return (
                <tr key={c.id}>
                  <td><Link href={`/companies/${c.id}`}>{c.name}</Link></td>
                  <td>
                    <span className="stage">{c.stage}</span>
                    {c.close_reason ? <span className="muted"> {c.close_reason}</span> : null}
                  </td>
                  <td className="wrap-cell">{c.next_action ?? '-'}</td>
                  <td className={overdue ? 'overdue' : ''}>{c.next_action_due ?? '-'}{overdue ? ' (overdue)' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
