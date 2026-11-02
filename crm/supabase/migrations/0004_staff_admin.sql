-- dataleasers CRM: staff administration. Run after 0003_agents.sql.
-- Lets an admin add a staff member by email without exposing the auth user table.

create or replace function public.staff_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id
  from auth.users u
  where public.is_staff(array['admin'])
    and lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.staff_user_id_by_email(text) from public;
grant execute on function public.staff_user_id_by_email(text) to authenticated;
