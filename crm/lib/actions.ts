'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createIntakeClient, createStaffClient } from '@/lib/supabase';
import { loadCompanyState } from '@/lib/data';
import {
  STAGES,
  rankOf,
  suggestStage,
  validateMove,
  type DatasetStatus,
  type Stage,
} from '@/lib/pipeline';

const CLOSE_REASONS = ['Won', 'Lost', 'Paused', 'Not a fit'];
const DATASET_STATUSES: DatasetStatus[] = ['Approved', 'Review', 'Blocked'];
const ACTIVITY_KINDS = ['note', 'call', 'email', 'decision'];

// Sends the user back to a page with a message. Never returns.
function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function text(form: FormData, key: string, max: number): string | null {
  const value = String(form.get(key) ?? '').trim();
  return value ? value.slice(0, max) : null;
}

function refresh(companyId: string) {
  revalidatePath(`/companies/${companyId}`);
  revalidatePath('/companies');
  revalidatePath('/pipeline');
  revalidatePath('/leads');
  revalidatePath('/review');
}

// Applies the automatic stage rules. Runs with the server-only client because a
// reviewer's dataset change must be able to move a company, and reviewers cannot
// update companies under row-level security. Only the fixed rules below run here:
// they never move a company past Data assessed on their own.
async function autoAdvance(companyId: string) {
  const supabase: SupabaseClient = createIntakeClient();
  const state = await loadCompanyState(supabase, companyId);
  if (!state) return;

  const hasBlocked = state.datasets.some((d) => d.status === 'Blocked');
  if (hasBlocked && state.stage !== 'Closed' && rankOf(state.stage) > rankOf('Data assessed')) {
    await supabase.from('companies').update({ stage: 'Data assessed' }).eq('id', companyId);
    return;
  }

  const suggestion = suggestStage(state);
  if (suggestion?.auto) {
    await supabase.from('companies').update({ stage: suggestion.to }).eq('id', companyId);
  }
}

export async function createCompanyFromLead(leadId: string) {
  const supabase = await createStaffClient();

  const { data: lead } = await supabase
    .from('leads')
    .select('id, company')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) fail('/leads', 'That enquiry could not be found.');

  const { data: linked } = await supabase
    .from('companies')
    .select('id')
    .eq('lead_id', leadId)
    .maybeSingle();
  if (linked) redirect(`/companies/${linked.id}`);

  // Duplicate check: same company name already on file.
  const pattern = String(lead.company).replace(/[\\%_]/g, (m) => `\\${m}`);
  const { data: similar } = await supabase
    .from('companies')
    .select('id')
    .ilike('name', pattern)
    .limit(1)
    .maybeSingle();
  if (similar) {
    fail('/leads', `A company called "${lead.company}" already exists. Open it from the Companies page.`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: created, error } = await supabase
    .from('companies')
    .insert({
      name: lead.company,
      lead_id: leadId,
      source: 'Website',
      owner_id: user?.id ?? null,
    })
    .select('id')
    .single();
  if (error || !created) {
    fail('/leads', 'Could not create the company. Your account needs introducer access.');
  }

  refresh(created.id);
  redirect(`/companies/${created.id}`);
}

export async function addActivity(companyId: string, formData: FormData) {
  const supabase = await createStaffClient();
  const path = `/companies/${companyId}`;

  const kind = String(formData.get('kind') ?? '');
  if (!ACTIVITY_KINDS.includes(kind)) fail(path, 'Choose what kind of entry this is.');

  const body = text(formData, 'body', 4000);
  const rawCallAt = String(formData.get('callAt') ?? '');
  let callAt: string | null = null;
  if (rawCallAt) {
    const parsed = new Date(rawCallAt);
    if (Number.isNaN(parsed.getTime())) fail(path, 'The call date and time is not valid.');
    callAt = parsed.toISOString();
  }
  if (kind === 'call' && !callAt) fail(path, 'Enter the date and time of the call.');
  if (kind !== 'call' && !body) fail(path, 'Write a note before saving.');

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('activities').insert({
    company_id: companyId,
    kind,
    body,
    call_at: kind === 'call' ? callAt : null,
    created_by: user?.id ?? null,
  });
  if (error) fail(path, 'Could not save the entry. Your account needs introducer access.');

  await autoAdvance(companyId);
  refresh(companyId);
  redirect(path);
}

export async function moveStage(companyId: string, formData: FormData) {
  const supabase = await createStaffClient();
  const path = `/companies/${companyId}`;

  const to = String(formData.get('stage') ?? '') as Stage;
  if (!STAGES.includes(to)) fail(path, 'Choose a valid stage.');

  const state = await loadCompanyState(supabase, companyId);
  if (!state) fail('/companies', 'That company could not be found.');

  const reasonInput = String(formData.get('closeReason') ?? '');
  const closeReason = CLOSE_REASONS.includes(reasonInput) ? reasonInput : null;

  const problem = validateMove(to, closeReason);
  if (problem) fail(path, problem);

  const hasBlocked = state.datasets.some((d) => d.status === 'Blocked');
  if (to !== 'Closed' && hasBlocked && rankOf(to) > rankOf('Data assessed')) {
    fail(path, 'A dataset is blocked. Resolve it before moving past Data assessed.');
  }

  const patch: Record<string, unknown> = {
    stage: to,
    close_reason: to === 'Closed' ? closeReason : null,
  };
  if (to !== 'Closed') patch.closed_at = null;

  const { error } = await supabase.from('companies').update(patch).eq('id', companyId);
  if (error) fail(path, 'Could not change the stage. Your account needs introducer access.');

  refresh(companyId);
  redirect(path);
}

// Drag-and-drop move from the pipeline board. Returns an error instead of redirecting.
// Closing is not allowed here, because a close reason must be recorded on the company page.
export async function dragMoveStage(companyId: string, to: string): Promise<{ error?: string }> {
  const supabase = await createStaffClient();

  if (!STAGES.includes(to as Stage)) return { error: 'Choose a valid stage.' };
  if (to === 'Closed') {
    return { error: 'To close a company, open it and choose a close reason.' };
  }

  const state = await loadCompanyState(supabase, companyId);
  if (!state) return { error: 'That company could not be found.' };
  if (state.stage === 'Closed') {
    return { error: 'Reopen the company from its page before moving it.' };
  }

  const hasBlocked = state.datasets.some((d) => d.status === 'Blocked');
  if (hasBlocked && rankOf(to as Stage) > rankOf('Data assessed')) {
    return { error: 'A dataset is blocked. Resolve it before moving past Data assessed.' };
  }

  const { error } = await supabase
    .from('companies')
    .update({ stage: to })
    .eq('id', companyId);
  if (error) return { error: 'Could not move the company. Your account needs introducer access.' };

  refresh(companyId);
  return {};
}

export async function updateCompany(companyId: string, formData: FormData) {
  const supabase = await createStaffClient();
  const path = `/companies/${companyId}`;

  const due = text(formData, 'nextActionDue', 10);
  if (due && Number.isNaN(Date.parse(due))) fail(path, 'The due date is not valid.');

  const { error } = await supabase
    .from('companies')
    .update({
      owner_id: text(formData, 'ownerId', 64),
      introduced_by: text(formData, 'introducedBy', 64),
      next_action: text(formData, 'nextAction', 300),
      next_action_due: due,
    })
    .eq('id', companyId);
  if (error) fail(path, 'Could not save. Check the staff member selected.');

  refresh(companyId);
  redirect(path);
}

export async function addContact(companyId: string, formData: FormData) {
  const supabase = await createStaffClient();
  const path = `/companies/${companyId}`;

  const name = text(formData, 'name', 200);
  if (!name) fail(path, 'Enter the contact name.');

  const { error } = await supabase.from('contacts').insert({
    company_id: companyId,
    name,
    email: text(formData, 'email', 320),
    role_title: text(formData, 'roleTitle', 200),
  });
  if (error) fail(path, 'Could not save the contact. Your account needs introducer access.');

  refresh(companyId);
  redirect(path);
}

export async function addTask(companyId: string, formData: FormData) {
  const supabase = await createStaffClient();
  const path = `/companies/${companyId}`;

  const title = text(formData, 'title', 300);
  if (!title) fail(path, 'Enter what needs doing.');

  const dueOn = String(formData.get('dueOn') ?? '');
  if (!dueOn || Number.isNaN(Date.parse(dueOn))) fail(path, 'Enter a valid due date.');

  const assigned = text(formData, 'assignedTo', 64);
  const { error } = await supabase.from('tasks').insert({
    company_id: companyId,
    title,
    due_on: dueOn,
    assigned_to: assigned,
  });
  if (error) fail(path, 'Could not save the task. Your account needs introducer access.');

  refresh(companyId);
  redirect(path);
}

export async function toggleTask(companyId: string, taskId: string, done: boolean) {
  const supabase = await createStaffClient();
  await supabase
    .from('tasks')
    .update({ done })
    .eq('id', taskId)
    .eq('company_id', companyId);
  refresh(companyId);
}

export async function addDataset(companyId: string, formData: FormData) {
  const supabase = await createStaffClient();
  const path = `/companies/${companyId}`;

  const name = text(formData, 'name', 200);
  if (!name) fail(path, 'Enter the dataset name.');

  const status = String(formData.get('status') ?? 'Review') as DatasetStatus;
  if (!DATASET_STATUSES.includes(status)) fail(path, 'Choose a rights status.');

  const { error } = await supabase.from('datasets').insert({
    company_id: companyId,
    name,
    status,
    status_reason: text(formData, 'reason', 1000),
  });
  if (error) fail(path, 'Could not add the dataset. Reviewer or admin access is needed.');

  await autoAdvance(companyId);
  refresh(companyId);
  redirect(path);
}

// Shared by the company page and the review queue. Returns an error message, or null.
async function applyDatasetStatus(
  companyId: string,
  datasetId: string,
  formData: FormData,
): Promise<string | null> {
  const supabase = await createStaffClient();

  const status = String(formData.get('status') ?? '') as DatasetStatus;
  if (!DATASET_STATUSES.includes(status)) return 'Choose a rights status.';

  const reason = text(formData, 'reason', 1000);
  if (status === 'Blocked' && !reason) return 'Give a reason when blocking a dataset.';

  const { error } = await supabase
    .from('datasets')
    .update({ status, status_reason: reason })
    .eq('id', datasetId)
    .eq('company_id', companyId);
  if (error) return 'Could not update the status. Reviewer or admin access is needed.';

  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from('audit_log').insert({
    actor_id: user?.id ?? null,
    entity: 'dataset',
    entity_id: datasetId,
    action: 'status',
    detail: { status, reason },
  });

  await autoAdvance(companyId);
  refresh(companyId);
  return null;
}

export async function setDatasetStatus(companyId: string, datasetId: string, formData: FormData) {
  const path = `/companies/${companyId}`;
  const problem = await applyDatasetStatus(companyId, datasetId, formData);
  if (problem) fail(path, problem);
  redirect(path);
}

// From the review queue: stays on the queue after saving.
export async function setDatasetStatusFromReview(datasetId: string, formData: FormData) {
  const companyId = String(formData.get('companyId') ?? '');
  const problem = await applyDatasetStatus(companyId, datasetId, formData);
  if (problem) fail('/review', problem);
  redirect('/review');
}
