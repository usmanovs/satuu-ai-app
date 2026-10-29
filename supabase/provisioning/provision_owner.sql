-- One-time owner provisioning. Run in the Supabase SQL editor (runs as `postgres`, bypassing RLS).
-- Users can NOT do this themselves: business_memberships has no INSERT policy and no write grants.
--
-- Before running:
--   1. Authentication -> Users -> "Add user" (email + password, tick "Auto Confirm User").
--   2. Authentication -> Sign In / Providers -> turn OFF "Allow new users to sign up".
--   3. Edit the two values below.

do $$
declare
  v_email    text := 'owner@example.com';       -- <-- the manager's login email
  v_business text := 'Название вашего бизнеса'; -- <-- business display name
  v_user     uuid;
  v_biz      uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then
    raise exception 'No auth user with email %. Create the user in Authentication -> Users first.', v_email;
  end if;

  if exists (select 1 from public.business_memberships where user_id = v_user) then
    raise exception 'User % already belongs to a business.', v_email;
  end if;

  insert into public.businesses (name) values (v_business) returning id into v_biz;
  insert into public.business_memberships (business_id, user_id, role) values (v_biz, v_user, 'owner');

  raise notice 'business_id = %  (put it into the n8n workflows as SATUU_BUSINESS_ID)', v_biz;
end $$;

select b.id as business_id, b.name, u.email
from public.businesses b
join public.business_memberships m on m.business_id = b.id
join auth.users u on u.id = m.user_id;
