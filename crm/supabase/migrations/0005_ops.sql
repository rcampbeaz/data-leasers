-- dataleasers CRM: operations. Run after 0004_staff_admin.sql.
-- Agent switch and daily cap, read by the server before any model call.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Agents are OFF until an admin switches them on. Daily cap limits model calls per UTC day.
insert into public.app_settings (key, value)
values ('agents', '{"enabled": false, "daily_cap": 20}')
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

create policy "staff read settings" on public.app_settings
  for select using (public.is_staff());
create policy "admins write settings" on public.app_settings
  for all using (public.is_staff(array['admin']))
  with check (public.is_staff(array['admin']));

-- Staff may mark tasks done (introducers already can write tasks; viewers and reviewers can now complete a task assigned to them).
create policy "assignee completes task" on public.tasks
  for update using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());
