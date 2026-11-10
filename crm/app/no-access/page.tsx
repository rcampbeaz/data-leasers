import { signOut } from '@/lib/staff-actions';

export default function NoAccessPage() {
  return (
    <main className="narrow">
      <h1>No access</h1>
      <p className="muted">
        Your account is signed in, but it is not on the dataleasers staff list. Ask an administrator to add you.
      </p>
      {/* Without this, a signed-in non-staff account has no way back to the sign-in screen. */}
      <form action={signOut}>
        <button className="btn" type="submit">
          Sign out
        </button>
      </form>
    </main>
  );
}
