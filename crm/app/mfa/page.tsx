import { redirect } from 'next/navigation';
import { createStaffClient } from '@/lib/supabase';

// Checks the six-digit code from the authenticator app against the enrolled factor.
async function verifyCode(formData: FormData) {
  'use server';
  const factorId = String(formData.get('factorId') ?? '');
  const code = String(formData.get('code') ?? '').replace(/\s/g, '');

  const supabase = await createStaffClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    redirect('/mfa?error=1');
  }
  redirect('/leads');
}

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createStaffClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();

  const verified = factors?.totp.find((f) => f.status === 'verified');

  // Returning staff: enter the current code.
  if (verified) {
    return (
      <main className="narrow">
        <h1>Two-factor check</h1>
        <p className="muted">Enter the six-digit code from your authenticator app.</p>
        {error ? <p className="notice blocked">That code was not accepted. Try the next one.</p> : null}
        <form action={verifyCode}>
          <input type="hidden" name="factorId" value={verified.id} />
          <label>
            Code
            <input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required />
          </label>
          <button className="btn" type="submit">Verify</button>
        </form>
      </main>
    );
  }

  // First sign-in: remove any half-finished enrolment, then start a fresh one.
  for (const f of factors?.totp ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'dataleasers CRM',
  });

  if (enrollError || !enrolled) {
    return (
      <main className="narrow">
        <h1>Two-factor set-up</h1>
        <p className="notice blocked">Could not start two-factor set-up. Refresh the page to try again.</p>
      </main>
    );
  }

  return (
    <main className="narrow">
      <h1>Set up two-factor sign-in</h1>
      <p className="muted">Scan this code with an authenticator app (for example, Google Authenticator, 1Password or Authy). Then enter the six-digit code it shows.</p>
      <img src={enrolled.totp.qr_code} alt="Two-factor QR code" width={200} height={200} />
      <p className="muted small">Can't scan? Enter this key manually: <code>{enrolled.totp.secret}</code></p>
      {error ? <p className="notice blocked">That code was not accepted. Try the next one.</p> : null}
      <form action={verifyCode}>
        <input type="hidden" name="factorId" value={enrolled.id} />
        <label>
          Code
          <input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required />
        </label>
        <button className="btn" type="submit">Confirm and continue</button>
      </form>
    </main>
  );
}
