import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { addPartner, anonymisePartner, registerReferral, updateReferral } from '@/lib/deal-actions';
import { REFERRAL_STATUSES, daysUntil, money, referralFee } from '@/lib/deals';
import { BUCKET_LABELS, buildPartnerReport } from '@/lib/partner-report';

type Partner = {
  id: string;
  name: string;
  email: string | null;
  organisation: string | null;
  fee_rate: number;
  fee_floor: number;
  erased_at?: string | null;
};

type Referral = {
  id: string;
  partner_id: string;
  company_id: string | null;
  company_name: string;
  registered_on: string;
  deadline_on: string;
  status: string;
  fee_amount: number | null;
  paid_on: string | null;
};

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; erased?: string }>;
}) {
  const { error, saved, erased } = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const canEdit = me?.role === 'admin' || me?.role === 'introducer';
  const isAdmin = me?.role === 'admin';

  const [{ data: partners, error: partnersError }, { data: referrals }, { data: offers }, { data: companies }] =
    await Promise.all([
      // Every column, so the page still renders if 0008 has not been run yet.
      supabase.from('partners').select('*').order('name'),
      supabase
        .from('referrals')
        .select('id, partner_id, company_id, company_name, registered_on, deadline_on, status, fee_amount, paid_on')
        .order('registered_on', { ascending: false }),
      supabase.from('offers').select('company_id, amount, currency, status'),
      supabase.from('companies').select('id, name').order('name'),
    ]);

  const partnerRows = (partners ?? []) as Partner[];
  const referralRows = (referrals ?? []) as Referral[];
  const offerRows = (offers ?? []) as { company_id: string; amount: number; currency: string; status: string }[];

  const acceptedValue = new Map<string, number>();
  for (const offer of offerRows) {
    if (offer.status !== 'accepted') continue;
    acceptedValue.set(
      offer.company_id,
      Math.max(acceptedValue.get(offer.company_id) ?? 0, Number(offer.amount)),
    );
  }

  const partnerName = new Map(partnerRows.map((p) => [p.id, p.name]));
  const partnerById = new Map(partnerRows.map((p) => [p.id, p]));

  const openReferrals = referralRows.filter((r) => ['registered', 'introduced'].includes(r.status));
  const atRisk = openReferrals.filter((r) => daysUntil(r.deadline_on) <= 30);

  const report = buildPartnerReport(
    openReferrals.map((r) => ({
      id: r.id,
      company_id: r.company_id,
      company_name: r.company_name,
      partnerName: partnerName.get(r.partner_id) ?? 'Unknown partner',
      deadline_on: r.deadline_on,
      status: r.status,
    })),
  );

  return (
    <main className="page">
      <header className="page-head">
        <h1>Referral partners</h1>
        <p className="muted">
          The fee is the percentage or the floor, whichever is larger, paid by the buyer after it has
          paid the company. The website gives a partner six months from registration for the
          agreement to be signed, so every referral carries its deadline.
        </p>
      </header>

      {error ? <p className="notice blocked">{error}</p> : null}
      {saved ? <p className="notice">Saved.</p> : null}
      {erased ? (
        <p className="notice">
          Partner anonymised. Their name, email and notes are gone; the referral ledger and the fees
          on it are unchanged.
        </p>
      ) : null}
      {atRisk.length > 0 ? (
        <p className="notice review">
          {atRisk.length} open {atRisk.length === 1 ? 'referral is' : 'referrals are'} inside 30 days
          of the six-month deadline.
        </p>
      ) : null}

      {canEdit ? (
        <details className="panel">
          <summary>Add a partner</summary>
          <form action={addPartner} className="form-grid">
            <label>
              Name
              <input name="name" required maxLength={200} />
            </label>
            <label>
              Email
              <input name="email" type="email" maxLength={320} />
            </label>
            <label>
              Organisation
              <input name="organisation" maxLength={200} />
            </label>
            <label>
              Fee rate (%)
              <input name="feeRate" inputMode="decimal" defaultValue="6" />
            </label>
            <label>
              Fee floor (USD)
              <input name="feeFloor" inputMode="numeric" defaultValue="50000" />
            </label>
            <label className="span-2">
              Notes
              <textarea name="notes" rows={2} maxLength={2000} />
            </label>
            <button className="btn" type="submit">
              Save partner
            </button>
          </form>
        </details>
      ) : null}

      <section className="panel">
        <h2>Partners</h2>
        {partnersError ? (
          <p className="notice blocked">Could not load partners. Check your staff access.</p>
        ) : partnerRows.length === 0 ? (
          <p className="muted">No partners yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Partner</th>
                <th>Contact</th>
                <th>Rate</th>
                <th>Referrals</th>
                <th>Paid to date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {partnerRows.map((partner) => {
                const mine = referralRows.filter((r) => r.partner_id === partner.id);
                const paid = mine
                  .filter((r) => r.status === 'paid')
                  .reduce((total, r) => total + Number(r.fee_amount ?? 0), 0);
                return (
                  <tr key={partner.id}>
                    <td>
                      {partner.name}
                      {partner.organisation ? <span className="muted"> · {partner.organisation}</span> : null}
                      {partner.erased_at ? <span className="muted"> · details erased on request</span> : null}
                    </td>
                    <td>{partner.email ?? '-'}</td>
                    <td>
                      {(Number(partner.fee_rate) * 100).toFixed(0)}% or {money(partner.fee_floor)}
                    </td>
                    <td>
                      {mine.length}
                      {mine.length >= 5 ? <span className="muted"> · confirm the rate after the fifth</span> : null}
                    </td>
                    <td>{paid ? money(paid) : '-'}</td>
                    <td>
                      {isAdmin && !partner.erased_at ? (
                        <form action={anonymisePartner.bind(null, partner.id)} className="inline-form">
                          <button className="btn" type="submit">
                            Erase details
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {canEdit ? (
        <details className="panel">
          <summary>Register a referral</summary>
          <form action={registerReferral} className="form-grid">
            <label>
              Partner
              <select name="partnerId" required defaultValue="">
                <option value="">Choose a partner</option>
                {partnerRows
                  .filter((p) => !p.erased_at)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Company on file (optional)
              <select name="companyId" defaultValue="">
                <option value="">Not in the CRM yet</option>
                {(companies ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Company name
              <input name="companyName" required maxLength={200} />
            </label>
            <label>
              Registered on
              <input type="date" name="registeredOn" defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
            <label className="span-2">
              Notes
              <input name="notes" maxLength={2000} placeholder="What was agreed with the partner" />
            </label>
            <button className="btn" type="submit">
              Register referral
            </button>
          </form>
          <p className="muted small-note">The deadline is set to six months from the registration date.</p>
        </details>
      ) : null}

      <section className="panel">
        <h2>Weekly deadline report</h2>
        <p className="muted">
          Open referrals ordered by how long is left on the six-month window. This is the same
          report that is emailed to admins and introducers on Monday morning, so what is on screen
          and what lands in the inbox agree.
        </p>

        <div className="kpis" aria-label="Referral deadline figures">
          <div className="kpi"><span>Open</span><strong>{report.openTotal}</strong></div>
          <div className="kpi">
            <span>Past deadline</span>
            <strong className={report.counts.overdue ? 'overdue' : ''}>{report.counts.overdue}</strong>
          </div>
          <div className="kpi">
            <span>Inside 7 days</span>
            <strong className={report.counts.week ? 'overdue' : ''}>{report.counts.week}</strong>
          </div>
          <div className="kpi"><span>Inside 30 days</span><strong>{report.counts.month}</strong></div>
        </div>

        {report.rows.length === 0 ? (
          <p className="muted">No open referrals, so nothing is running out of time.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Partner</th>
                <th>Status</th>
                <th>Deadline</th>
                <th>Time left</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {report.rows.slice(0, 25).map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.company_id ? (
                      <Link href={`/companies/${row.company_id}`}>{row.company_name}</Link>
                    ) : (
                      row.company_name
                    )}
                  </td>
                  <td>{row.partnerName}</td>
                  <td><span className="stage">{row.status}</span></td>
                  <td>{String(row.deadline_on).slice(0, 10)}</td>
                  <td>
                    <span
                      className={`status ${row.bucket === 'overdue' ? 'blocked' : row.bucket === 'week' || row.bucket === 'month' ? 'review' : 'approved'}`}
                    >
                      {row.daysLeft === null
                        ? 'no deadline'
                        : row.daysLeft < 0
                          ? `${Math.abs(row.daysLeft)}d overdue`
                          : `${row.daysLeft}d`}
                    </span>
                  </td>
                  <td className="muted small">{BUCKET_LABELS[row.bucket]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Registered referrals</h2>
        {referralRows.length === 0 ? (
          <p className="muted">Nothing referred yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Partner</th>
                <th>Registered</th>
                <th>Deadline</th>
                <th>Status</th>
                <th>Fee</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {referralRows.map((referral) => {
                const partner = partnerById.get(referral.partner_id);
                const days = daysUntil(referral.deadline_on);
                const open = ['registered', 'introduced'].includes(referral.status);
                const accepted = referral.company_id ? acceptedValue.get(referral.company_id) ?? null : null;
                const estimate = partner ? referralFee(accepted, Number(partner.fee_rate), Number(partner.fee_floor)) : null;
                return (
                  <tr key={referral.id}>
                    <td>
                      {referral.company_id ? (
                        <Link href={`/companies/${referral.company_id}`}>{referral.company_name}</Link>
                      ) : (
                        referral.company_name
                      )}
                    </td>
                    <td>{partnerName.get(referral.partner_id) ?? 'Unknown'}</td>
                    <td>{referral.registered_on}</td>
                    <td className={open && days <= 30 ? 'overdue' : ''}>
                      {referral.deadline_on}
                      {open ? <span className="muted small"> ({days}d)</span> : null}
                    </td>
                    <td>
                      <span className="stage">{referral.status}</span>
                    </td>
                    <td>
                      {referral.fee_amount ? (
                        money(referral.fee_amount)
                      ) : estimate ? (
                        <span className="muted">est. {money(estimate)}</span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      {canEdit ? (
                        <form action={updateReferral} className="inline-form">
                          <input type="hidden" name="id" value={referral.id} />
                          <select name="status" defaultValue={referral.status}>
                            {REFERRAL_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <input name="feeAmount" placeholder="Fee" inputMode="decimal" maxLength={12} />
                          <button className="btn" type="submit">
                            Update
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
