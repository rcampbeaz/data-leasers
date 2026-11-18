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
  if (!note) fail('Say why the domain is being released.');

  const held = domain.toLowerCase();

  // The reason column records why the domain was held — the complaint rate and window that put it
  // there — and it is the only history of that decision. Releasing used to overwrite it with the
  // release note, so the explanation for the hold was destroyed by the act of lifting it. The note
  // about the release goes to the activity log instead, where it keeps its author and its time.
  const { error } = await supabase
    .from('domain_holds')
    .update({
      released_at: new Date().toISOString(),
      released_by: me.user_id,
    })
    .eq('domain', held)
    .is('released_at', null);
  if (error) fail('Could not release that domain. Has migration 0013 been run?');

  const { error: logError } = await supabase.from('audit_log').insert({
    actor_id: me.user_id,
    entity: 'domain',
    entity_id: held,
    action: 'hold_released',
    detail: { note },
  });

  revalidatePath(PATH);
  if (logError) {
    // The hold is gone; say so, and say the note was not kept, rather than reporting a release that
    // did not happen or a note that was never written.
    redirect(
      `${PATH}?released=1&error=${encodeURIComponent(
        'The hold was released, but the reason could not be recorded in the activity log.',
      )}`,
    );
  }
  redirect(`${PATH}?released=1`);
}
