import { createStaffClient } from '@/lib/supabase';
import { STAGES, normalizeStage } from '@/lib/pipeline';
import { todayIso } from '@/lib/data';
import PipelineBoard, { type BoardCompany } from './board';

export default async function PipelinePage() {
  const supabase = await createStaffClient();
  const [{ data, error }, { data: history }] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, stage, next_action, next_action_due')
      .order('updated_at', { ascending: false }),
    supabase
      .from('stage_history')
      .select('company_id, changed_at')
      .order('changed_at', { ascending: false })
      .limit(2000),
  ]);

  // The newest stage change is when the company entered the stage it is in now.
  const enteredAt = new Map<string, string>();
  for (const row of (history ?? []) as { company_id: string; changed_at: string }[]) {
    if (!enteredAt.has(row.company_id)) enteredAt.set(row.company_id, row.changed_at);
  }

  const companies = ((data ?? []) as BoardCompany[]).map((c) => ({
    ...c,
    stage: normalizeStage(c.stage),
    entered_on: enteredAt.get(c.id) ?? null,
  }));

  return (
    <main className="page">
      <header className="page-head">
        <h1>Pipeline</h1>
        <p className="muted">
          Drag a company to another stage. To close a company, open it and choose a close reason.
          Blocked datasets keep a company at Data assessed or earlier.
        </p>
      </header>

      {error ? <p className="notice blocked">Could not load the pipeline. Check your staff access.</p> : null}

      <PipelineBoard companies={companies} stages={STAGES} today={todayIso()} />
    </main>
  );
}
