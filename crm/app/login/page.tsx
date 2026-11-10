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
    // A staff account that never confirmed its address can still use the email link,
    // so say that instead of blaming the password. Everything else stays generic
    // and reveals nothing about whether the address exists.
    if (error.code === 'email_not_confirmed') redirect('/login?unconfirmed=1');
    redirect(`/login?error=1&code=${encodeURIComponent(error.code ?? 'unknown')}`);
  }
  // Middleware sends staff to /mfa for two-factor setup or verification.
  redirect('/dashboard');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; unconfirmed?: string; code?: string }>;
}) {
  const { sent, error, unconfirmed, code } = await searchParams;
  return (
    <main className="narrow">
      <h1>Sign in</h1>
      {error ? <p role="alert">Email or password is incorrect.</p> : null}
      {error && code ? <p className="small muted">Reference: {code}</p> : null}
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
