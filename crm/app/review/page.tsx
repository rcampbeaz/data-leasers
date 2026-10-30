import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { setDatasetStatusFromReview } from '@/lib/actions';

type Row = {
  id: string;
  name: string;
  status: string;
  status_reason: string | null;
  company_id: string;
  companies: { name: string } | { name: string }[] | null;
};

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: message } = await searchParams;
  const supabase = await createStaffClient();
  const { data, error } = await supabase
    .from('datasets')
    .select('id, name, status, status_reason, company_id, companies(name)')
    .in('status', ['Blocked', 'Review'])
    .order('created_at');

  // Blocked first, then Review.
  const rows = ((data ?? []) as unknown as Row[]).sort(
    (a, b) => (a.status === 'Blocked' ? 0 : 1) - (b.status === 'Blocked' ? 0 : 1),
  );

  return (
    <main className="page">
      <header className="page-head">
        <h1>Review queue</h1>
        <p className="muted">
          Datasets still marked Review or Blocked. Blocked datasets hold their company at Data assessed.
          Changing a status here is recorded in the activity log.
        </p>
      </header>

      {message ? <p className="notice blocked">{message}</p> : null}
      {error ? (
        <p className="notice blocked">Could not load the queue. Reviewer or admin access is needed.</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nothing waiting for review.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Dataset</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Change status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
              return (
                <tr key={row.id}>
                  <td>
                    <Link href={`/companies/${row.company_id}`}>{company?.name ?? 'Unknown'}</Link>
                  </td>
                  <td>{row.name}</td>
                  <td>
                    <span className={`status ${row.status.toLowerCase()}`}>{row.status}</span>
                  </td>
                  <td className="wrap-cell">{row.status_reason ?? '-'}</td>
                  <td>
                    <form action={setDatasetStatusFromReview.bind(null, row.id)} className="inline-form">
                      <input type="hidden" name="companyId" value={row.company_id} />
                      <select name="status" defaultValue={row.status}>
                        <option>Approved</option>
                        <option>Review</option>
                        <option>Blocked</option>
                      </select>
                      <input name="reason" placeholder="Reason" maxLength={1000} />
                      <button className="btn" type="submit">Save</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
