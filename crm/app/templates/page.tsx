import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { mergeFieldHelp, unknownFields, fieldsUsed } from '@/lib/template-render';
import { PURPOSE_LABELS, PURPOSE_ORDER } from '@/lib/template-meta';
import { deleteTemplate, saveTemplate, updateTemplate } from '@/lib/template-actions';

// The library of copy the cadence draws from. Editing here never changes a sequence that has
// already copied the text, and nothing on this page can send.

type TemplateRow = {
  id: string;
  name: string;
  purpose: string;
  subject: string;
  body: string;
  notes: string | null;
  updated_at: string;
};

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; updated?: string; deleted?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const isAdmin = me?.role === 'admin';

  const { data } = await supabase
    .from('email_templates')
    .select('id, name, purpose, subject, body, notes, updated_at')
    .order('name');

  const rows = (data ?? []) as TemplateRow[];
  const ordered = [...rows].sort((a, b) => {
    const ai = PURPOSE_ORDER.indexOf(a.purpose as never);
    const bi = PURPOSE_ORDER.indexOf(b.purpose as never);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  const fields = mergeFieldHelp();

  return (
    <main className="page">
      <header className="page-head">
        <h1>Templates</h1>
        <p className="muted">
          The copy a cadence draws from. A template becomes an email only when a person adds it as a
          step, enrols a contact and approves that enrolment — this page cannot send anything.
        </p>
      </header>

      {sp.error ? <p className="notice blocked">{sp.error}</p> : null}
      {sp.saved ? <p className="notice">Template saved.</p> : null}
      {sp.updated ? <p className="notice">Template updated. Steps already added keep their own copy.</p> : null}
      {sp.deleted ? <p className="notice">Template deleted. Sequences that used it are unaffected.</p> : null}

      <section className="panel">
        <h2>Merge fields</h2>
        <p className="muted small">
          Written into the copy and filled at send time, so correcting a template fixes every future
          message. A field the sender does not recognise is refused rather than sent literally.
        </p>
        <table className="table">
          <thead>
            <tr><th>Token</th><th>Filled with</th></tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.field}>
                <td><code>{f.token}</code></td>
                <td>{f.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {isAdmin ? (
        <section className="panel">
          <h2>Write a template</h2>
          <form action={saveTemplate} className="stack">
            <label>Name
              <input name="name" required maxLength={200} placeholder="Follow-up — the buyer side" />
            </label>
            <label>Purpose
              <select name="purpose" required defaultValue="follow_up">
                {PURPOSE_ORDER.map((p) => (
                  <option key={p} value={p}>{PURPOSE_LABELS[p]}</option>
                ))}
              </select>
            </label>
            <label>Subject
              <input name="subject" required maxLength={300} />
            </label>
            <label>Body
              <textarea name="body" required rows={10} maxLength={8000} />
            </label>
            <label>Notes
              <input name="notes" maxLength={1000} placeholder="When to use it, and what to personalise" />
            </label>
            <button className="btn" type="submit">Save template</button>
          </form>
          <p className="muted small">
            No figures without a source link. The same rule that blocks a social post applies to a
            cold email: a number in copy is a claim about the business.
          </p>
        </section>
      ) : (
        <p className="muted small">Only an admin can write or change the library. You can read it here.</p>
      )}

      <section className="panel">
        <h2>Library ({rows.length})</h2>
        {rows.length === 0 ? (
          <p className="muted">
            No templates yet. The starter set lands with migration 0016; if this is empty, that file
            has not been run.
          </p>
        ) : null}

        {ordered.map((t) => {
          const unknown = unknownFields(`${t.subject}\n${t.body}`);
          const used = fieldsUsed(t.body);
          return (
            <article key={t.id} className="panel">
              <header>
                <strong>{t.name}</strong>{' '}
                <span className="status review">{PURPOSE_LABELS[t.purpose as never] ?? t.purpose}</span>
              </header>
              <p className="muted small">Subject: {t.subject}</p>
              <pre className="prose small" style={{ whiteSpace: 'pre-wrap' }}>{t.body}</pre>
              {t.notes ? <p className="muted small">{t.notes}</p> : null}
              <p className="muted small">
                {used.length > 0 ? `Filled at send: ${used.map((f) => `{{${f}}}`).join(', ')}` : 'No merge fields: every recipient sees the same text.'}
                {unknown.length > 0 ? ` Unknown: ${unknown.map((f) => `{{${f}}}`).join(', ')}` : ''}
              </p>

              {isAdmin ? (
                <details>
                  <summary className="muted small">Edit or delete</summary>
                  <form action={updateTemplate.bind(null, t.id)} className="stack">
                    <label>Name
                      <input name="name" defaultValue={t.name} required maxLength={200} />
                    </label>
                    <label>Purpose
                      <select name="purpose" defaultValue={t.purpose}>
                        {PURPOSE_ORDER.map((p) => (
                          <option key={p} value={p}>{PURPOSE_LABELS[p]}</option>
                        ))}
                      </select>
                    </label>
                    <label>Subject
                      <input name="subject" defaultValue={t.subject} required maxLength={300} />
                    </label>
                    <label>Body
                      <textarea name="body" defaultValue={t.body} rows={12} required maxLength={8000} />
                    </label>
                    <label>Notes
                      <input name="notes" defaultValue={t.notes ?? ''} maxLength={1000} />
                    </label>
                    <button className="btn" type="submit">Save changes</button>
                  </form>
                  <form action={deleteTemplate.bind(null, t.id)}>
                    <button className="btn" type="submit">Delete this template</button>
                  </form>
                  <p className="muted small">
                    Deleting removes it from the library only. Any sequence step created from it keeps
                    its own copy, including one already sent.
                  </p>
                </details>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
