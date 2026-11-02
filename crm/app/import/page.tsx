import { importLeads } from '@/lib/admin-actions';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; imported?: string; skipped?: string }>;
}) {
  const { error, imported, skipped } = await searchParams;
  const me = await currentStaff(await createStaffClient());
  const allowed = me?.role === 'admin' || me?.role === 'introducer';

  return (
    <main className="page">
      <header className="page-head">
        <h1>Import leads</h1>
        <p className="muted">
          Paste CSV with a header row. Required columns: name, email, company. Optional: role, note.
          Rows with a missing or invalid email, or a duplicate email in the same file, are skipped. Up to 500 rows.
        </p>
      </header>

      {error ? <p className="notice blocked">{error}</p> : null}
      {imported ? (
        <p className="notice">Imported {imported} lead(s). Skipped {skipped ?? 0}.</p>
      ) : null}

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
    </main>
  );
}
