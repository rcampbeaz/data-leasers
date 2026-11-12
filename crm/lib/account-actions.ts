import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { originFromHeaders } from '@/lib/origin';

// A password for the signed-in person, set from the browser.
//
// This exists because an account created by invitation, or added by hand in Supabase, has no password
// credential at all: every password is refused with invalid_credentials, and the only other ways to
// set one need the service-role key and a shell. Signing in with the email link proves who you are,
// and this page then gives the account a password.

const PATH = '/account';

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

export async function setPassword(formData: FormData) {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me) redirect('/login');

  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password.length < 12) fail('Use at least 12 characters.');
  if (password !== confirm) fail('The two passwords do not match.');

  // updateUser acts on the session's own user, so this can only ever change the signed-in account.
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    fail(
      /weak|strength|characters|pwned/i.test(error.message)
        ? 'That password is too weak. Use a longer one with a mix of words.'
        : `Could not set the password: ${error.message.slice(0, 160)}`,
    );
  }

  revalidatePath(PATH);
  redirect(`${PATH}?saved=1`);
}

// A reset link lands on /reset with a session, and the same rule applies: the password is set on the
// account that owns the session, never on an id supplied by the form.
export async function setPasswordAfterReset(formData: FormData) {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me) redirect('/login');

  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < 12) redirect('/reset?error=' + encodeURIComponent('Use at least 12 characters.'));
  if (password !== confirm) {
    redirect('/reset?error=' + encodeURIComponent('The two passwords do not match.'));
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(
      '/reset?error=' +
        encodeURIComponent(
          /weak|strength|characters|pwned/i.test(error.message)
            ? 'That password is too weak. Use a longer one with a mix of words.'
            : `Could not set the password: ${error.message.slice(0, 160)}`,
        ),
    );
  }

  redirect('/reset?saved=1');
}

// Sends a reset link to an address, signed out. The response is the same whether or not the account
// exists, so this cannot be used to discover who is on the staff list.
export async function requestReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) redirect('/reset?error=' + encodeURIComponent('Enter your work email.'));

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
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );

  // The callback is already an allowed redirect in Supabase, so the link comes back through the same
  // code exchange as a sign-in link and then continues to /reset.
  const origin = originFromHeaders(await headers());
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset`,
  });

  redirect('/reset?sent=1');
}
