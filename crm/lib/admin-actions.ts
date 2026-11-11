'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createIntakeClient, createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { escapeLike, parseCsv } from '@/lib/csv';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IMPORT_LIMIT = 500;

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function text(form: FormData, key: string, max: number): string {
  return String(form.get(key) ?? '').trim().slice(0, max);
}

// Returns the signed-in staff member, or sends them back with a message.
async function requireRole(roles: string[], path: string) {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !roles.includes(me.role)) fail(path, 'Your role does not allow this.');
  return me;
}

// Records a change. Uses the server-only client so every write path is logged.
async function audit(actorId: string, entity: string, entityId: string, action: string, detail: Record<string, unknown>) {
  await createIntakeClient().from('audit_log').insert({
    actor_id: actorId,
    entity,
    entity_id: entityId,
    action,
    detail,
  });
}

// Staff-entered lead, e.g. from a phone call or event. Same record as the website form.
export async function addLead(formData: FormData) {
  const path = '/leads';
  const me = await requireRole(['admin', 'introducer'], path);

  const name = text(formData, 'name', 200);
  const email = text(formData, 'email', 320);
  const company = text(formData, 'company', 200);
  const roleTitle = text(formData, 'role', 200);
  const note = text(formData, 'note', 2000);

  if (!name) fail(path, 'Enter the contact name.');
  if (!EMAIL.test(email)) fail(path, 'Enter a valid email address.');
  if (!company) fail(path, 'Enter the company name.');

  const admin = createIntakeClient();

  // Same person enquiring twice is common; keep one record and say so.
  const { data: duplicate } = await admin
    .from('leads')
    .select('id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle();
  if (duplicate) fail(path, 'A lead with that email address already exists.');

  const { data, error } = await admin
    .from('leads')
    .insert({
      name,
      email,
      company,
      role_title: roleTitle || null,
      data_note: note || null,
      source_page: 'manual',
    })
    .select('id')
    .single();
  if (error || !data) fail(path, 'Could not add the lead.');

  await audit(me.user_id, 'lead', data.id, 'created', { source: 'manual' });
  revalidatePath('/leads');
  redirect('/leads?saved=1');
}

// Bulk import. Expects a header row with: name, email, company, role, note.
export async function importLeads(formData: FormData) {
  const path = '/import';
  const me = await requireRole(['admin', 'introducer'], path);

  const raw = String(formData.get('csv') ?? '');
  const rows = parseCsv(raw);
  if (rows.length < 2) fail(path, 'Paste a header row and at least one lead.');

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const required = ['name', 'email', 'company'];
  if (!required.every((h) => idx(h) !== -1)) {
    fail(path, 'The header row must include name, email and company.');
  }

  const body = rows.slice(1);
  if (body.length > IMPORT_LIMIT) fail(path, `Import up to ${IMPORT_LIMIT} rows at a time.`);

  const valid: Record<string, string | null>[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const r of body) {
    const get = (name: string) => (idx(name) === -1 ? '' : (r[idx(name)] ?? '').trim());
    const email = get('email').toLowerCase();
    const name = get('name').slice(0, 200);
    const company = get('company').slice(0, 200);
    if (!name || !company || !EMAIL.test(email) || seen.has(email)) {
      skipped++;
      continue;
    }
    seen.add(email);
    valid.push({
      name,
      email: email.slice(0, 320),
      company,
      role_title: get('role').slice(0, 200) || null,
      data_note: get('note').slice(0, 2000) || null,
      source_page: 'import',
    });
  }

  if (valid.length > 0) {
    const admin = createIntakeClient();
    const { error } = await admin.from('leads').insert(valid);
    if (error) fail(path, 'Could not import. Check the file and try again.');
    await audit(me.user_id, 'lead', me.user_id, 'imported', { count: valid.length, skipped });
  }

  revalidatePath('/leads');
  redirect(`/import?imported=${valid.length}&skipped=${skipped}`);
}

// Marks a task done or open. Staff with introducer access, or the assignee, can change it.
export async function setTaskDone(formData: FormData) {
  const path = '/tasks';
  const supabase = await createStaffClient();
  const taskId = text(formData, 'taskId', 64);
  const done = formData.get('done') === 'true';
  const { error } = await supabase.from('tasks').update({ done }).eq('id', taskId);
  if (error) fail(path, 'Could not update the task.');
  revalidatePath(path);
  redirect(path);
}

// Erasure on request. Admin only. Removes the person's enquiry and contact records.
// Company records stay, because they describe the business and its data rights,
// but any link to the erased enquiry is cleared. Only counts are logged.
export async function eraseByEmail(formData: FormData) {
  const path = '/privacy-requests';
  const me = await requireRole(['admin'], path);

  const email = text(formData, 'email', 320).toLowerCase();
  if (!EMAIL.test(email)) fail(path, 'Enter the email address the request is about.');
  if (formData.get('confirm') !== 'yes') fail(path, 'Tick the confirmation box before erasing.');

  const admin = createIntakeClient();
  const pattern = escapeLike(email);

  const { data: leads } = await admin.from('leads').select('id').ilike('email', pattern);
  const leadIds = (leads ?? []).map((l) => l.id as string);

  let draftCount = 0;
  if (leadIds.length > 0) {
    await admin.from('companies').update({ lead_id: null }).in('lead_id', leadIds);
    const { data: drafts } = await admin.from('agent_drafts').delete().in('lead_id', leadIds).select('id');
    draftCount = (drafts ?? []).length;
    const { error: leadError } = await admin.from('leads').delete().in('id', leadIds);
    if (leadError) fail(path, 'Could not erase the enquiry records.');
  }

  const { data: contacts } = await admin.from('contacts').delete().ilike('email', pattern).select('id');

  // A referral partner is an outside person too. Their row is anonymised rather
  // than deleted, because the referrals hang off it and carry the fee history.
  // Before 0008 has run this query fails harmlessly and nothing is changed.
  const { data: partners } = await admin
    .from('partners')
    .select('id')
    .ilike('email', pattern)
    .is('erased_at', null);
  let partnerCount = 0;
  for (const partner of partners ?? []) {
    const { error: partnerError } = await admin
      .from('partners')
      .update({
        name: `Erased partner ${String(partner.id).slice(0, 8)}`,
        email: null,
        organisation: null,
        notes: null,
        erased_at: new Date().toISOString(),
      })
      .eq('id', partner.id);
    if (!partnerError) partnerCount += 1;
  }

  await audit(me.user_id, 'erasure', me.user_id, 'erased', {
    leads: leadIds.length,
    contacts: (contacts ?? []).length,
    drafts: draftCount,
    partners: partnerCount,
  });

  revalidatePath('/privacy-requests');
  redirect(`/privacy-requests?erased=${leadIds.length}`);
}

// Agent switch and daily cap. Admin only.
export async function setAgentControls(formData: FormData) {
  const path = '/agents';
  const me = await requireRole(['admin'], path);

  const enabled = formData.get('enabled') === 'on';
  const cap = Math.min(500, Math.max(0, Number(formData.get('dailyCap') ?? 0) || 0));

  const admin = createIntakeClient();
  const { error } = await admin
    .from('app_settings')
    .upsert({ key: 'agents', value: { enabled, daily_cap: cap }, updated_at: new Date().toISOString() });
  if (error) fail(path, 'Could not save the agent settings.');

  await audit(me.user_id, 'settings', me.user_id, 'agents_updated', { enabled, daily_cap: cap });
  revalidatePath(path);
  redirect(path);
}
