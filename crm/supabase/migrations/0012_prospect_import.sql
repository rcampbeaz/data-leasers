-- dataleasers CRM: prospect import. Run after 0011_outbound.sql.
--
-- Sourcing writes candidates here, never straight into the pipeline. A person accepts or
-- rejects each one, and the score plus its reasons travel with the row so the decision can
-- be reviewed later. The unique key is (source, source_id), so re-running the same search
-- cannot duplicate a candidate or overwrite a decision already made.

create table if not exists public.import_candidates (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'companies_house' check (source in ('companies_house')),
  -- The register's own identifier: the company number.
  source_id text not null check (char_length(source_id) between 1 and 100),
  source_url text check (char_length(source_url) <= 500),
  retrieved_at timestamptz not null default now(),

  company_name text not null check (char_length(company_name) between 1 and 300),
  -- Normalised name, computed by lib/companies-house.ts, used for de-duplication.
  name_key text not null check (char_length(name_key) between 1 and 200),
  registration_number text check (char_length(registration_number) <= 100),
  company_type text check (char_length(company_type) <= 100),
  company_status text check (char_length(company_status) <= 60),
  incorporated_on date,
  sic_codes text[] not null default '{}'::text[],
  industry text check (char_length(industry) <= 100),

  region text check (char_length(region) <= 120),
  locality text check (char_length(locality) <= 120),
  postcode text check (char_length(postcode) <= 30),
  address_line1 text check (char_length(address_line1) <= 200),
  address_line2 text check (char_length(address_line2) <= 200),

  score integer not null default 0 check (score between 0 and 100),
  band text not null default 'weak' check (band in ('strong', 'review', 'weak')),
  reasons jsonb not null default '[]'::jsonb,

  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'duplicate')),
  -- Set when the candidate matched a company already in the CRM.
  matched_company_id uuid references public.companies(id) on delete set null,
  note text check (char_length(note) <= 1000),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),

  unique (source, source_id)
);

create index if not exists import_candidates_status_idx
  on public.import_candidates (status, score desc);
create index if not exists import_candidates_name_key_idx
  on public.import_candidates (name_key);
create index if not exists import_candidates_band_idx
  on public.import_candidates (band) where status = 'pending';

alter table public.import_candidates enable row level security;

create policy "staff read import candidates" on public.import_candidates
  for select using (public.is_staff());

-- Sourcing is introducer work; reviewers are deliberately excluded so the queue a reviewer
-- sees stays the dataset review queue.
create policy "introducers write import candidates" on public.import_candidates
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));
