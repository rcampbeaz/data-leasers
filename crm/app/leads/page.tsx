import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { createCompanyFromLead } from '@/lib/actions';

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
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: message } = await searchParams;
  const supabase = await createStaffClient();
  // The company's stage is read from the company record, so it is always current.
  const { data, error } = await supabase
    .from('leads')
    .select('id, name, email, company, role_title, data_note, created_at, companies(id, stage)')
    .order('created_at', { ascending: false });

  const leads = (data ?? []) as unknown as Lead[];

  return (
    <main className="page">
      <header className="page-head">
        <h1>Leads</h1>
        <p className="muted">New enquiries from the website. Newest first. Create a company to start tracking it in the pipeline.</p>
      </header>

      {message ? <p className="notice blocked">{message}</p> : null}

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
                  <td>{new Date(lead.created_at).toLocaleDateString('en-GB')}</td>
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
    </main>
  );
}
