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

-- Returns an abandoned row to the queue as though the claim had never been made: the attempt it spent
-- is handed back, because nothing was recorded either way, and claimed_at is cleared so the next
-- claim starts a fresh clock.
--
-- This cannot know whether the provider accepted the post before the run died, and no test can. For an
-- aggregator that honours the Idempotency-Key the publisher sends (the post id) a second send is
-- harmless; the direct Facebook call carries no such key, so a post that did reach Meta may go out
-- twice. The threshold is therefore generous — a run that finished normally is never swept — and the
-- sweep is for the case where the alternative is losing the post altogether.
--
-- A row claimed before this migration was applied has no claimed_at. Those are genuinely stuck, so they
-- are swept too once their scheduled_for is older than the threshold: the run that claimed them has
-- certainly finished, one way or the other.
create or replace function public.sweep_stale_social_posts(stale_after interval default '15 minutes')
returns setof public.social_posts
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.social_posts p
     set status = 'scheduled',
         attempts = greatest(p.attempts - 1, 0),
         claimed_at = null,
         last_error_code = 'abandoned',
         last_error = 'A publishing run died before recording an outcome; the sweep returned this post to the queue.'
   where p.status = 'publishing'
     and (
       p.claimed_at < now() - stale_after
       or (p.claimed_at is null and p.scheduled_for < now() - stale_after)
     )
  returning p.*;
end;
$$;

revoke all on function public.sweep_stale_social_posts(interval) from public;
revoke all on function public.sweep_stale_social_posts(interval) from anon;
revoke all on function public.sweep_stale_social_posts(interval) from authenticated;
