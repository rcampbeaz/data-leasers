import { createStaffClient } from '@/lib/supabase';
import { STAGES } from '@/lib/pipeline';
import { todayIso } from '@/lib/data';
import PipelineBoard, { type BoardCompany } from './board';

export default async function PipelinePage() {
  const supabase = await createStaffClient();
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, stage, next_action, next_action_due')
    .order('updated_at', { ascending: false });

  const companies = (data ?? []) as BoardCompany[];

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
