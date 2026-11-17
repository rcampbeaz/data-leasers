-- dataleasers CRM: the deal dates that default to "today" mean today in Phoenix. Run after
-- 0007_deals.sql.
--
-- Three date columns in the schema carry a default that fills in a day:
-- introductions.introduced_on, offers.offered_on and referrals.registered_on. All three said
-- current_date, which is the session's day — UTC on Supabase. From 5pm Phoenix the two differ, and a
-- row inserted without its date was dated tomorrow.
--
-- introduced_on and offered_on are reached in normal use, not just by hand: lib/deal-actions.ts writes
-- them as `?? undefined`, so leaving the date field blank in the introduction or offer form omits the
-- column and lets this default decide. registered_on is always supplied by the referral action, where the
-- default is a safety net for an insert typed into the SQL editor.
--
-- Only the defaults change. The stored values are dates, and a date column cannot shift by a zone, so
-- existing rows are untouched and the nullable columns beside these are unaffected.
--
-- The rest of the SQL was checked for the same mistake, and this is the last of it. The only other use of
-- current_date was the outbound claim in 0011, which 0021 replaced. There are no views, no generated
-- columns and no other date defaults. Every remaining now() default is on a timestamptz, where an instant
-- is exactly what is wanted, and the sweep in 0019/0020 compares instants with intervals, not days.
--
-- now() at time zone 'America/Phoenix' is stable within a statement, so several rows inserted in one
-- statement all get the same day, which is what current_date gave and what callers expect.

alter table public.introductions
  alter column introduced_on set default (now() at time zone 'America/Phoenix')::date;

alter table public.offers
  alter column offered_on set default (now() at time zone 'America/Phoenix')::date;

alter table public.referrals
  alter column registered_on set default (now() at time zone 'America/Phoenix')::date;
