-- dataleasers CRM: erasing a partner's details without losing the ledger.
-- Run after 0007_deals.sql.

-- A partner is an outside person, so an erasure request covers their name, email,
-- organisation and notes. Deleting the row would cascade the referrals (referrals
-- reference partners on delete cascade) and destroy the fee history the ledger
-- exists to keep. So erasure clears the contact details in place and records when
-- it happened, leaving the referral and its fee intact.
alter table public.partners
  add column if not exists erased_at timestamptz;

comment on column public.partners.erased_at is
  'Set when the partner asked for their details to be erased: name, email, organisation and notes are cleared, the referral ledger stays.';

-- Existing policies already let admins update partners; nothing to add here.
