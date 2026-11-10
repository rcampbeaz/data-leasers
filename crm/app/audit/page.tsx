import { createStaffClient } from '@/lib/supabase';

type Row = {
  id: number;
  entity: string;
  entity_id: string;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
  actor_id: string | null;
};

export default async function AuditPage() {
  const supabase = await createStaffClient();
  const { data: rows, error } = await supabase
    .from('audit_log')
    .select('id, entity, entity_id, action, detail, created_at, actor_id')
    .order('created_at', { ascending: false })
    .limit(200);

  // Actor names, so the log shows people rather than IDs.
  const { data: staff } = await supabase.from('crm_staff').select('user_id, full_name');
  const nameOf = (id: string | null) => (staff ?? []).find((s) => s.user_id === id)?.full_name ?? 'Unknown user';

  return (
    <main className="page">
      <header className="page-head">
        <h1>Activity log</h1>
        <p className="muted">The 200 most recent recorded changes. Entries cannot be edited or deleted.</p>
      </header>

      {error ? <p className="notice blocked">Could not load the log. Admin or reviewer access is needed.</p> : null}

      {(rows ?? []).length === 0 && !error ? (
        <p className="muted">No activity recorded yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {((rows ?? []) as Row[]).map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString('en-US')}</td>
                <td>{nameOf(r.actor_id)}</td>
                <td>{r.entity} {r.action.replace(/_/g, ' ')}</td>
                <td className="wrap-cell small">{r.detail ? JSON.stringify(r.detail) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
