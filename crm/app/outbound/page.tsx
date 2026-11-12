import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import {
  BASIS_LABELS,
  SUPPORTED_COUNTRIES,
  COUNTRY_NOTES,
  senderConfigured,
  type Basis,
} from '@/lib/outbound';
import {
  addContact,
  addStep,
  addStepFromTemplate,
  approveEnrolment,
  createSequence,
  deleteStep,
  enrolContact,
  stopEnrolment,
  suppressAddress,
  updateStep,
} from '@/lib/outbound-actions';

type Named = { name?: string | null; email?: string | null } | null;

function label(value: unknown, key: 'name' | 'email' = 'name'): string {
  const row = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null;
  const text = row?.[key];
  return typeof text === 'string' && text ? text : '—';
}

export default async function OutboundPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    added?: string;
    sequence?: string;
    step?: string;
    enrolled?: string;
    suppressed?: string;
    updated?: string;
    deleted?: string;
  }>;
}) {
  const sp = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const isAdmin = me?.role === 'admin';
  const canWrite = isAdmin || me?.role === 'introducer';

  const [{ data: contacts }, { data: sequences }, { data: enrollments }, { data: sends }, { data: suppressions }, { data: companies }, { data: templates }] =
    await Promise.all([
      supabase
        .from('outreach_contacts')
        .select('id, email, full_name, country, basis, status, company:companies(name)')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('sequences')
        .select('id, name, active, steps:sequence_steps(id, position, delay_days, kind, subject, body)')
        .order('created_at', { ascending: false }),
      supabase
        .from('sequence_enrolments')
        .select('id, status, next_due_on, current_position, approved_at, stopped_reason, sequence:sequences(name), contact:outreach_contacts(email, country)')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('outbound_sends')
        .select('id, subject, status, error, sent_at, contact:outreach_contacts(email)')
        .order('sent_at', { ascending: false })
        .limit(20),
      supabase.from('suppressions').select('email', { count: 'exact', head: true }),
      supabase.from('companies').select('id, name').order('name').limit(200),
      supabase.from('email_templates').select('id, name, purpose').order('name'),
    ]);

  const contactRows = (contacts ?? []) as unknown as {
    id: string;
    email: string;
    full_name: string | null;
    country: string | null;
    basis: string;
    status: string;
    company: Named;
  }[];
  const sequenceRows = (sequences ?? []) as unknown as {
    id: string;
    name: string;
    active: boolean;
    steps: {
      id: string;
      position: number;
      delay_days: number;
      kind: string;
      subject: string;
      body: string | null;
    }[] | null;
  }[];
  const enrollmentRows = (enrollments ?? []) as unknown as {
    id: string;
    status: string;
    next_due_on: string | null;
    current_position: number;
    approved_at: string | null;
    stopped_reason: string | null;
    sequence: Named;
    contact: Named;
  }[];
  const sendRows = (sends ?? []) as unknown as {
    id: number;
    subject: string;
    status: string;
    error: string | null;
    sent_at: string;
    contact: Named;
  }[];
  const companyRows = (companies ?? []) as { id: string; name: string }[];
  const templateRows = (templates ?? []) as { id: string; name: string; purpose: string }[];
  const suppressedCount = (suppressions as unknown as { count: number | null })?.count ?? 0;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Outbound</h1>
        <p className="muted">
          Cold email with the rules built in: a recorded lawful basis per contact, a global
          suppression list, and nothing sent until a person approves the enrolment.
        </p>
      </header>

      {sp.error ? <p className="notice blocked">{sp.error}</p> : null}
      {sp.added ? <p className="notice">Contact added.</p> : null}
      {sp.sequence ? <p className="notice">Sequence created. Add a first step below.</p> : null}
      {sp.step ? <p className="notice">Step added.</p> : null}
      {sp.updated ? <p className="notice">Step updated.</p> : null}
      {sp.deleted ? <p className="notice">Step deleted and the remaining positions renumbered.</p> : null}
      {sp.enrolled ? <p className="notice">Enrolled. Approve it in the queue before anything sends.</p> : null}
      {sp.suppressed ? <p className="notice">Address suppressed. It will not be contacted again.</p> : null}

      <section className="panel">
        <h2>Sending status</h2>
        <p>
          Sender and postal address: <strong>{senderConfigured() ? 'configured' : 'not configured'}</strong>.
          {' '}Suppressed addresses: <strong>{suppressedCount}</strong>.
        </p>
        {!senderConfigured() ? (
          <p className="notice review">
            Nothing can send until <code>RESEND_API_KEY</code>, <code>OUTBOUND_FROM_EMAIL</code> and
            {' '}<code>POSTAL_ADDRESS</code> are set on the server. The cron route refuses rather than
            mailing without them, because a postal address is a legal requirement in every market here.
          </p>
        ) : null}
        <p className="muted small">
          Use a separate sending subdomain for prospect mail, authenticate it with SPF, DKIM and DMARC,
          and ramp volume slowly. Sending cold mail from the domain that sends client email puts both at risk.
        </p>
      </section>

      {canWrite ? (
        <section className="panel">
          <h2>Add a contact</h2>
          <p className="muted small">
            The basis is not a formality: the US allows opt-out, Canada and Australia require consent,
            and the UK allows corporate subscribers. The guard refuses a basis that is not lawful for
            the country on the record.
          </p>
          <form action={addContact} className="stack">
            <label>Email
              <input type="email" name="email" required maxLength={320} />
            </label>
            <label>Name
              <input name="fullName" maxLength={200} />
            </label>
            <label>Role
              <input name="roleTitle" maxLength={200} placeholder="Managing partner, CFO, Practice manager" />
            </label>
            <label>Country
              <select name="country" required defaultValue="US">
                {SUPPORTED_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>Lawful basis
              <select name="basis" required defaultValue="opt_out_only">
                {(Object.keys(BASIS_LABELS) as Basis[]).map((b) => (
                  <option key={b} value={b}>{BASIS_LABELS[b]}</option>
                ))}
              </select>
            </label>
            <label>Basis note
              <input name="basisNote" maxLength={1000} placeholder="Where the address was published, or how consent was given" />
            </label>
            <label>Source URL
              <input name="sourceUrl" maxLength={1000} placeholder="https://firm.example/team" />
            </label>
            <label>Linked company (optional)
              <select name="companyId" defaultValue="">
                <option value="">None</option>
                {companyRows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button className="btn" type="submit">Add contact</button>
          </form>
          <p className="muted small">
            Country rules: {SUPPORTED_COUNTRIES.map((c) => `${c} — ${COUNTRY_NOTES[c]}`).join(' ')}
          </p>
        </section>
      ) : null}

      <section className="panel">
        <h2>Contacts ({contactRows.length})</h2>
        {contactRows.length === 0 ? <p className="muted">No contacts yet.</p> : (
          <table className="table">
            <thead>
              <tr><th>Email</th><th>Company</th><th>Country</th><th>Basis</th><th>Status</th></tr>
            </thead>
            <tbody>
              {contactRows.map((c) => (
                <tr key={c.id}>
                  <td>{c.email}</td>
                  <td>{c.company ? label(c.company) : '—'}</td>
                  <td>{c.country ?? '—'}</td>
                  <td>{BASIS_LABELS[c.basis as Basis]?.split('(')[0] ?? c.basis}</td>
                  <td><span className={`status ${c.status === 'active' ? 'approved' : c.status === 'replied' ? 'review' : 'blocked'}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Sequences</h2>
        {sequenceRows.length === 0 ? <p className="muted">No sequences yet.</p> : null}
        {sequenceRows.map((s) => (
          <article key={s.id} className="panel">
            <header><strong>{s.name}</strong> <span className="muted">{s.active ? 'active' : 'off'}</span></header>
            <ol className="muted small">
              {(s.steps ?? []).sort((a, b) => a.position - b.position).map((step) => (
                <li key={step.id}>
                  {step.kind === 'linkedin_task' ? (
                    <span className="status review">LinkedIn task</span>
                  ) : null}{' '}
                  day +{step.delay_days} · {step.subject}
                  {isAdmin ? (
                    <details>
                      <summary className="small">Edit or delete</summary>
                      <form action={updateStep.bind(null, step.id)} className="stack">
                        <label>Type
                          <select name="kind" defaultValue={step.kind}>
                            <option value="email">Email</option>
                            <option value="linkedin_task">LinkedIn task</option>
                          </select>
                        </label>
                        <label>Delay in days
                          <input type="number" name="delayDays" min={0} max={60} defaultValue={step.delay_days} />
                        </label>
                        <label>Subject
                          <input name="subject" defaultValue={step.subject} required maxLength={300} />
                        </label>
                        <label>Body (ignored by a LinkedIn task)
                          <textarea name="body" defaultValue={step.body ?? ''} rows={6} maxLength={8000} />
                        </label>
                        <button className="btn" type="submit">Save step</button>
                      </form>
                      <form action={deleteStep.bind(null, step.id)}>
                        <button className="btn danger" type="submit">Delete step</button>
                      </form>
                      <p className="muted small">
                        Deleting closes the gap in positions, because the sender treats a missing
                        position as the end of the sequence. It is refused while any live enrolment
                        is still before this step, since renumbering would move the step they are
                        due to receive.
                      </p>
                    </details>
                  ) : null}
                </li>
              ))}
            </ol>
            {isAdmin && templateRows.length > 0 ? (
              <form action={addStepFromTemplate.bind(null, s.id)} className="inline-form">
                <select name="templateId" required defaultValue="">
                  <option value="">Add from a template…</option>
                  {templateRows.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <label className="small muted">
                  Delay (days)
                  <input
                    type="number"
                    name="delayDays"
                    min={0}
                    max={60}
                    defaultValue={(s.steps?.length ?? 0) === 0 ? 0 : 3}
                  />
                </label>
                <button className="btn" type="submit">Add step from template</button>
              </form>
            ) : null}

            {isAdmin ? (
              <form action={addStep.bind(null, s.id)} className="stack">
                <label>Type
                  <select name="kind" defaultValue="email">
                    <option value="email">Email</option>
                    <option value="linkedin_task">LinkedIn task (creates a task, sends nothing)</option>
                  </select>
                </label>
                <label>Delay in days
                  <input type="number" name="delayDays" min={0} max={60} defaultValue={0} />
                </label>
                <label>Subject
                  <input name="subject" required maxLength={300} />
                </label>
                <label>Body (required for email, optional for a task)
                  <textarea name="body" rows={5} maxLength={8000} />
                </label>
                <button className="btn" type="submit">Add step</button>
              </form>
            ) : null}
          </article>
        ))}

        {isAdmin ? (
          <form action={createSequence} className="inline-form">
            <input name="name" placeholder="Sequence name" required maxLength={200} />
            <input name="description" placeholder="What it is for" maxLength={1000} />
            <button className="btn" type="submit">Create sequence</button>
          </form>
        ) : null}
      </section>

      {canWrite ? (
        <section className="panel">
          <h2>Enrol a contact</h2>
          <form action={enrolContact} className="inline-form">
            <select name="contactId" required defaultValue="">
              <option value="">Choose a contact</option>
              {contactRows.filter((c) => c.status === 'active').map((c) => (
                <option key={c.id} value={c.id}>{c.email}</option>
              ))}
            </select>
            <select name="sequenceId" required defaultValue="">
              <option value="">Choose a sequence</option>
              {sequenceRows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn" type="submit">Enrol</button>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <h2>Queue</h2>
        {enrollmentRows.length === 0 ? <p className="muted">Nobody is enrolled yet.</p> : (
          <table className="table">
            <thead>
              <tr><th>Contact</th><th>Sequence</th><th>Step</th><th>Due</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {enrollmentRows.map((e) => (
                <tr key={e.id}>
                  <td>{label(e.contact, 'email')}</td>
                  <td>{label(e.sequence)}</td>
                  <td>{e.current_position}</td>
                  <td>{e.next_due_on ?? '—'}</td>
                  <td>
                    <span className={`status ${e.status === 'completed' ? 'approved' : e.status === 'stopped' || e.status === 'replied' ? 'blocked' : 'review'}`}>
                      {e.status === 'pending_approval' ? 'needs approval' : e.status}
                    </span>
                    {e.stopped_reason ? <span className="muted small"> {e.stopped_reason}</span> : null}
                  </td>
                  <td>
                    {canWrite && e.status === 'pending_approval' ? (
                      <form action={approveEnrolment.bind(null, e.id)}>
                        <button className="btn" type="submit">Approve first send</button>
                      </form>
                    ) : null}
                    {canWrite && ['pending_approval', 'active', 'sending', 'paused'].includes(e.status) ? (
                      <form action={stopEnrolment.bind(null, e.id, 'replied')}>
                        <button className="btn" type="submit">Replied — stop</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Suppression and history</h2>
        {canWrite ? (
          <form action={suppressAddress} className="inline-form">
            <input type="email" name="email" placeholder="Email to suppress" required maxLength={320} />
            <select name="reason" defaultValue="manual">
              <option value="manual">Manual</option>
              <option value="unsubscribed">Unsubscribed</option>
              <option value="bounced">Bounced</option>
              <option value="complaint">Complaint</option>
              <option value="not_a_fit">Not a fit</option>
            </select>
            <input name="note" placeholder="Note" maxLength={1000} />
            <button className="btn" type="submit">Suppress</button>
          </form>
        ) : null}
        {sendRows.length === 0 ? <p className="muted">Nothing sent yet.</p> : (
          <table className="table">
            <thead><tr><th>Sent</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
            <tbody>
              {sendRows.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.sent_at).toLocaleString('en-US')}</td>
                  <td>{label(s.contact, 'email')}</td>
                  <td className="wrap-cell">{s.subject}</td>
                  <td>
                    <span className={`status ${s.status === 'sent' ? 'approved' : s.status === 'failed' ? 'blocked' : 'review'}`}>{s.status}</span>
                    {s.error ? <span className="muted small"> {s.error.slice(0, 120)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
