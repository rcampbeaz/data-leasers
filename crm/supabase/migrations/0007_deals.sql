-- dataleasers CRM: the deal. Run after 0006_staff_profiles.sql.
-- Until now the schema held no money and no buyer: the pipeline named one buyer in a
-- stage label. This adds the records a licensing deal actually needs.

-- 1. Buyers: a program, an AI lab, or a broker we can introduce a company to.
create table if not exists public.buyers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  kind text not null default 'program' check (kind in ('program', 'lab', 'broker')),
  notes text check (char_length(notes) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists buyers_name_key on public.buyers (lower(name));

-- 2. An introduction, recorded once per company and buyer.
create table if not exists public.introductions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  introduced_on date not null default current_date,
  introduced_by uuid references auth.users(id),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  unique (company_id, buyer_id)
);
create index if not exists introductions_company_idx on public.introductions (company_id);

-- 3. Offers. Amount is money the buyer offered the company, not a fee we charge.
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  introduction_id uuid references public.introductions(id) on delete set null,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  term_months integer check (term_months between 0 and 120),
  exclusivity_months integer check (exclusivity_months between 0 and 120),
  status text not null default 'offered'
    check (status in ('offered', 'accepted', 'declined', 'withdrawn')),
  offered_on date not null default current_date,
  decided_on date,
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists offers_company_idx on public.offers (company_id, offered_on desc);
create index if not exists offers_status_idx on public.offers (status);

-- 4. Referral partners. These are outside people, not staff accounts, so they need
-- their own record: the website publishes a fee and a six-month signing window.
create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  email text check (char_length(email) <= 320),
  organisation text check (char_length(organisation) <= 200),
  fee_rate numeric(5,4) not null default 0.0600 check (fee_rate >= 0 and fee_rate <= 1),
  fee_floor numeric(14,2) not null default 50000 check (fee_floor >= 0),
  notes text check (char_length(notes) <= 2000),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 5. A registered referral. deadline_on is set by the app as registered_on + 6 months
-- and is stored, so a later change to the rule cannot rewrite history.
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  company_name text not null check (char_length(company_name) between 1 and 200),
  registered_on date not null default current_date,
  deadline_on date not null,
  status text not null default 'registered'
    check (status in ('registered', 'introduced', 'signed', 'paid', 'lapsed', 'declined')),
  fee_amount numeric(14,2) check (fee_amount >= 0),
  paid_on date,
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  check (deadline_on >= registered_on)
);
create index if not exists referrals_partner_idx on public.referrals (partner_id, registered_on desc);
create index if not exists referrals_deadline_idx on public.referrals (deadline_on);

-- 6. The agreement, with the dates that carry obligations.
create table if not exists public.agreements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete set null,
  buyer_id uuid references public.buyers(id) on delete set null,
  licence_start date not null,
  licence_end date,
  exclusivity_end date,
  delivered_on date,
  deletion_due date,
  audit_right boolean not null default false,
  status text not null default 'signed' check (status in ('draft', 'signed', 'ended')),
  signed_on date,
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists agreements_company_idx on public.agreements (company_id);
create index if not exists agreements_deletion_idx on public.agreements (deletion_due);

-- 7. Documents. Metadata and a link; the file itself lives outside this table.
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dataset_id uuid references public.datasets(id) on delete set null,
  kind text not null default 'rights-file'
    check (kind in ('rights-file', 'agreement', 'nda', 'export-manifest', 'other')),
  title text not null check (char_length(title) between 1 and 200),
  location text check (char_length(location) <= 1000),
  signed_on date,
  notes text check (char_length(notes) <= 2000),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists documents_company_idx on public.documents (company_id, created_at desc);

-- 8. The pipeline stops naming one buyer.
alter table public.companies drop constraint if exists companies_stage_check;
update public.companies set stage = 'Introduced to buyer' where stage = 'Introduced to Mode';
update public.companies set stage = 'Buyer in discussion' where stage = 'Mode in discussion';
update public.stage_history set from_stage = 'Introduced to buyer' where from_stage = 'Introduced to Mode';
update public.stage_history set to_stage = 'Introduced to buyer' where to_stage = 'Introduced to Mode';
update public.stage_history set from_stage = 'Buyer in discussion' where from_stage = 'Mode in discussion';
update public.stage_history set to_stage = 'Buyer in discussion' where to_stage = 'Mode in discussion';
alter table public.companies
  add constraint companies_stage_check check (stage in (
    'New lead', 'Call booked', 'Data assessed', 'Introduced to buyer',
    'Buyer in discussion', 'Owner decision', 'Closed'));

-- 9. Row-level security: all staff read, admins and introducers write. Reviewers
-- can see the deal without being able to change it.
alter table public.buyers enable row level security;
alter table public.introductions enable row level security;
alter table public.offers enable row level security;
alter table public.partners enable row level security;
alter table public.referrals enable row level security;
alter table public.agreements enable row level security;
alter table public.documents enable row level security;

create policy "staff read buyers" on public.buyers
  for select using (public.is_staff());
create policy "introducers write buyers" on public.buyers
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read introductions" on public.introductions
  for select using (public.is_staff());
create policy "introducers write introductions" on public.introductions
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read offers" on public.offers
  for select using (public.is_staff());
create policy "introducers write offers" on public.offers
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read partners" on public.partners
  for select using (public.is_staff());
create policy "introducers write partners" on public.partners
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read referrals" on public.referrals
  for select using (public.is_staff());
create policy "introducers write referrals" on public.referrals
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read agreements" on public.agreements
  for select using (public.is_staff());
create policy "introducers write agreements" on public.agreements
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));

create policy "staff read documents" on public.documents
  for select using (public.is_staff());
create policy "introducers write documents" on public.documents
  for all using (public.is_staff(array['admin', 'introducer']))
  with check (public.is_staff(array['admin', 'introducer']));
