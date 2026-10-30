-- dataleasers CRM: first schema
-- Run in the Supabase SQL editor, or via the Supabase CLI migration flow.

-- Staff accounts. A row here grants CRM access. Created by an admin only.
create table if not exists public.crm_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin', 'introducer', 'reviewer', 'viewer')),
  created_at timestamptz not null default now()
);

-- Website enquiries from the "Book a call" form.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320),
  company text not null check (char_length(company) between 1 and 200),
  role_title text check (char_length(role_title) <= 200),
  data_note text check (char_length(data_note) <= 2000),
  source_page text not null default 'contact',
  stage text not null default 'New lead'
    check (stage in ('New lead', 'Call booked', 'Data assessed', 'Introduced to Mode',
                     'Mode in discussion', 'Owner decision', 'Closed')),
  assigned_to uuid references public.crm_staff(user_id),
  created_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stage text not null default 'New lead',
  lead_id uuid references public.leads(id),
  notes text,
  created_at timestamptz not null default now()
);

-- Dataset rights and consent status. Status is always shown as text in the UI.
create table if not exists public.datasets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  status text not null default 'Review' check (status in ('Approved', 'Review', 'Blocked')),
  status_reason text,
  created_at timestamptz not null default now()
);

-- Append-only record of status and stage changes.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  entity text not null,
  entity_id uuid not null,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- Helper: is the current user an active staff member, optionally with a role?
create or replace function public.is_staff(allowed_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.crm_staff s
    where s.user_id = auth.uid()
      and (allowed_roles is null or s.role = any (allowed_roles))
  );
$$;

-- Row-level security: deny by default, then grant per role.
alter table public.crm_staff enable row level security;
alter table public.leads enable row level security;
alter table public.companies enable row level security;
alter table public.datasets enable row level security;
alter table public.audit_log enable row level security;

-- Staff can see their own row; admins manage staff.
create policy "staff read own row" on public.crm_staff
  for select using (user_id = auth.uid());
create policy "admins manage staff" on public.crm_staff
  for all using (public.is_staff(array['admin'])) with check (public.is_staff(array['admin']));

-- Leads: any active staff can read. Introducers and admins can update stage and assignment.
-- Inserts come only from the server intake route, which uses the service role key.
create policy "staff read leads" on public.leads
  for select using (public.is_staff());
create policy "introducers update leads" on public.leads
  for update using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

-- Companies: read for all staff; write for admins and introducers.
create policy "staff read companies" on public.companies
  for select using (public.is_staff());
create policy "introducers write companies" on public.companies
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

-- Datasets: read for all staff; reviewers and admins set status.
create policy "staff read datasets" on public.datasets
  for select using (public.is_staff());
create policy "reviewers set dataset status" on public.datasets
  for all using (public.is_staff(array['admin', 'reviewer']))
  with check (public.is_staff(array['admin', 'reviewer']));

-- Audit log: admins and reviewers read; nobody updates or deletes through the API.
create policy "admins reviewers read audit" on public.audit_log
  for select using (public.is_staff(array['admin', 'reviewer']));
create policy "staff insert audit" on public.audit_log
  for insert with check (public.is_staff());
