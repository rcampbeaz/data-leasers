import { createStaffClient } from '@/lib/supabase';
import { requestReset, setPasswordAfterReset } from '@/lib/account-actions';

// Password recovery, in two states.
//
// Signed out: ask for an address and send a link. Signed in (which is what the link produces): set a
// password. Both paths are needed because an account created by invitation has no password at all, so
// there is nothing to "remind" anyone of - it has to be created.

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; saved?: string }>;
}) {
  const { sent, error, saved } = await searchParams;
  const supabase = await createStaffClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="narrow">
      <img className="auth-logo" src="/logo-reversed.svg?v=2" alt="dataleasers" />
      <h1>{user ? 'Set a password' : 'Reset your password'}</h1>

      {saved ? (
        <p className="notice">
          Password set. You can sign in with it from now on, and the email link keeps working.
        </p>
      ) : null}
      {error ? <p className="notice blocked">{error}</p> : null}

      {user ? (
        <>
          <p className="muted small">
            Signed in as {user.email ?? 'your account'}. Choose a password of 12 characters or more; it
            is stored hashed and nothing is emailed.
          </p>
          <form action={setPasswordAfterReset}>
            <label>
              New password
              <input type="password" name="password" autoComplete="new-password" minLength={12} required />
            </label>
            <label>
              Repeat it
              <input type="password" name="confirm" autoComplete="new-password" minLength={12} required />
            </label>
            <button className="btn" type="submit">
              Save password
            </button>
          </form>
          <p className="muted small">
            Then open <a href="/marketing">the CRM</a>.
          </p>
        </>
      ) : (
        <>
          {sent ? (
            <p className="notice">
              If that address has an account, a recovery link is on its way. It expires quickly, so use
              it as soon as it arrives.
            </p>
          ) : (
            <p className="muted small">
              Enter your work email and a link will take you to a page where you choose a password. This
              also works for an account that has never had one.
            </p>
          )}
          <form action={requestReset}>
            <label>
              Work email
              <input type="email" name="email" autoComplete="email" required />
            </label>
            <button className="btn" type="submit">
              Send recovery link
            </button>
          </form>
          <p className="muted small">
            <a href="/login">Back to sign in</a>
          </p>
        </>
      )}
    </main>
  );
}
