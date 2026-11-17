-- dataleasers CRM: the sweep clears the console's record of its own failure. Run after
-- 0019_social_claim_recovery.sql.
--
-- Order does not matter here. Applied before the code, nothing calls the widened signature yet, and the
-- old two-argument form is simply gone. Applied after the code, the publisher's widened call is rejected
-- until this file runs, so it falls back to the two-argument form: held posts are still stopped, and the
-- console shows that the database is behind until the next run after this migration clears it.
--
-- The publisher writes a failed sweep into app_settings so the Marketing page can show it. Clearing that
-- record is done here rather than in the publisher, because only this function reaching its end proves
-- the sweep works. A tick that succeeds then costs no extra statement and no extra read, and the delete
-- inside this call touches no rows at all when there is nothing to clear — the common case.
--
-- A tick that fails cannot clear the warning it should be leaving: if the call errors, if the function is
-- missing, if the role has no EXECUTE, or if a stale REST cache never routes the request here, this code
-- does not run. And because the whole call is one transaction, a failure after the delete rolls the
-- delete back.
--
-- The key arrives as an argument rather than as a literal in this file. SWEEP_STATE_KEY in lib/social.ts
-- is what the publisher writes, and a second copy in SQL could drift from it.
--
-- create-or-replace cannot add an argument, so the two-argument form is dropped first; leaving both would
-- let a call that names only the first two match either one.

drop function if exists public.sweep_stale_social_posts(integer, integer);

create or replace function public.sweep_stale_social_posts(
  stale_after_minutes integer,
  max_rows integer default 25,
  clear_state_key text default null
)
returns setof public.social_posts
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A null or non-positive threshold would stop rows from runs that are still alive, which is the one
  -- thing this must never do. Refuse instead of letting greatest() quietly turn it into a minute. Raised
  -- before the delete, so a bad call leaves the warning where it is.
  if stale_after_minutes is null or stale_after_minutes < 1 then
    raise exception 'sweep_stale_social_posts needs a threshold of at least one minute, got %',
      stale_after_minutes;
  end if;

  if clear_state_key is not null then
    delete from public.app_settings where public.app_settings.key = clear_state_key;
  end if;

  return query
  update public.social_posts p
     set status = 'needs_manual',
         claimed_at = null,
         next_retry_at = null,
         last_error_code = 'abandoned_run',
         last_error = 'The publishing run died before recording an outcome. The post may already be live on the channel.'
   where p.id in (
     select id
       from public.social_posts
      where status = 'publishing'
        and (
          claimed_at < now() - make_interval(mins => greatest(stale_after_minutes, 1))
          or (
            claimed_at is null
            and scheduled_for < now() - make_interval(mins => greatest(stale_after_minutes, 1))
          )
        )
      order by coalesce(claimed_at, scheduled_for)
      limit greatest(coalesce(max_rows, 1), 1)
      for update skip locked
   )
  returning p.*;
end;
$$;

revoke all on function public.sweep_stale_social_posts(integer, integer, text) from public;
revoke all on function public.sweep_stale_social_posts(integer, integer, text) from anon;
revoke all on function public.sweep_stale_social_posts(integer, integer, text) from authenticated;

-- The signature changed again, so the REST layer's cached schema is stale until it reloads.
notify pgrst, 'reload schema';
