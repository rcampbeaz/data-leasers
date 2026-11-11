'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';

// Releasing a held domain. Admin or introducer only, because it is the decision to start mailing
// a domain that complained again.

const PATH = '/deliverability';

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

export async function releaseDomainHold(domain: string, formData: FormData) {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) {
    fail('Your role does not allow releasing a domain.');
  }

  const note = String(formData.get('note') ?? '').trim().slice(0, 400);
  const reason = note ? `Released: ${note}` : 'Released by staff';

  const { error } = await supabase
    .from('domain_holds')
    .update({
      released_at: new Date().toISOString(),
      released_by: me.user_id,
      reason,
    })
    .eq('domain', domain.toLowerCase())
    .is('released_at', null);
  if (error) fail('Could not release that domain. Has migration 0013 been run?');

  revalidatePath(PATH);
  redirect(`${PATH}?released=1`);
}
