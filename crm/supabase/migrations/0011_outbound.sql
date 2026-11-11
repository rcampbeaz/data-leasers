-- dataleasers CRM: outbound. Run after 0010_company_profile.sql.
--
-- The rules this schema enforces, rather than remembers:
--   * an address on the suppression list is never mailed again, by any sequence;
--   * a first commercial email records the basis it relies on, because the lawful basis
--     differs between the US, Canada, the UK and Australia;
--   * nothing sends until a person approves the enrolment, so a list cannot mail itself;
--   * a reply stops the sequence, whatever step it was on.

-- 1. One row per address that must never be contacted again. Global, not per sequence.
create table if not exists public.suppressions (
  email text primary key check (email = lower(email) and char_length(email) between 3 and 320),
  reason text not null check (reason in ('unsubscribed', 'bounced', 'complaint', 'manual', 'not_a_fit')),
  note text check (char_length(note) <= 1000),
  source text check (char_length(source) <= 200),
  created_at timestamptz not null default now()
);

-- 2. A person we may write to, with the legal basis and where it came from.
create table if not exists public.outreach_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  email text not null check (email = lower(email) and char_length(email) between 3 and 320),
  full_name text check (char_length(full_name) <= 200),
  role_title text check (char_length(role_title) <= 200),
  country text check (char_length(country) = 2),
  basis text not null check (basis in (
    'opt_out_only', 'consent_express', 'consent_implied',
    'existing_relationship', 'corporate_subscriber')),
  basis_note text check (char_length(basis_note) <= 1000),
  source text check (char_length(source) <= 200),
  source_url text check (char_length(source_url) <= 1000),
  -- Unguessable, so an unsubscribe link needs no secret in the URL.
  unsubscribe_token uuid not null default gen_random_uuid(),
  status text not null default 'active'
    check (status in ('active', 'replied', 'bounced', 'unsubscribed', 'paused')),
  created_at timestamptz not null default now(),
  unique (email)
);
create unique index if not exists outreach_contacts_token_key on public.outreach_contacts (unsubscribe_token);
create index if not exists outreach_contacts_company_idx on public.outreach_contacts (company_id);

-- 3. Sequences and their steps. Body text is a draft; sending happens in the cron route.
create table if not exists public.sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  description text check (char_length(description) <= 1000),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  position integer not null check (position between 1 and 20),
  delay_days integer not null default 0 check (delay_days between 0 and 60),
  subject text not null check (char_length(subject) between 1 and 300),
  body text not null check (char_length(body) between 1 and 8000),
  created_at timestamptz not null default now(),
  unique (sequence_id, position)
);

-- 4. A contact moving through a sequence. approved_at is the gate: the cron only sends
-- enrolments a person has approved.
create table if not exists public.sequence_enrolments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  contact_id uuid not null references public.outreach_contacts(id) on delete cascade,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'active', 'sending', 'paused', 'replied', 'completed', 'stopped')),
  current_position integer not null default 0 check (current_position between 0 and 20),
  next_due_on date,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  stopped_reason text check (char_length(stopped_reason) <= 500),
  created_at timestamptz not null default now(),
  unique (sequence_id, contact_id)
);
create index if not exists sequence_enrolments_due_idx on public.sequence_enrolments (next_due_on)
  where status = 'active';

-- 5. What actually went out, kept verbatim, including failures.
create table if not exists public.outbound_sends (
  id bigint generated always as identity primary key,
  enrolment_id uuid references public.sequence_enrolments(id) on delete set null,
  contact_id uuid references public.outreach_contacts(id) on delete set null,
  step_id uuid references public.sequence_steps(id) on delete set null,
  subject text not null,
  body text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  resend_id text,
  error text,
  sent_at timestamptz not null default now()
);
create index if not exists outbound_sends_contact_idx on public.outbound_sends (contact_id, sent_at desc);

-- 6. Claim due enrolments so two cron runs cannot mail the same person twice.
create or replace function public.claim_outbound_sends(batch_size integer default 10)
returns setof public.sequence_enrolments
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.sequence_enrolments e
     set status = 'sending'
   where e.id in (
     select id
       from public.sequence_enrolments
      where status = 'active'
        and approved_at is not null
        and next_due_on is not null
        and next_due_on <= current_date
      order by next_due_on
      limit greatest(batch_size, 1)
      for update skip locked
   )
  returning e.*;
end;
$$;

revoke all on function public.claim_outbound_sends(integer) from public;
revoke all on function public.claim_outbound_sends(integer) from anon;
revoke all on function public.claim_outbound_sends(integer) from authenticated;

-- 7. Row-level security. Suppressions are readable by staff and written by the
-- unsubscribe route (service role) or an introducer; sequences are admin-owned.
alter table public.suppressions enable row level security;
alter table public.outreach_contacts enable row level security;
alter table public.sequences enable row level security;
alter table public.sequence_steps enable row level security;
alter table public.sequence_enrolments enable row level security;
alter table public.outbound_sends enable row level security;

create policy "staff read suppressions" on public.suppressions
  for select using (public.is_staff());
create policy "introducers add suppressions" on public.suppressions
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read contacts" on public.outreach_contacts
  for select using (public.is_staff());
create policy "introducers write contacts" on public.outreach_contacts
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read sequences" on public.sequences
  for select using (public.is_staff());
create policy "admins write sequences" on public.sequences
  for all using (public.is_staff(array['admin']))
  with check (public.is_staff(array['admin']));

create policy "staff read steps" on public.sequence_steps
  for select using (public.is_staff());
create policy "admins write steps" on public.sequence_steps
  for all using (public.is_staff(array['admin']))
  with check (public.is_staff(array['admin']));

create policy "staff read enrolments" on public.sequence_enrolments
  for select using (public.is_staff());
create policy "introducers write enrolments" on public.sequence_enrolments
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read sends" on public.outbound_sends
  for select using (public.is_staff());
