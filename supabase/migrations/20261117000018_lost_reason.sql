-- Why a lead said no: set by the person who marks the chat "Не купит". Cleared automatically when the outcome is no longer 'lost'.
alter table public.conversations add column lost_reason text
  check (lost_reason is null or lost_reason in ('price', 'no_time', 'no_laptop', 'trust', 'other_topic', 'later', 'other'));

create function public._clear_lost_reason() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.outcome is distinct from 'lost' then new.lost_reason := null; end if;
  return new;
end;
$$;
create trigger conversations_clear_lost_reason before update of outcome on public.conversations
  for each row execute function public._clear_lost_reason();

create function public.set_lost_reason(p_conversation uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v public.conversations;
begin
  select * into v from public.conversations where id = p_conversation for update;
  if not found or not public.can_see(v.business_id, v.assigned_to) then raise exception 'not_found'; end if;
  if v.outcome is distinct from 'lost' then raise exception 'not_lost'; end if;
  if p_reason is not null and p_reason not in ('price', 'no_time', 'no_laptop', 'trust', 'other_topic', 'later', 'other') then
    raise exception 'invalid_reason';
  end if;
  update public.conversations set lost_reason = nullif(p_reason, '') where id = v.id;
  return jsonb_build_object('conversation_id', v.id, 'lost_reason', nullif(p_reason, ''));
end;
$$;

revoke all on function public.set_lost_reason(uuid, text) from public, anon;
revoke all on function public._clear_lost_reason() from public, anon, authenticated;
grant execute on function public.set_lost_reason(uuid, text) to authenticated;
