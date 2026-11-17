-- The owner could not read sales_reports: authenticated users may not call member_role().
create or replace function public.i_am_owner(p_business uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_memberships m
    where m.business_id = p_business and m.user_id = (select auth.uid()) and m.active and m.role = 'owner'
  );
$$;
revoke all on function public.i_am_owner(uuid) from public, anon;
grant execute on function public.i_am_owner(uuid) to authenticated;

drop policy if exists sales_reports_owner_select on public.sales_reports;
create policy sales_reports_owner_select on public.sales_reports for select to authenticated
using (public.i_am_owner(business_id));
