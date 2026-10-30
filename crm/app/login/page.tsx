import { createServerClient } from '@supabase/ssr';
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
        setAll(cookiesToSet) {
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

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <main className="narrow">
      <h1>Sign in</h1>
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
