'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { normaliseEmail, sendGuard, type Basis } from '@/lib/outbound';

// Adding contacts, writing sequences and approving a first send. Sending itself lives in
// the cron route; nothing here can put mail on the wire.

const PATH = '/outbound';

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string, max: number): string | null {
  const value = String(formData.get(key) ?? '').trim();
  return value ? value.slice(0, max) : null;
}

async function requireWriter() {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) {
    fail('Your role does not allow this. Admin or introducer access is needed.');
  }
  return { supabase, me };
}

export async function addContact(formData: FormData) {
  const { supabase } = await requireWriter();

  const email = normaliseEmail(String(formData.get('email') ?? ''));
  const country = String(formData.get('country') ?? '').toUpperCase();
  const basis = String(formData.get('basis') ?? '') as Basis;

  const { data: existing } = await supabase
    .from('suppressions')
    .select('email')
    .eq('email', email)
    .maybeSingle();

  const guard = sendGuard({ email, country, basis, suppressed: Boolean(existing) });
  if (!guard.ok) fail(guard.reason);

  const { error } = await supabase.from('outreach_contacts').insert({
    email,
    full_name: text(formData, 'fullName', 200),
    role_title: text(formData, 'roleTitle', 200),
    country,
    basis,
    basis_note: text(formData, 'basisNote', 1000),
    source: text(formData, 'source', 200),
    source_url: text(formData, 'sourceUrl', 1000),
    company_id: text(formData, 'companyId', 64),
  });
  if (error) fail('Could not save the contact. That address may already be on the list.');

  revalidatePath(PATH);
  redirect(`${PATH}?added=1`);
}

export async function createSequence(formData: FormData) {
  const { supabase, me } = await requireWriter();
  if (me.role !== 'admin') fail('Only an admin can write a sequence.');

  const name = text(formData, 'name', 200);
  if (!name) fail('Give the sequence a name.');

  const { error } = await supabase.from('sequences').insert({
    name,
    description: text(formData, 'description', 1000),
    created_by: me.user_id,
  });
  if (error) fail('Could not save the sequence.');

  revalidatePath(PATH);
  redirect(`${PATH}?sequence=1`);
}

export async function addStep(sequenceId: string, formData: FormData) {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || me.role !== 'admin') fail('Only an admin can add a step.');

  const subject = text(formData, 'subject', 300);
  const body = text(formData, 'body', 8000);
  if (!subject || !body) fail('A step needs a subject and a body.');

  const { data: existing } = await supabase
    .from('sequence_steps')
    .select('position')
    .eq('sequence_id', sequenceId)
    .order('position', { ascending: false })
    .limit(1);
  const nextPosition = ((existing?.[0]?.position as number | undefined) ?? 0) + 1;
  if (nextPosition > 20) fail('A sequence can hold twenty steps.');

  const delay = Number(formData.get('delayDays') ?? 0);
  if (!Number.isInteger(delay) || delay < 0 || delay > 60) {
    fail('The delay must be 0 to 60 days.');
  }

  const { error } = await supabase.from('sequence_steps').insert({
    sequence_id: sequenceId,
    position: nextPosition,
    delay_days: delay,
    subject,
    body,
  });
  if (error) fail('Could not save the step.');

  revalidatePath(PATH);
  redirect(`${PATH}?step=1`);
}

// Enrolling puts the contact in the queue but sends nothing: approved_at is null, and the
// publisher only claims enrolments that a person has approved.
export async function enrolContact(formData: FormData) {
  const { supabase } = await requireWriter();

  const contactId = text(formData, 'contactId', 64);
  const sequenceId = text(formData, 'sequenceId', 64);
  if (!contactId || !sequenceId) fail('Choose a contact and a sequence.');

  const { data: contact } = await supabase
    .from('outreach_contacts')
    .select('id, email, country, basis, status')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) fail('That contact could not be found.');
  if (contact.status !== 'active') fail('That contact is not active.');

  const { data: suppressed } = await supabase
    .from('suppressions')
    .select('email')
    .eq('email', contact.email)
    .maybeSingle();
  const guard = sendGuard({
    email: contact.email,
    country: contact.country,
    basis: contact.basis,
    suppressed: Boolean(suppressed),
  });
  if (!guard.ok) fail(guard.reason);

  const { data: firstStep } = await supabase
    .from('sequence_steps')
    .select('position, delay_days')
    .eq('sequence_id', sequenceId)
    .order('position')
    .limit(1)
    .maybeSingle();
  if (!firstStep) fail('That sequence has no steps yet.');

  const due = new Date();
  due.setDate(due.getDate() + Number(firstStep.delay_days ?? 0));

  const { error } = await supabase.from('sequence_enrolments').insert({
    sequence_id: sequenceId,
    contact_id: contactId,
    status: 'pending_approval',
    current_position: 0,
    next_due_on: due.toISOString().slice(0, 10),
  });
  if (error) fail('Could not enrol. That contact may already be in this sequence.');

  revalidatePath(PATH);
  redirect(`${PATH}?enrolled=1`);
}

// The human gate. Until this runs, the queue will not send to the contact.
export async function approveEnrolment(enrolmentId: string) {
  const { supabase, me } = await requireWriter();
  const { error } = await supabase
    .from('sequence_enrolments')
    .update({
      status: 'active',
      approved_at: new Date().toISOString(),
      approved_by: me.user_id,
    })
    .eq('id', enrolmentId)
    .eq('status', 'pending_approval');
  if (error) fail('Could not approve. Only a pending enrolment can be approved.');

  revalidatePath(PATH);
}

export async function stopEnrolment(enrolmentId: string, reason: string) {
  const { supabase } = await requireWriter();
  const allowed = ['replied', 'paused', 'stopped'];
  const status = allowed.includes(reason) ? reason : 'stopped';

  await supabase
    .from('sequence_enrolments')
    .update({
      status,
      stopped_reason: status === 'replied' ? 'Replied' : 'Stopped by staff',
    })
    .eq('id', enrolmentId)
    .in('status', ['pending_approval', 'active', 'sending', 'paused']);

  revalidatePath(PATH);
}

// Manual suppression: a phone request, a bounce, a complaint.
export async function suppressAddress(formData: FormData) {
  const { supabase } = await requireWriter();

  const email = normaliseEmail(String(formData.get('email') ?? ''));
  const reason = String(formData.get('reason') ?? 'manual');
  if (!email.includes('@')) fail('Enter the address to suppress.');

  const { error } = await supabase
    .from('suppressions')
    .insert({ email, reason, note: text(formData, 'note', 1000), source: 'CRM' });
  if (error && !error.message.includes('duplicate')) fail('Could not add the suppression.');

  await supabase
    .from('outreach_contacts')
    .update({ status: reason === 'unsubscribed' ? 'unsubscribed' : 'paused' })
    .eq('email', email);

  revalidatePath(PATH);
  redirect(`${PATH}?suppressed=1`);
}
