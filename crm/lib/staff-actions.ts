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
