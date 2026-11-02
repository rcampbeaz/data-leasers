-- dataleasers CRM: agent layer. Run after 0002_pipeline.sql.
-- Agents only create drafts. Nothing leaves the CRM until a staff member approves it.

-- 1. Each model call an agent makes
create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null check (agent in ('lead_triage', 'follow_up_drafter', 'content_drafter')),
  company_id uuid references public.companies(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  model text not null,
  input_summary text,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  error text,
  prompt_tokens integer,
  completion_tokens integer,
  requested_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- 2. Drafts produced by a run. Never sent automatically.
create table if not exists public.agent_drafts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  kind text not null check (kind in ('triage_summary', 'follow_up_email', 'content')),
  title text,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'sent')),
  created_at timestamptz not null default now()
);

-- 3. Approval decisions. A draft is approved only by a staff row written here.
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.agent_drafts(id) on delete cascade,
  decision text not null check (decision in ('approved', 'rejected')),
  decided_by uuid references auth.users(id),
  note text,
  decided_at timestamptz not null default now()
);

-- Keep the draft status in step with the latest approval decision.
create or replace function public.apply_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.agent_drafts set status = new.decision where id = new.draft_id;
  return new;
end;
$$;

drop trigger if exists approvals_apply on public.approvals;
create trigger approvals_apply
  after insert on public.approvals
  for each row execute function public.apply_approval();

-- 4. Row-level security: staff read; admins and introducers act. Agents run with the
-- service role on the server, which bypasses RLS, so no insert policy is needed for them.
alter table public.agent_runs enable row level security;
alter table public.agent_drafts enable row level security;
alter table public.approvals enable row level security;

create policy "staff read agent runs" on public.agent_runs
  for select using (public.is_staff());

create policy "staff read agent drafts" on public.agent_drafts
  for select using (public.is_staff());
create policy "introducers review drafts" on public.agent_drafts
  for update using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read approvals" on public.approvals
  for select using (public.is_staff());
create policy "introducers record approvals" on public.approvals
  for insert with check (
    public.is_staff(array['admin', 'introducer'])
    and decided_by = auth.uid()
  );
