import Link from 'next/link';
import { importLeads } from '@/lib/admin-actions';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { SIC_GROUPS } from '@/lib/companies-house';
import {
  acceptCandidate,
  rejectCandidate,
  rejectWeakCandidates,
  runCompaniesHouseImport,
} from '@/lib/import-candidates';

type Candidate = {
  id: string;
  company_name: string;
  registration_number: string | null;
  incorporated_on: string | null;
  sic_codes: string[] | null;
  industry: string | null;
  score: number;
  band: string;
  reasons: unknown;
  status: string;
  region: string | null;
  locality: string | null;
  matched_company_id: string | null;
  note: string | null;
};

const BAND_CLASS: Record<string, string> = {
  strong: 'approved',
  review: 'review',
  weak: 'blocked',
};

function reasonsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((r): r is string => typeof r === 'string') : [];
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    imported?: string;
    skipped?: string;
    ran?: string;
    found?: string;
    added?: string;
    accepted?: string;
    duplicate?: string;
    cleared?: string;
  }>;
}) {
  const { error, imported, skipped, ran, found, added, accepted, duplicate, cleared } =
    await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const allowed = me?.role === 'admin' || me?.role === 'introducer';
  const keyConfigured = Boolean(process.env.COMPANIES_HOUSE_API_KEY);

  const { data: candidateData, error: candidateError } = await supabase
    .from('import_candidates')
    .select(
      'id, company_name, registration_number, incorporated_on, sic_codes, industry, score, band, reasons, status, region, locality, matched_company_id, note',
    )
    .order('status')
    .order('score', { ascending: false })
    .limit(300);

  const candidates = (candidateData ?? []) as unknown as Candidate[];
  const pending = candidates.filter((c) => c.status === 'pending');
  const strong = pending.filter((c) => c.band === 'strong').length;
  const review = pending.filter((c) => c.band === 'review').length;
  const weak = pending.filter((c) => c.band === 'weak').length;
  const decided = candidates.filter((c) => c.status !== 'pending').length;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Import</h1>
        <p className="muted">
          Two doors into the pipeline. Companies House finds UK firms that match the sectors this
          site sells to; a CSV adds named leads from anywhere else. Both land in a queue first: a
          person accepts a record before it becomes a company.
        </p>
      </header>

      {error ? <p className="notice blocked">{error}</p> : null}
      {imported ? (
        <p className="notice">Imported {imported} lead(s). Skipped {skipped ?? 0}.</p>
      ) : null}
      {ran ? (
        <p className="notice">
          Search returned {found ?? 0} firm(s); {added ?? 0} were new and are in the queue below.
          The rest were already imported, so nothing was overwritten.
        </p>
      ) : null}
      {accepted ? <p className="notice">Accepted. The company is in the pipeline at New lead.</p> : null}
      {duplicate ? (
        <p className="notice review">
          That firm is already in the CRM, so the candidate was marked a duplicate rather than
          created twice.
        </p>
      ) : null}
      {cleared ? <p className="notice">Cleared the weak candidates. They are kept for the record.</p> : null}

      <section className="panel">
        <h2>Companies House</h2>
        <p className="muted">
          A free search of the public register, filtered to active companies in the target sectors
          and incorporated before the year you choose. The register does not publish headcount, so
          size is confirmed on the call; the score ranks what it can see - sector, age, legal form
          and address - and shows its reasons.
        </p>

        {!keyConfigured ? (
          <p className="notice review">
            No Companies House key is configured. Register a free application at the Companies House
            developer hub and set <code>COMPANIES_HOUSE_API_KEY</code> on the server.
          </p>
        ) : null}

        {allowed ? (
          <form action={runCompaniesHouseImport} className="stack">
            <fieldset>
              <legend>Sectors</legend>
              {SIC_GROUPS.map((group) => (
                <label key={group.key} className="check">
                  <input
                    type="checkbox"
                    name="groups"
                    value={group.key}
                    defaultChecked={group.key === 'accounting' || group.key === 'legal'}
                  />
                  {' '}{group.label}{' '}
                  <span className="muted small">
                    (SIC {group.codes.slice(0, 2).join(', ')}; {group.minStaff}+ staff)
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="form-row">
              <label>Incorporated before
                <input
                  type="number"
                  name="incorporatedBefore"
                  min={1900}
                  max={new Date().getUTCFullYear()}
                  defaultValue={new Date().getUTCFullYear() - 10}
                  required
                />
              </label>
              <label>Location (optional)
                <input name="location" maxLength={100} placeholder="Yorkshire, or a postcode" />
              </label>
            </div>
            <button className="btn" type="submit" disabled={!keyConfigured}>
              Search the register
            </button>
          </form>
        ) : (
          <p className="muted">Your role does not include importing prospects.</p>
        )}
      </section>

      <section className="panel">
        <h2>Prospect queue</h2>

        {candidateError ? (
          <p className="notice blocked">
            The prospect queue could not load. Has migration <code>0012_prospect_import.sql</code>{' '}
            been run?
          </p>
        ) : (
          <>
            <div className="kpis" aria-label="Prospect queue figures">
              <div className="kpi"><span>Waiting</span><strong>{pending.length}</strong></div>
              <div className="kpi"><span>Strong</span><strong>{strong}</strong></div>
              <div className="kpi"><span>Worth a look</span><strong>{review}</strong></div>
              <div className="kpi"><span>Weak</span><strong>{weak}</strong></div>
              <div className="kpi"><span>Decided</span><strong>{decided}</strong></div>
              <div className="kpi"><span>Score bar</span><strong>70</strong></div>
            </div>

            {pending.length === 0 ? (
              <p className="muted">
                Nothing waiting. Run a search above, or clear the weak tail once you have imported a
                batch.
              </p>
            ) : null}

            {weak > 0 && allowed ? (
              <form action={rejectWeakCandidates} className="inline-form">
                <span className="muted small">
                  {weak} candidate(s) scored below the bar. Clearing them keeps the records and
                  empties the tail.
                </span>
                <button className="btn" type="submit">Clear the weak tail</button>
              </form>
            ) : null}

            {candidates.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Firm</th>
                    <th>Incorporated</th>
                    <th>Sector</th>
                    <th>Location</th>
                    <th>Score</th>
                    <th>Why</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const reasons = reasonsOf(c.reasons);
                    return (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.company_name}</strong>
                          {c.registration_number ? (
                            <div className="muted small">
                              <a
                                href={`https://find-and-update.company-information.service.gov.uk/company/${c.registration_number}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {c.registration_number}
                              </a>
                            </div>
                          ) : null}
                        </td>
                        <td>{c.incorporated_on ? new Date(c.incorporated_on).getUTCFullYear() : '-'}</td>
                        <td>{c.industry ?? (c.sic_codes?.join(', ') || '-')}</td>
                        <td>{c.locality ?? c.region ?? '-'}</td>
                        <td>
                          <span className={`status ${BAND_CLASS[c.band] ?? 'review'}`}>
                            {c.score} {c.band}
                          </span>
                        </td>
                        <td className="wrap-cell muted small">
                          {reasons.slice(0, 3).join(' · ') || '-'}
                          {c.note ? <div>{c.note}</div> : null}
                        </td>
                        <td>
                          {c.status === 'accepted' && c.matched_company_id ? (
                            <Link href={`/companies/${c.matched_company_id}`}>Open company</Link>
                          ) : (
                            <span className="muted small">{c.status}</span>
                          )}
                        </td>
                        <td>
                          {allowed && c.status === 'pending' ? (
                            <div className="inline-form">
                              <form action={acceptCandidate.bind(null, c.id)}>
                                <button className="btn" type="submit">Accept</button>
                              </form>
                              <form action={rejectCandidate.bind(null, c.id)} className="inline-form">
                                <input name="note" placeholder="Reason" maxLength={1000} />
                                <button className="btn" type="submit">Reject</button>
                              </form>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </>
        )}
      </section>

      <section className="panel">
        <h2>Leads from CSV</h2>
        <p className="muted">
          Paste CSV with a header row. Required columns: name, email, company. Optional: role, note.
          Rows with a missing or invalid email, or a duplicate email in the same file, are skipped. Up to 500 rows.
        </p>

        {allowed ? (
          <form action={importLeads} className="form-grid">
            <label className="span-2">
              CSV
              <textarea
                name="csv"
                rows={12}
                required
                placeholder={'name,email,company,role,note\nJane Doe,jane@example.com,Acme Ltd,Head of Data,Sells anonymised purchase data'}
              />
            </label>
            <button className="btn" type="submit">Import</button>
          </form>
        ) : (
          <p className="muted">Your role does not include importing leads.</p>
        )}
      </section>
    </main>
  );
}
