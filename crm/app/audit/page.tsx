import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { phoenix } from '@/lib/time';

type Row = {
  id: number;
  entity: string;
  entity_id: string;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
  actor_id: string | null;
};

// Where a log entry points. The log is read when something needs explaining — why a company moved,
// who released a held domain — and a row that names a record without linking to it sends the reader
// to find it by hand. An entity with no page of its own falls back to the company carried in its
// detail; anything still unknown stays plain text rather than guessing at a route.
const BY_ENTITY: Record<string, string> = {
  lead: '/leads',
  partner: '/partners',
  referral: '/partners',
  buyer: '/buyers',
  erasure: '/privacy-requests',
  settings: '/agents',
  domain: '/deliverability',
  social_post: '/marketing',
  social_channel: '/marketing',
};

const COMPANY_SCOPED = new Set(['offer', 'agreement', 'document', 'introduction']);

function hrefFor(row: Row): string | null {
  if (row.entity === 'company') return `/companies/${row.entity_id}`;
  const direct = BY_ENTITY[row.entity];
  if (direct) return direct;
  if (COMPANY_SCOPED.has(row.entity)) {
    const companyId = row.detail?.company_id;
    if (typeof companyId === 'string') return `/companies/${companyId}`;
  }
  return null;
}

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
        <p className="muted">
          The 200 most recent recorded changes. Entries cannot be edited or deleted. Where a record has a
          page of its own, its entry links to it.
        </p>
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
            {((rows ?? []) as Row[]).map((r) => {
              const text = `${r.entity} ${r.action.replace(/_/g, ' ')}`;
              const href = hrefFor(r);
              return (
                <tr key={r.id}>
                  <td>{phoenix(r.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{nameOf(r.actor_id)}</td>
                  <td>{href ? <Link href={href}>{text}</Link> : text}</td>
                  <td className="wrap-cell small">{r.detail ? JSON.stringify(r.detail) : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
