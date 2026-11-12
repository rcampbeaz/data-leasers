'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { fieldsUsed, unknownFields } from '@/lib/template-render';
import { PURPOSES, type Purpose } from '@/lib/template-meta';

// Writing the template library. Nothing here sends: a template only becomes an email when a person
// adds it as a step, enrols a contact, and approves that enrolment.

const PATH = '/templates';

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string, max: number): string | null {
  const value = String(formData.get(key) ?? '').trim();
  return value ? value.slice(0, max) : null;
}

async function requireAdmin() {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || me.role !== 'admin') fail('Only an admin can change the template library.');
  return { supabase, me };
}

// A placeholder the renderer cannot fill would be sent literally, so it is refused at the door
// rather than discovered in a prospect's inbox.
function checkFields(subject: string, body: string) {
  const unknown = [...new Set([...unknownFields(subject), ...unknownFields(body)])];
  if (unknown.length > 0) {
    fail(
      `Unknown merge field${unknown.length > 1 ? 's' : ''}: ${unknown
        .map((f) => `{{${f}}}`)
        .join(', ')}. Use the fields listed under the editor.`,
    );
  }
  if (fieldsUsed(body).length === 0) {
    // Not an error: some copy is deliberately generic. Recorded on the row instead, so the library
    // shows at a glance which templates will read the same to every recipient.
    return null;
  }
  return fieldsUsed(body).join(', ').slice(0, 200);
}

export async function saveTemplate(formData: FormData) {
  const { supabase, me } = await requireAdmin();

  const name = text(formData, 'name', 200);
  const purpose = String(formData.get('purpose') ?? '') as Purpose;
  const subject = text(formData, 'subject', 300);
  const body = text(formData, 'body', 8000);

  if (!name) fail('Give the template a name you will recognise in a list.');
  if (!(PURPOSES as readonly string[]).includes(purpose)) fail('Choose what the template is for.');
  if (!subject || !body) fail('A template needs a subject and a body.');
  checkFields(subject, body);

  const { error } = await supabase.from('email_templates').insert({
    name,
    purpose,
    subject,
    body,
    notes: text(formData, 'notes', 1000),
    created_by: me.user_id,
  });
  if (error) {
    fail(
      error.message.includes('duplicate')
        ? 'A template with that name already exists.'
        : 'Could not save the template.',
    );
  }

  revalidatePath(PATH);
  redirect(`${PATH}?saved=1`);
}

export async function updateTemplate(templateId: string, formData: FormData) {
  const { supabase } = await requireAdmin();

  const name = text(formData, 'name', 200);
  const purpose = String(formData.get('purpose') ?? '') as Purpose;
  const subject = text(formData, 'subject', 300);
  const body = text(formData, 'body', 8000);

  if (!name || !subject || !body) fail('A template needs a name, a subject and a body.');
  if (!(PURPOSES as readonly string[]).includes(purpose)) fail('Choose what the template is for.');
  checkFields(subject, body);

  const { error } = await supabase
    .from('email_templates')
    .update({
      name,
      purpose,
      subject,
      body,
      notes: text(formData, 'notes', 1000),
      updated_at: new Date().toISOString(),
    })
    .eq('id', templateId);
  if (error) fail('Could not update the template.');

  revalidatePath(PATH);
  redirect(`${PATH}?updated=1`);
}

// Steps copy the text when they are created, so deleting a template cannot change or break a
// sequence that already used it. That is deliberate: history should not move under a live send.
export async function deleteTemplate(templateId: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from('email_templates').delete().eq('id', templateId);
  if (error) fail('Could not delete the template.');
  revalidatePath(PATH);
  redirect(`${PATH}?deleted=1`);
}
