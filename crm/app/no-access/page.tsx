import { createStaffClient } from '@/lib/supabase';
import { signOut } from '@/lib/staff-actions';

// A signed-in account with no staff row. The page used to say "ask an administrator", which is useless
// to the person who *is* the administrator, and it needed the server to run the set-up script. It now
// names the account and prints the one statement that fixes it.

export default async function NoAccessPage() {
  const supabase = await createStaffClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? '';
  // Single quotes doubled, so an address with an apostrophe cannot break the statement it appears in.
  const safeEmail = email.replace(/'/g, "''") || 'you@example.com';

  return (
    <main className="narrow">
      <img className="auth-logo" src="/logo-reversed.svg?v=2" alt="dataleasers" />
      <h1>No access yet</h1>
      <p className="muted">
        You are signed in{email ? <> as <strong>{email}</strong></> : null}, but this account is not on
        the staff list, so the CRM has nothing to show it. Signing in again will not change that.
      </p>
      <p className="muted small">
        An administrator adds the row below in the Supabase SQL editor, with a name and the role you
        should have: <code>admin</code>, <code>introducer</code>, <code>reviewer</code> or{' '}
        <code>viewer</code>.
      </p>
      <pre className="sql">{`insert into public.crm_staff (user_id, full_name, role)
select id, 'Your Name', 'admin'
from auth.users
where email = '${safeEmail}';`}</pre>
      <p className="muted small">
        Reload this page afterwards; no redeploy and no restart is needed.
      </p>
      <form action={signOut}>
        <button className="btn ghost" type="submit">
          Sign out
        </button>
      </form>
    </main>
  );
}
