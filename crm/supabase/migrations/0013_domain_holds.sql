-- dataleasers CRM: domain holds. Run after 0012_prospect_import.sql.
--
-- A hold is a persisted decision to stop sending to one recipient domain, taken by the hourly
-- sweep when that domain's complaint rate crosses the stop threshold. It is a row rather than a
-- computed value because the sender reads it on every message: computing a 30-day rate for each
-- send would be a scan per recipient, and the sender has to be able to answer "is this domain
-- safe?" cheaply.
--
-- Releasing is deliberate. The rolling window forgets a complaint after 30 days, but reputation
-- does not recover that fast, so a released domain is not re-held for a week even if its rate is
-- still over the line. That cooldown is what stops a person and the sweep fighting each other.

create table if not exists public.domain_holds (
  domain text primary key check (
    domain = lower(domain) and char_length(domain) between 3 and 253 and domain like '%.%'
  ),
  reason text not null check (char_length(reason) between 1 and 500),
  sent integer not null default 0 check (sent >= 0),
  complained integer not null default 0 check (complained >= 0),
  complaint_rate double precision,
  window_days integer not null default 30 check (window_days between 1 and 365),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references auth.users(id)
);

create index if not exists domain_holds_active_idx
  on public.domain_holds (domain) where released_at is null;

alter table public.domain_holds enable row level security;

create policy "staff read domain holds" on public.domain_holds
  for select using (public.is_staff());

create policy "introducers write domain holds" on public.domain_holds
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));
