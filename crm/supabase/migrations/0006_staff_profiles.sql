-- dataleasers CRM: staff profiles. Run after 0005_ops.sql.
-- Contact details are kept in a separate table. crm_staff is readable by all staff,
-- so personal details (phone, address) must not live there.

create table if not exists public.crm_staff_profiles (
  user_id uuid primary key references public.crm_staff(user_id) on delete cascade,
  email text check (char_length(email) <= 320),
  phone text check (char_length(phone) <= 40),
  job_title text check (char_length(job_title) <= 200),
  address_line1 text check (char_length(address_line1) <= 200),
  address_line2 text check (char_length(address_line2) <= 200),
  city text check (char_length(city) <= 100),
  region text check (char_length(region) <= 100),
  postcode text check (char_length(postcode) <= 20),
  country text check (char_length(country) <= 100),
  notes text check (char_length(notes) <= 2000),
  updated_at timestamptz not null default now()
);

-- Backfill the login email for people already on the staff list.
insert into public.crm_staff_profiles (user_id, email)
select s.user_id, lower(u.email)
from public.crm_staff s
join auth.users u on u.id = s.user_id
on conflict (user_id) do nothing;

alter table public.crm_staff_profiles enable row level security;

-- Only admins can read or change personal details.
create policy "admins manage staff profiles" on public.crm_staff_profiles
  for all using (public.is_staff(array['admin']))
  with check (public.is_staff(array['admin']));
