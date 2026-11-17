-- dataleasers CRM: outbound steps fall due on the console's day, not the database's. Run after
-- 0011_outbound.sql.
--
-- sequence_enrolments.next_due_on is a calendar date on the Phoenix clock: the send route and the enrol
-- action both write it with phoenixDay in lib/time.ts, so a step scheduled for "today" is stored as the
-- Phoenix day. The claim compared that date against current_date, which is the session's day — UTC on
-- Supabase. The two clocks part company at 5pm Phoenix, when UTC is already tomorrow: a step stored for
-- tomorrow was then claimable this evening. The person on the other end of that email is what would find
-- out first.
--
-- The comparison now names the zone instead of reading the session timezone, so it agrees with the code
-- whatever the database is set to. Both sides are dates, so no timestamp-to-day conversion happens on the
-- stored value and nothing can shift by a zone: `next_due_on` stays the day it was written.
--
-- Order does not matter here, and nothing is skipped either way. The clocks differ by seven hours, so a
-- step enrolled between 5pm and midnight Phoenix waits up to seven hours for the next Phoenix day if this
-- file runs before the code that writes Phoenix days; if it runs after, the early claim above lasts until
-- it does. Either way a step goes out late or early by hours, never unclaimed for a whole day, and never
-- twice: the claim is still the update that marks the row 'sending'.
--
-- Signature, return type, grants and the claim query are unchanged; only the day it is compared to is.

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
        and next_due_on <= (now() at time zone 'America/Phoenix')::date
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
