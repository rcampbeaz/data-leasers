import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createStaffClient } from '@/lib/supabase';
import { loadStaff, todayIso } from '@/lib/data';
import { STAGES, normalizeStage, suggestStage, type DatasetStatus, type Stage } from '@/lib/pipeline';
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
import {
  addAgreement,
  addDocument,
  addIntroduction,
  addOffer,
  removeDocument,
  setOfferStatus,
} from '@/lib/deal-actions';
import { money } from '@/lib/deals';

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
    .select('id, name, stage, close_reason, source, owner_id, introduced_by, next_action, next_action_due, lead_id, created_at, legal_name, website, industry, employee_count, founded_year, registration_number, phone, country, staff_countries, address_line1, address_line2, city, region, postal_code')
    .eq('id', id)
    .maybeSingle();
  if (!company) notFound();

  const [
    contacts,
    activities,
    datasets,
    tasks,
    history,
    staff,
    buyers,
    introductions,
    offers,
    agreements,
    documents,
  ] = await Promise.all([
    supabase.from('contacts').select('id, name, email, role_title').eq('company_id', id).order('created_at'),
    supabase.from('activities').select('id, kind, body, call_at, created_at').eq('company_id', id).order('created_at', { ascending: false }),
    supabase.from('datasets').select('id, name, status, status_reason').eq('company_id', id).order('created_at'),
    supabase.from('tasks').select('id, title, due_on, done, assigned_to').eq('company_id', id).order('due_on'),
    supabase.from('stage_history').select('from_stage, to_stage, changed_at').eq('company_id', id).order('changed_at', { ascending: false }),
    loadStaff(supabase),
    supabase.from('buyers').select('id, name, active').order('name'),
    supabase
      .from('introductions')
      .select('id, buyer_id, introduced_on, introduced_by, notes')
      .eq('company_id', id)
      .order('introduced_on', { ascending: false }),
    supabase
      .from('offers')
      .select('id, buyer_id, amount, currency, term_months, exclusivity_months, status, offered_on')
      .eq('company_id', id)
      .order('offered_on', { ascending: false }),
    supabase
      .from('agreements')
      .select('id, buyer_id, licence_start, licence_end, exclusivity_end, delivered_on, deletion_due, audit_right, status, signed_on')
      .eq('company_id', id)
      .order('licence_start', { ascending: false }),
    supabase
      .from('documents')
      .select('id, kind, title, location, signed_on')
      .eq('company_id', id)
      .order('created_at', { ascending: false }),
  ]);

  const staffName = (uid: string | null) => staff.find((s) => s.user_id === uid)?.full_name ?? '-';
  const buyerList = (buyers.data ?? []) as { id: string; name: string; active: boolean }[];
  const buyerName = (buyerId: string | null) =>
    buyerList.find((b) => b.id === buyerId)?.name ?? 'Unknown buyer';

  // Suggested stage: shown for a person to confirm, never applied here.
  const datasetRows = (datasets.data ?? []).map((d) => ({ status: d.status as DatasetStatus }));
  const suggestion = suggestStage({
    stage: normalizeStage(company.stage),
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
  const addIntroductionWithId = addIntroduction.bind(null, id);
  const addOfferWithId = addOffer.bind(null, id);
  const addAgreementWithId = addAgreement.bind(null, id);
  const addDocumentWithId = addDocument.bind(null, id);

  return (
    <main className="page">
      <header className="page-head">
        <p className="muted small"><Link href="/companies">Companies</Link> / {company.name}</p>
        <nav className="crumbs" aria-label="Breadcrumb">
          <a href="/companies">Companies</a> <span aria-hidden="true">›</span>
        </nav>
        <h1>{company.name}</h1>
        <p>
          <span className="stage">{normalizeStage(company.stage)}</span>
          {company.close_reason ? <span className="muted"> ({company.close_reason})</span> : null}
          {process.env.BOOKING_URL ? (
            <> · <a href={process.env.BOOKING_URL} target="_blank" rel="noreferrer">Book a call</a></>
          ) : null}
        </p>
      </header>

      {error ? <p className="notice blocked">{error}</p> : null}
      {suggestionOnly ? (
        <p className="notice review">Suggested next stage: {suggestionOnly.to}. {suggestionOnly.reason}</p>
      ) : null}

      <div className="two-col">
        <section className="panel">
          <h2>Stage</h2>
          <form action={moveStageWithId} className="inline-form">
            <select name="stage" defaultValue={normalizeStage(company.stage)}>
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
        <h2>Company profile</h2>
        <p className="muted small">
          What a buyer asks for before it will look at records: the registered entity, where it is,
          how many people work there and which countries they work in.
        </p>
        <form action={updateCompanyWithId} className="stack">
          <label>Registered legal name
            <input name="legalName" defaultValue={company.legal_name ?? ''} maxLength={200} />
          </label>
          <label>Website
            <input name="website" defaultValue={company.website ?? ''} maxLength={300} placeholder="https://" />
          </label>
          <label>Industry
            <input name="industry" defaultValue={company.industry ?? ''} maxLength={100} placeholder="Accounting, law, medical, software" />
          </label>
          <label>Employees
            <input type="number" name="employeeCount" defaultValue={company.employee_count ?? ''} min={0} max={1000000} />
          </label>
          <label>Founded
            <input type="number" name="foundedYear" defaultValue={company.founded_year ?? ''} min={1800} max={2200} />
          </label>
          <label>Registration number
            <input name="registrationNumber" defaultValue={company.registration_number ?? ''} maxLength={100} />
          </label>
          <label>Phone
            <input name="phone" defaultValue={company.phone ?? ''} maxLength={60} />
          </label>
          <label>Address line 1
            <input name="addressLine1" defaultValue={company.address_line1 ?? ''} maxLength={200} />
          </label>
          <label>Address line 2
            <input name="addressLine2" defaultValue={company.address_line2 ?? ''} maxLength={200} />
          </label>
          <label>City
            <input name="city" defaultValue={company.city ?? ''} maxLength={120} />
          </label>
          <label>State or region
            <input name="region" defaultValue={company.region ?? ''} maxLength={120} />
          </label>
          <label>Postal code
            <input name="postalCode" defaultValue={company.postal_code ?? ''} maxLength={30} />
          </label>
          <label>Country (two letters)
            <input name="country" defaultValue={company.country ?? ''} maxLength={2} placeholder="US" />
          </label>
          <label>Countries the staff work in
            <input name="staffCountries" defaultValue={(company.staff_countries ?? []).join(', ')} placeholder="US, CA" />
          </label>
          <p className="muted small">
            Staff countries, not the head office: the published rule is about where the people are.
          </p>
          <button className="btn" type="submit">Save profile</button>
        </form>
      </section>

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

      <section className="panel">
        <h2>Introductions to buyers</h2>
        {(introductions.data ?? []).length === 0 ? (
          <p className="muted">No introductions yet. A company cannot move past Data assessed without one.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Buyer</th><th>Introduced</th><th>By</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {(introductions.data ?? []).map((intro) => (
                <tr key={intro.id}>
                  <td>{buyerName(intro.buyer_id)}</td>
                  <td>{intro.introduced_on}</td>
                  <td>{staffName(intro.introduced_by)}</td>
                  <td className="wrap-cell">{intro.notes ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={addIntroductionWithId} className="inline-form">
          <select name="buyerId" required defaultValue="">
            <option value="">Choose a buyer</option>
            {buyerList.filter((b) => b.active).map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <input type="date" name="introducedOn" defaultValue={todayIso()} />
          <input name="notes" placeholder="Notes" maxLength={2000} />
          <button className="btn" type="submit">Record introduction</button>
        </form>
      </section>

      <section className="panel">
        <h2>Offers</h2>
        {(offers.data ?? []).length === 0 ? (
          <p className="muted">No offers recorded yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Buyer</th><th>Amount</th><th>Term</th><th>Exclusivity</th><th>Offered</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(offers.data ?? []).map((offer) => (
                <tr key={offer.id}>
                  <td>{buyerName(offer.buyer_id)}</td>
                  <td>{money(offer.amount, offer.currency)}</td>
                  <td>{offer.term_months ? `${offer.term_months} months` : '-'}</td>
                  <td>{offer.exclusivity_months ? `${offer.exclusivity_months} months` : '-'}</td>
                  <td>{offer.offered_on}</td>
                  <td><span className="stage">{offer.status}</span></td>
                  <td>
                    <form action={setOfferStatus.bind(null, id, offer.id)} className="inline-form">
                      <select name="status" defaultValue={offer.status}>
                        <option>offered</option><option>accepted</option><option>declined</option><option>withdrawn</option>
                      </select>
                      <button className="btn" type="submit">Set</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={addOfferWithId} className="form-grid">
          <label>Buyer
            <select name="buyerId" required defaultValue="">
              <option value="">Choose a buyer</option>
              {buyerList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>Amount
            <input name="amount" inputMode="decimal" required placeholder="250000" />
          </label>
          <label>Currency
            <input name="currency" defaultValue="USD" maxLength={3} />
          </label>
          <label>Offered on
            <input type="date" name="offeredOn" defaultValue={todayIso()} />
          </label>
          <label>Term (months)
            <input name="termMonths" inputMode="numeric" maxLength={3} />
          </label>
          <label>Exclusivity (months)
            <input name="exclusivityMonths" inputMode="numeric" maxLength={3} />
          </label>
          <label className="span-2">Notes
            <input name="notes" maxLength={2000} />
          </label>
          <button className="btn" type="submit">Record offer</button>
        </form>
      </section>

      <section className="panel">
        <h2>Agreement and term dates</h2>
        {(agreements.data ?? []).length === 0 ? (
          <p className="muted">No agreement recorded yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Buyer</th><th>Start</th><th>Ends</th><th>Exclusivity to</th><th>Deletion due</th><th>Audit</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(agreements.data ?? []).map((agreement) => (
                <tr key={agreement.id}>
                  <td>{buyerName(agreement.buyer_id)}</td>
                  <td>{agreement.licence_start}</td>
                  <td>{agreement.licence_end ?? '-'}</td>
                  <td>{agreement.exclusivity_end ?? '-'}</td>
                  <td>{agreement.deletion_due ?? '-'}</td>
                  <td>{agreement.audit_right ? 'Yes' : 'No'}</td>
                  <td><span className="stage">{agreement.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={addAgreementWithId} className="form-grid">
          <label>Buyer
            <select name="buyerId" defaultValue="">
              <option value="">Choose a buyer</option>
              {buyerList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>Licence start
            <input type="date" name="licenceStart" required defaultValue={todayIso()} />
          </label>
          <label>Licence term (months)
            <input name="licenceMonths" inputMode="numeric" maxLength={3} />
          </label>
          <label>Exclusivity (months)
            <input name="exclusivityMonths" inputMode="numeric" maxLength={3} />
          </label>
          <label>Delivered on
            <input type="date" name="deliveredOn" />
          </label>
          <label>Signed on
            <input type="date" name="signedOn" defaultValue={todayIso()} />
          </label>
          <label className="span-2">
            <span><input type="checkbox" name="auditRight" /> Audit right included</span>
          </label>
          <button className="btn" type="submit">Record agreement</button>
        </form>
        <p className="muted small-note">The deletion date is set to 120 days after delivery, the term the buyer program publishes.</p>
      </section>

      <section className="panel">
        <h2>Documents</h2>
        {(documents.data ?? []).length === 0 ? (
          <p className="muted">No documents recorded. The rights file and the signed agreement belong here.</p>
        ) : (
          <ul className="list">
            {(documents.data ?? []).map((doc) => (
              <li key={doc.id}>
                <strong>{doc.title}</strong> · {doc.kind}
                {doc.signed_on ? ` · signed ${doc.signed_on}` : ''}
                {doc.location ? <> · <a href={doc.location} target="_blank" rel="noreferrer">Open</a></> : null}
                {' '}
                <form action={removeDocument.bind(null, id, doc.id)} style={{ display: 'inline' }}>
                  <button className="link-button" type="submit">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addDocumentWithId} className="form-grid">
          <label>Type
            <select name="kind" defaultValue="rights-file">
              <option value="rights-file">Rights file</option>
              <option value="agreement">Agreement</option>
              <option value="nda">NDA</option>
              <option value="export-manifest">Export manifest</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>Title
            <input name="title" required maxLength={200} />
          </label>
          <label className="span-2">Link
            <input name="location" maxLength={1000} placeholder="https://..." />
          </label>
          <label>Signed on
            <input type="date" name="signedOn" />
          </label>
          <label>Notes
            <input name="notes" maxLength={2000} />
          </label>
          <button className="btn" type="submit">Save document</button>
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
