-- RLS helper functions answer only about auth.uid(); signed-out callers have no reason to execute them.
revoke execute on function public.can_see(uuid, uuid) from public, anon;
revoke execute on function public.can_see_conversation(uuid) from public, anon;
revoke execute on function public.can_see_contact(uuid) from public, anon;
revoke execute on function public.is_business_member(uuid) from public, anon;
grant execute on function public.can_see(uuid, uuid) to authenticated;
grant execute on function public.can_see_conversation(uuid) to authenticated;
grant execute on function public.can_see_contact(uuid) to authenticated;
grant execute on function public.is_business_member(uuid) to authenticated;
