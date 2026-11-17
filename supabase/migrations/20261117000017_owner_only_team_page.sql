-- The team page (statistics, numbers and AI assistants) is for the owner only.
-- The original functions are kept as *_impl; the public names now refuse every role except 'owner'.

alter function public.team_stats(uuid, uuid, timestamptz) rename to team_stats_impl;
alter function public.number_save(uuid, uuid, uuid, jsonb) rename to number_save_impl;
alter function public.number_add(uuid, uuid, text, text, text, uuid) rename to number_add_impl;

create function public.team_stats(p_business uuid, p_user uuid, p_since timestamptz)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if public.member_role(p_business, p_user) is distinct from 'owner' then raise exception 'forbidden'; end if;
  return public.team_stats_impl(p_business, p_user, p_since);
end;
$$;

create function public.number_save(p_business uuid, p_actor uuid, p_number uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if public.member_role(p_business, p_actor) is distinct from 'owner' then raise exception 'forbidden'; end if;
  return public.number_save_impl(p_business, p_actor, p_number, p_patch);
end;
$$;

create function public.number_add(p_business uuid, p_actor uuid, p_phone_number_id text, p_display_phone text, p_label text, p_owner uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if public.member_role(p_business, p_actor) is distinct from 'owner' then raise exception 'forbidden'; end if;
  return public.number_add_impl(p_business, p_actor, p_phone_number_id, p_display_phone, p_label, p_owner);
end;
$$;

revoke execute on function public.team_stats(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.number_save(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.number_add(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.team_stats_impl(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.number_save_impl(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.number_add_impl(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.team_stats(uuid, uuid, timestamptz) to service_role;
grant execute on function public.number_save(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.number_add(uuid, uuid, text, text, text, uuid) to service_role;
grant execute on function public.team_stats_impl(uuid, uuid, timestamptz) to service_role;
grant execute on function public.number_save_impl(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.number_add_impl(uuid, uuid, text, text, text, uuid) to service_role;
