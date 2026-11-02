'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';

const ROLES = ['admin', 'introducer', 'reviewer', 'viewer'] as const;

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

async function logAudit(
  supabase: Awaited<ReturnType<typeof createStaffClient>>,
  action: string,
  entityId: string,
  detail: Record<string, unknown>,
) {
  const me = await currentStaff(supabase);
  await supabase.from('audit_log').insert({
    actor_id: me?.user_id ?? null,
    entity: 'staff',
    entity_id: entityId,
    action,
    detail,
  });
}

export async function signOut() {
  const supabase = await createStaffClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function addStaff(formData: FormData) {
  const path = '/admin/staff';
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (me?.role !== 'admin') fail(path, 'Only admins can add staff.');

  const email = String(formData.get('email') ?? '').trim();
  const fullName = String(formData.get('fullName') ?? '').trim().slice(0, 200);
  const role = String(formData.get('role') ?? '');
  if (!email.includes('@')) fail(path, 'Enter a valid email address.');
  if (!fullName) fail(path, 'Enter the person\u2019s name.');
  if (!(ROLES as readonly string[]).includes(role)) fail(path, 'Choose a valid role.');

  // The person must already have an account. Sign-up is off, so this only finds existing users.
  const { data: userId, error: lookupError } = await supabase.rpc('staff_user_id_by_email', { p_email: email });
  if (lookupError || !userId) {
    fail(path, 'No account exists for that email yet. Ask the person to sign in once, then try again.');
  }

  const { error } = await supabase.from('crm_staff').insert({
    user_id: userId,
    full_name: fullName,
    role,
  });
  if (error) fail(path, 'Could not add them. They may already be on the staff list.');

  // Store the email on the profile so the staff list can show it.
  await supabase.from('crm_staff_profiles').upsert({ user_id: userId, email: email.toLowerCase() });

  await logAudit(supabase, 'added', userId as string, { role, full_name: fullName });
  revalidatePath(path);
  redirect(path);
}

export async function changeRole(formData: FormData) {
  const path = '/admin/staff';
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (me?.role !== 'admin') fail(path, 'Only admins can change roles.');

  const userId = String(formData.get('userId') ?? '');
  const role = String(formData.get('role') ?? '');
  if (!(ROLES as readonly string[]).includes(role)) fail(path, 'Choose a valid role.');
  if (userId === me.user_id && role !== 'admin') {
    fail(path, 'You cannot remove your own admin role. Ask another admin.');
  }

  const { error } = await supabase.from('crm_staff').update({ role }).eq('user_id', userId);
  if (error) fail(path, 'Could not change the role.');

  await logAudit(supabase, 'role_changed', userId, { role });
  revalidatePath(path);
  redirect(path);
}

const PROFILE_FIELDS = [
  'fullName', 'jobTitle', 'email', 'phone',
  'addressLine1', 'addressLine2', 'city', 'region', 'postcode', 'country', 'notes',
] as const;

// Admin edits a staff member's name, role and contact details.
export async function updateStaffProfile(formData: FormData) {
  const path = '/admin/staff';
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (me?.role !== 'admin') fail(path, 'Only admins can edit staff details.');

  const userId = String(formData.get('userId') ?? '');
  if (!userId) fail(path, 'Choose a staff member.');

  const val = (key: string, max: number) => String(formData.get(key) ?? '').trim().slice(0, max);
  const fullName = val('fullName', 200);
  const role = String(formData.get('role') ?? '');
  const email = val('email', 320).toLowerCase();
  if (!fullName) fail(path, 'Enter the person\u2019s name.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(path, 'Enter a valid email address.');
  if (!(ROLES as readonly string[]).includes(role)) fail(path, 'Choose a valid role.');
  if (userId === me.user_id && role !== 'admin') {
    fail(path, 'You cannot remove your own admin role. Ask another admin.');
  }

  const { error: staffError } = await supabase
    .from('crm_staff')
    .update({ full_name: fullName, role })
    .eq('user_id', userId);
  if (staffError) fail(path, 'Could not save the name or role.');

  const { error: profileError } = await supabase.from('crm_staff_profiles').upsert({
    user_id: userId,
    email: email || null,
    job_title: val('jobTitle', 200) || null,
    phone: val('phone', 40) || null,
    address_line1: val('addressLine1', 200) || null,
    address_line2: val('addressLine2', 200) || null,
    city: val('city', 100) || null,
    region: val('region', 100) || null,
    postcode: val('postcode', 20) || null,
    country: val('country', 100) || null,
    notes: val('notes', 2000) || null,
    updated_at: new Date().toISOString(),
  });
  if (profileError) fail(path, 'Could not save the contact details.');

  // Log which fields changed, not their values, so personal data is not copied into the log.
  await logAudit(supabase, 'profile_updated', userId, { fields: PROFILE_FIELDS.length });
  revalidatePath(path);
  redirect(path);
}

export async function removeStaff(formData: FormData) {
  const path = '/admin/staff';
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (me?.role !== 'admin') fail(path, 'Only admins can remove staff.');

  const userId = String(formData.get('userId') ?? '');
  if (userId === me.user_id) fail(path, 'You cannot remove your own access.');

  const { error } = await supabase.from('crm_staff').delete().eq('user_id', userId);
  if (error) fail(path, 'Could not remove access.');

  await logAudit(supabase, 'removed', userId, {});
  revalidatePath(path);
  redirect(path);
}
