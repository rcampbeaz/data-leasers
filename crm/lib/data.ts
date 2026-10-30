import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyState, DatasetStatus, Stage } from './pipeline';

export type StaffMember = { user_id: string; full_name: string; role: string };

// Loads what the stage rules need for one company. Returns null if it does not exist.
export async function loadCompanyState(
  supabase: SupabaseClient,
  companyId: string,
): Promise<CompanyState | null> {
  const { data: company } = await supabase
    .from('companies')
    .select('stage, close_reason')
    .eq('id', companyId)
    .maybeSingle();
  if (!company) return null;

  const [{ data: datasets }, { data: activities }] = await Promise.all([
    supabase.from('datasets').select('status').eq('company_id', companyId),
    supabase.from('activities').select('kind, call_at').eq('company_id', companyId),
  ]);

  const callTimes = (activities ?? [])
    .filter((a) => a.kind === 'call' && a.call_at)
    .map((a) => new Date(a.call_at as string).getTime());

  return {
    stage: company.stage as Stage,
    closeReason: company.close_reason ?? null,
    datasets: (datasets ?? []).map((d) => ({ status: d.status as DatasetStatus })),
    noteCount: (activities ?? []).filter((a) => a.kind === 'note').length,
    callAt: callTimes.length ? new Date(Math.min(...callTimes)) : null,
  };
}

export async function loadStaff(supabase: SupabaseClient): Promise<StaffMember[]> {
  const { data } = await supabase
    .from('crm_staff')
    .select('user_id, full_name, role')
    .order('full_name');
  return (data ?? []) as StaffMember[];
}

// The signed-in user's staff row, or null.
export async function currentStaff(supabase: SupabaseClient): Promise<StaffMember | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('crm_staff')
    .select('user_id, full_name, role')
    .eq('user_id', user.id)
    .maybeSingle();
  return (data as StaffMember | null) ?? null;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
