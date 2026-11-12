-- dataleasers CRM: step kinds. Run after 0016_email_templates.sql.
--
-- A cadence is not only email. A LinkedIn touch is a thing a person does, not a message a server
-- sends, so it is modelled as a task the sender creates and then treats as completed. Modelling it
-- as an email step would have meant either sending nothing and stalling silently, or pretending a
-- message went out.
--
-- body becomes optional only for these steps: an email without a body is a bug, a task title does
-- not need one.

alter table public.sequence_steps
  add column if not exists kind text not null default 'email';

-- Constraints are added only if absent, so this file is safe to run twice.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sequence_steps_kind_check'
  ) then
    alter table public.sequence_steps
      add constraint sequence_steps_kind_check check (kind in ('email', 'linkedin_task'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sequence_steps_body_required'
  ) then
    alter table public.sequence_steps
      add constraint sequence_steps_body_required check (kind <> 'email' or body is not null);
  end if;
end $$;

alter table public.sequence_steps alter column body drop not null;

-- outbound_sends is the one timeline for what the cadence did, so a created task belongs in it.
-- 'task' is deliberately distinct from 'sent': no message left the building.
alter table public.outbound_sends drop constraint if exists outbound_sends_status_check;
alter table public.outbound_sends
  add constraint outbound_sends_status_check check (status in ('sent', 'failed', 'skipped', 'task'));

-- The queue needs to know whether a claimed enrolment is waiting on a message or on a person, so
-- the count of created tasks is visible without joining tasks back to steps.
alter table public.outbound_sends
  add column if not exists step_kind text check (step_kind in ('email', 'linkedin_task'));

comment on column public.sequence_steps.kind is
  'email sends a message; linkedin_task creates a task for a person and advances the sequence.';
