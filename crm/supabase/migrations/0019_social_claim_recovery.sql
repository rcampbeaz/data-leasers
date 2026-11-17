-- dataleasers CRM: recovering a post whose publishing run died. Run after 0018_social_media_storage.sql.
--
-- claim_social_posts marks a row 'publishing' and spends an attempt before any provider is called. If
-- the run dies between that and recording an outcome — a deploy, an OOM, a killed process — the row
-- stays 'publishing' for ever. The claim only takes 'scheduled' and 'failed', and the console only
-- offers actions on those, so nothing can move it: it is invisible to the queue while still holding
-- the attempt it spent.
--
-- claimed_at makes the age of a claim knowable, which is what a sweep needs.

alter table public.social_posts
  add column if not exists claimed_at timestamptz;

create index if not exists social_posts_stuck_idx
  on public.social_posts (claimed_at)
  where status = 'publishing';

-- The same claim as before, plus the timestamp. Replaced rather than dropped so the grants below are
-- the only thing that has to be reasserted.
create or replace function public.claim_social_posts(batch_size integer default 10)
returns setof public.social_posts
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.social_posts p
     set status = 'publishing',
         attempts = p.attempts + 1,
         claimed_at = now(),
         last_error = null
   where p.id in (
     select id
       from public.social_posts
      where status in ('scheduled', 'failed')
        and scheduled_for <= now()
        and (next_retry_at is null or next_retry_at <= now())
      order by scheduled_for
      limit greatest(batch_size, 1)
      for update skip locked
   )
  returning p.*;
end;
$$;

revoke all on function public.claim_social_posts(integer) from public;
revoke all on function public.claim_social_posts(integer) from anon;
revoke all on function public.claim_social_posts(integer) from authenticated;

-- An abandoned row goes to 'needs_manual', NOT back into the queue.
--
-- There is no way to find out whether the provider accepted the post before the run died. The two
-- endings look identical from here: no row update either way. Idempotency does not settle it either,
-- because the aggregator is only one of the paths — publishPost calls the Facebook Graph API directly
-- with the page token, and Graph has no idempotency key, so a second send is a second post on the
-- client's public page.
--
-- A longer threshold does not make re-sending safe. Time is not evidence that the send failed: a
-- crashed run can leave the post accepted and unrecorded within milliseconds, and the slowest, most
-- suspicious deaths of all — a hung socket, a killed container mid-request — are precisely the ones
-- where the provider most likely did accept it and only the response was lost. Any threshold that
-- catches a dead run catches this case too.
--
-- So the sweep stops the post where a person is looking at it. That costs one click: Retry zeroes
-- attempts and puts the row back in the queue for the next tick. Sending it again costs a duplicate
-- on the client's account that only they can delete. The attempt stays spent, because it did happen.
--
-- The threshold then only has to keep the sweep away from a run that is still working: a few minutes
-- against a send that normally takes seconds. It has no default here on purpose: a default would be a
-- second copy of the number that could drift from the code. The publisher always passes
-- SWEEP_AFTER_MINUTES from lib/social.ts, which is also what the queue's note reads.
--
-- A row claimed before this migration was applied has no claimed_at, so scheduled_for is used as its
-- clock instead — by then the claiming run has certainly finished, one way or the other.
--
-- It is capped at 25 rows per call. One outage can abandon a hundred posts at once, and the publisher
-- alerts on each sweep: a cap means one bounded message and a bounded amount of work before new posts
-- are claimed, with the remainder picked up on the next tick a few minutes later.

-- Earlier drafts of this file used an interval argument, or an integer one with a default. Drop by
-- signature rather than relying on create-or-replace: replace cannot change an argument's type, and it
-- refuses outright if an input parameter was renamed, so a database that ran one of those drafts would
-- otherwise fail here or end up with two overloads for PostgREST to choose between.
drop function if exists public.sweep_stale_social_posts(interval);
drop function if exists public.sweep_stale_social_posts(interval, integer);
drop function if exists public.sweep_stale_social_posts(integer, integer);

create or replace function public.sweep_stale_social_posts(
  stale_after_minutes integer,
  max_rows integer default 25
)
returns setof public.social_posts
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A null or non-positive threshold would stop rows from runs that are still alive, which is the one
  -- thing this must never do. Refuse instead of letting greatest() quietly turn it into a minute.
  if stale_after_minutes is null or stale_after_minutes < 1 then
    raise exception 'sweep_stale_social_posts needs a threshold of at least one minute, got %',
      stale_after_minutes;
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

revoke all on function public.sweep_stale_social_posts(integer, integer) from public;
revoke all on function public.sweep_stale_social_posts(integer, integer) from anon;
revoke all on function public.sweep_stale_social_posts(integer, integer) from authenticated;

-- Both functions were replaced and one signature changed, so the REST layer's cached schema is stale
-- until it reloads. Without this, the publisher's first calls after the migration can 404 on the RPC.
notify pgrst, 'reload schema';
