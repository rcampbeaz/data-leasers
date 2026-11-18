import { eraseByEmail } from '@/lib/admin-actions';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';

export default async function PrivacyRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; erased?: string }>;
}) {
  const { error, erased } = await searchParams;
  const me = await currentStaff(await createStaffClient());
  const isAdmin = me?.role === 'admin';

  return (
    <main className="page">
      <header className="page-head">
        <h1>Privacy requests</h1>
        <p className="muted">
          Erase a person&apos;s enquiry, their contact rows on a company, and the outbound prospect record for the
          address when they ask. Company records are kept, and the link to the erased enquiry is cleared. A referral
          partner found under the same address is anonymised rather than deleted, so the fee history on their
          referrals survives. A do-not-mail entry is kept if they had one: it holds the address and nothing else,
          and removing it would let the next import start mailing them again. The erasure is logged with counts only,
          not the email address. Check the request with counsel before acting on anything unusual.
        </p>
      </header>

      {error ? <p className="notice blocked">{error}</p> : null}
      {erased !== undefined ? <p className="notice">Erased {erased} enquiry record(s).</p> : null}

      {isAdmin ? (
        <form action={eraseByEmail} className="form-grid">
          <label className="span-2">
            Email address of the request
            <input type="email" name="email" required maxLength={320} />
          </label>
          <label className="span-2">
            <input type="checkbox" name="confirm" value="yes" required /> I have verified this request and want to erase the records. This cannot be undone.
          </label>
          <button className="btn" type="submit">Erase records</button>
        </form>
      ) : (
        <p className="muted">Only admins can process privacy requests.</p>
      )}
    </main>
  );
}
