-- dataleasers CRM: the company profile. Run after 0009_social.sql.
--
-- The pipeline recorded who a company is talking to but almost nothing about the
-- company itself. Buyer diligence asks for the registered name, the address, the
-- headcount and where the staff actually sit, and the published eligibility rule is
-- about staff countries rather than where the office happens to be.

alter table public.companies
  add column if not exists legal_name text check (char_length(legal_name) <= 200),
  add column if not exists website text check (char_length(website) <= 300),
  add column if not exists industry text check (char_length(industry) <= 100),
  add column if not exists employee_count integer check (employee_count between 0 and 1000000),
  add column if not exists founded_year integer check (founded_year between 1800 and 2200),
  add column if not exists registration_number text check (char_length(registration_number) <= 100),
  add column if not exists phone text check (char_length(phone) <= 60),
  -- Registered or trading address. Kept in parts so it can be printed on an agreement
  -- and sorted by country without splitting a free-text blob.
  add column if not exists address_line1 text check (char_length(address_line1) <= 200),
  add column if not exists address_line2 text check (char_length(address_line2) <= 200),
  add column if not exists city text check (char_length(city) <= 120),
  add column if not exists region text check (char_length(region) <= 120),
  add column if not exists postal_code text check (char_length(postal_code) <= 30),
  add column if not exists country text check (char_length(country) = 2),
  -- Where the staff are, not where the head office is. The buyer's rule is about the
  -- share of staff in the US, Canada, the UK or Australia.
  add column if not exists staff_countries text[] not null default '{}'::text[];

comment on column public.companies.staff_countries is
  'ISO 3166-1 alpha-2 codes for the countries the staff work in, e.g. {US,CA}.';
comment on column public.companies.country is
  'Two-letter country of the registered address.';

-- Contacts: a phone number and a profile link are the two things needed to reach a
-- person without an introduction email being forwarded around an organisation.
alter table public.contacts
  add column if not exists phone text check (char_length(phone) <= 60),
  add column if not exists linkedin_url text check (char_length(linkedin_url) <= 500);

-- Partners are outside organisations that send companies in, so they need the same
-- identifying details as a company: what the entity is and where to post a fee note.
alter table public.partners
  add column if not exists country text check (char_length(country) = 2),
  add column if not exists website text check (char_length(website) <= 300),
  add column if not exists address_line1 text check (char_length(address_line1) <= 200),
  add column if not exists city text check (char_length(city) <= 120),
  add column if not exists region text check (char_length(region) <= 120),
  add column if not exists postal_code text check (char_length(postal_code) <= 30);

-- Buyers are organisations too; a diligence pack names the entity and its address.
alter table public.buyers
  add column if not exists legal_name text check (char_length(legal_name) <= 200),
  add column if not exists website text check (char_length(website) <= 300),
  add column if not exists country text check (char_length(country) = 2),
  add column if not exists contact_email text check (char_length(contact_email) <= 320);
