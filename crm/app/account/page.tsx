import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { setPassword } from '@/lib/account-actions';
import { ROLE_LABELS, type Role } from '@/lib/nav';

// The only place a password can be set without server access. Reachable as soon as someone is signed
// in, which the email link makes possible even when no password exists yet.

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="page">
      <header className="page-head">
        <h1>Account</h1>
        <p className="muted">
          {user?.email ?? 'Signed in'}
          {me ? ` · ${ROLE_LABELS[me.role as Role] ?? me.role}` : ''}
        </p>
      </header>

      {saved ? (
        <p className="notice">
          Password saved. Signing in with it works from now on, and the email link keeps working too.
        </p>
      ) : null}
      {error ? <p className="notice blocked">{error}</p> : null}

      <section className="panel">
        <h2>Set or change your password</h2>
        <p className="muted small">
          Twelve characters or more. It is stored hashed, nothing is emailed, and no one else can read
          it, including an admin.
        </p>
        <form action={setPassword} className="stack">
          <label>
            New password
            <input type="password" name="password" autoComplete="new-password" minLength={12} required />
          </label>
          <label>
            Repeat it
            <input type="password" name="confirm" autoComplete="new-password" minLength={12} required />
          </label>
          <button className="btn" type="submit">Save password</button>
        </form>
        <p className="muted small">
          Signed in with the email link because no password existed? That is exactly what this page is
          for. Both ways in keep working afterwards.
        </p>
      </section>
    </main>
  );
}
