import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

async function sendMagicLink(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim();
  const cookieStore = await cookies();
  const origin = (await headers()).get('origin') ?? process.env.CRM_ORIGIN ?? '';

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );

  // shouldCreateUser: false means only invited staff can sign in.
  // The response is the same whether or not the account exists, so emails are not probed.
  await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.CRM_ORIGIN ?? origin}/auth/callback`,
      shouldCreateUser: false,
    },
  });
  redirect('/login?sent=1');
}

async function signInWithPassword(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Only a real credential rejection is reported as a wrong password. A rate
    // limit or a transport failure used to land on the same message, which sent
    // people looking for a password problem that did not exist.
    const code = error.code ?? 'unknown';
    // A staff account that never confirmed its address can still use the email link,
    // so say that instead of blaming the password.
    if (code === 'email_not_confirmed') redirect('/login?unconfirmed=1');
    if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
      redirect('/login?limited=1');
    }
    if (code === 'invalid_credentials') {
      redirect(`/login?error=1&code=${encodeURIComponent(code)}`);
    }
    redirect(`/login?failed=1&code=${encodeURIComponent(code)}`);
  }
  // Middleware sends staff to /mfa for two-factor setup or verification.
  redirect('/dashboard');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    sent?: string;
    error?: string;
    failed?: string;
    limited?: string;
    unconfirmed?: string;
    code?: string;
  }>;
}) {
  const { sent, error, failed, limited, unconfirmed, code } = await searchParams;
  return (
    <main className="narrow">
      <h1>Sign in</h1>
      {error ? <p role="alert">Email or password is incorrect.</p> : null}
      {error && code ? <p className="small muted">Reference: {code}</p> : null}
      {limited ? (
        <p role="alert">
          Too many attempts in a row. Wait a minute, then try again with the same password.
        </p>
      ) : null}
      {failed ? (
        <p role="alert">
          Sign-in could not complete, which is not the same as a wrong password. Try again, or use
          the email link below.
        </p>
      ) : null}
      {failed && code ? <p className="small muted">Reference: {code}</p> : null}
      {unconfirmed ? (
        <p role="alert">
          That address has not been confirmed yet. Use the sign-in link below to finish setting up
          the account.
        </p>
      ) : null}
      <form action={signInWithPassword}>
        <label>
          Work email
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
        <button className="btn" type="submit">Sign in</button>
      </form>
      <h2>Or use an email link</h2>
      {sent ? (
        <p>If your email is on the staff list, a sign-in link is on its way.</p>
      ) : (
        <form action={sendMagicLink}>
          <label>
            Work email
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <button className="btn" type="submit">Send sign-in link</button>
        </form>
      )}
    </main>
  );
}
