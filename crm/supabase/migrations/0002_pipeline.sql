-- dataleasers CRM: pipeline. Run after 0001_init.sql.
-- The company record owns the stage. Leads stay as the intake record.

-- 1. Company fields for the pipeline
alter table public.companies
  add column if not exists owner_id uuid references auth.users(id),
  add column if not exists introduced_by uuid references auth.users(id),
  add column if not exists source text,
  add column if not exists next_action text,
  add column if not exists next_action_due date,
  add column if not exists close_reason text
    check (close_reason in ('Won', 'Lost', 'Paused', 'Not a fit')),
  add column if not exists closed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.companies drop constraint if exists companies_stage_check;
alter table public.companies
  add constraint companies_stage_check check (stage in (
    'New lead', 'Call booked', 'Data assessed', 'Introduced to Mode',
    'Mode in discussion', 'Owner decision', 'Closed'));

-- A company cannot be Closed without a reason. Closed records are kept, not deleted.
alter table public.companies
  add constraint companies_close_reason_required
  check (stage <> 'Closed' or close_reason is not null);

-- 2. Contacts at a company
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  email text,
  role_title text,
  created_at timestamptz not null default now()
);

-- 3. Notes, calls, emails, decisions. A call with call_at set counts as a booked call.
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('note', 'call', 'email', 'decision')),
  body text,
  call_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint activities_call_needs_time check (kind <> 'call' or call_at is not null)
);

-- 4. Follow-up tasks; these drive reminders
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  due_on date not null,
  assigned_to uuid references auth.users(id),
  done boolean not null default false,
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);

-- 5. Stage history, written by a trigger so it cannot be skipped
create table if not exists public.stage_history (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  changed_by uuid references auth.users(id),
  reason text,
  changed_at timestamptz not null default now()
);

create or replace function public.log_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.stage_history (company_id, from_stage, to_stage, changed_by)
    values (new.id, old.stage, new.stage, auth.uid());
    if new.stage = 'Closed' then
      new.closed_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists companies_stage_history on public.companies;
create trigger companies_stage_history
  before update on public.companies
  for each row execute function public.log_stage_change();

-- 6. Row-level security
alter table public.contacts enable row level security;
alter table public.activities enable row level security;
alter table public.tasks enable row level security;
alter table public.stage_history enable row level security;

create policy "staff read contacts" on public.contacts
  for select using (public.is_staff());
create policy "introducers write contacts" on public.contacts
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read activities" on public.activities
  for select using (public.is_staff());
create policy "introducers write activities" on public.activities
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read tasks" on public.tasks
  for select using (public.is_staff());
create policy "introducers write tasks" on public.tasks
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

-- Stage history is written only by the trigger. Staff can read it.
create policy "staff read stage history" on public.stage_history
  for select using (public.is_staff());

-- Staff can see each other's names and roles, so owner and introducer pickers work.
-- The first policy only let each person read their own row.
create policy "staff read names" on public.crm_staff
  for select using (public.is_staff());

-- Companies are never deleted from the app; closing keeps the record.
