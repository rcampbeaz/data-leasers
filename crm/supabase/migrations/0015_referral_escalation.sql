-- dataleasers CRM: referral escalation. Run after 0014_referral_chase.sql.
--
-- One chase at 30 days is easy to dismiss, and a referral that is still unsigned with a week left
-- is the one that gets lost. The escalation task is a second, separate record linked from its own
-- column: a separate column rather than a flag on the first task, because the two tasks have
-- different titles, different due dates and can be completed independently.
--
-- on delete set null, as with the first chase, so deleting a task frees the referral to be chased
-- again rather than leaving a dangling reference and a silent gap.

alter table public.referrals
  add column if not exists escalation_task_id uuid references public.tasks(id) on delete set null;

create index if not exists referrals_escalation_idx
  on public.referrals (deadline_on) where escalation_task_id is null;
