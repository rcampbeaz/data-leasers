-- dataleasers CRM: referral chase. Run after 0013_domain_holds.sql.
--
-- The six-month window is only real if somebody works the last month of it. A daily sweep creates
-- a task when an open referral enters its final 30 days, and this column is what stops it creating
-- a second one on the next run.
--
-- The link is deliberately one task per referral rather than one per threshold: a chase task that
-- reappears every day would be dismissed without being read, and the weekly deadline report already
-- carries the escalating view. on delete set null means a deleted task frees the referral to be
-- chased again, which is the behaviour a person expects after deleting one by mistake.

alter table public.referrals
  add column if not exists chase_task_id uuid references public.tasks(id) on delete set null;

-- The sweep only reads referrals that are close to their deadline and have no chase yet.
create index if not exists referrals_chase_idx
  on public.referrals (deadline_on) where chase_task_id is null;
