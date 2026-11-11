'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import type { MarketingControls } from '@/lib/marketing-settings';

// The switches on the Marketing console. They are stored in app_settings so the
// publisher (a cron route with no session) can read the same value a person set.

const PATH = '/marketing';

export async function setMarketingControls(formData: FormData) {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || me.role !== 'admin') {
    redirect(`${PATH}?error=${encodeURIComponent('Only an admin can change these switches.')}`);
  }

  const value: MarketingControls = {
    publishing_enabled: formData.get('publishingEnabled') === 'on',
    drafting_enabled: formData.get('draftingEnabled') === 'on',
    require_approval: formData.get('requireApproval') === 'on',
  };

  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'marketing', value, updated_at: new Date().toISOString() });
  if (error) redirect(`${PATH}?error=${encodeURIComponent('Could not save the switches.')}`);

  revalidatePath(PATH);
  redirect(`${PATH}?saved=1`);
}

// Approval is what the require_approval switch gates. Without this, that switch
// would only be a warning; with it, scheduling refuses until a person has approved.
export async function approveContent(contentId: string) {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) {
    redirect(`${PATH}?error=${encodeURIComponent('Your role does not allow this.')}`);
  }

  const { error } = await supabase
    .from('social_contents')
    .update({ status: 'approved', approved_by: me.user_id, approved_at: new Date().toISOString() })
    .eq('id', contentId)
    .in('status', ['draft', 'needs_review']);
  if (error) redirect(`${PATH}?error=${encodeURIComponent('Could not approve that draft.')}`);

  revalidatePath(PATH);
}
