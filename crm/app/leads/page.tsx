import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { createCompanyFromLead } from '@/lib/actions';
import { addLead } from '@/lib/admin-actions';
import { currentStaff } from '@/lib/data';
import { escapeLike } from '@/lib/csv';

type Lead = {
  id: string;
  name: string;
  email: string;
  company: string;
  role_title: string | null;
  data_note: string | null;
  created_at: string;
  companies: { id: string; stage: string }[];
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; q?: string; page?: string }>;
}) {
  const { error: message, saved, q, page } = await searchParams;
  const perPage = 25;
  const current = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const canAdd = me?.role === 'admin' || me?.role === 'introducer';
  // The company's stage is read from the company record, so it is always current.
  let query = supabase
    .from('leads')
    .select('id, name, email, company, role_title, data_note, created_at, companies(id, stage)', {
      count: 'exact',
    })
    .order('created_at', { ascending: false });
  // Commas and parentheses have meaning in PostgREST filters, so they are removed from the search text.
  const term = (q ?? '').replace(/[,()]/g, ' ').trim().slice(0, 100);
  if (term) {
    const pattern = `%${escapeLike(term)}%`;
    query = query.or(`name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern}`);
  }
  const { data, error, count } = await query.range((current - 1) * perPage, current * perPage - 1);

  const leads = (data ?? []) as unknown as Lead[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const pageHref = (n: number) => `/leads?page=${n}${term ? `&q=${encodeURIComponent(term)}` : ''}`;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Leads</h1>
        <p className="muted">New enquiries from the website and entries added by staff. Newest first. Create a company to start tracking it in the pipeline.</p>
      </header>

      {message ? <p className="notice blocked">{message}</p> : null}
      {saved ? <p className="notice">Lead added.</p> : null}

      <form method="get" className="form-row">
        <input type="search" name="q" defaultValue={q ?? ''} placeholder="Search name, company or email" />
        <button className="btn" type="submit">Search</button>
        {canAdd ? <a className="btn" href="/api/export/leads">Export CSV</a> : null}
      </form>

      {canAdd ? (
        <details className="panel">
          <summary>Add a lead</summary>
          <form action={addLead} className="form-grid">
            <label>Name<input name="name" required maxLength={200} /></label>
            <label>Email<input name="email" type="email" required maxLength={320} /></label>
            <label>Company<input name="company" required maxLength={200} /></label>
            <label>Role<input name="role" maxLength={200} /></label>
            <label className="span-2">Notes on the data<textarea name="note" rows={3} maxLength={2000} /></label>
            <button className="btn" type="submit">Save lead</button>
          </form>
        </details>
      ) : null}

      {error ? (
        <p className="notice blocked">Could not load leads. Check your staff access.</p>
      ) : leads.length === 0 ? (
        <p className="muted">No enquiries yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Company</th>
              <th>Contact</th>
              <th>Data</th>
              <th>Pipeline stage</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const company = lead.companies?.[0];
              return (
                <tr key={lead.id}>
                  <td>{new Date(lead.created_at).toLocaleDateString('en-US')}</td>
                  <td>{lead.company}</td>
                  <td>
                    {lead.name}
                    {lead.role_title ? `, ${lead.role_title}` : ''}
                    <br />
                    <a href={`mailto:${lead.email}`}>{lead.email}</a>
                  </td>
                  <td className="wrap-cell">{lead.data_note ?? '-'}</td>
                  <td>
                    {company ? (
                      <Link href={`/companies/${company.id}`}>
                        <span className="stage">{company.stage}</span>
                      </Link>
                    ) : (
                      <span className="muted">Not yet a company</span>
                    )}
                  </td>
                  <td>
                    {company ? null : (
                      <form action={createCompanyFromLead.bind(null, lead.id)}>
                        <button className="btn" type="submit">Create company</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {pages > 1 ? (
        <nav className="filters" aria-label="Pages">
          {current > 1 ? <a href={pageHref(current - 1)}>Previous</a> : <span className="muted">Previous</span>}
          <span className="muted small">
            Page {current} of {pages} · {total} leads
          </span>
          {current < pages ? <a href={pageHref(current + 1)}>Next</a> : <span className="muted">Next</span>}
        </nav>
      ) : null}
    </main>
  );
}
