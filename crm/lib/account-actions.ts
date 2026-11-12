import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';

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
