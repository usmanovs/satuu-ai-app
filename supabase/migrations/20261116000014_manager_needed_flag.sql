-- The bot flags a conversation when a person on the sales team should step in (installments, invoices,
-- refunds, mentorship details, anything it cannot answer). The dashboard shows it until a manager opens the
-- chat (manager_last_read_at moves past manager_needed_at). The AI keeps answering; nothing is paused.

alter table public.conversations
  add column manager_needed_at timestamptz,
  add column manager_needed_reason text;

create function public.flag_manager_needed(p_business uuid, p_wa_id text, p_reason text, p_phone_number_id text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv uuid;
  v_phone text := case when trim(coalesce(p_phone_number_id, '')) ~ '^[0-9]{5,25}$' then trim(p_phone_number_id) end;
  v_row public.conversations;
begin
  v_conv := public._conversation_for(p_business, p_wa_id, v_phone);
  if v_conv is null then raise exception 'not_found'; end if;
  perform 1 from public.conversations where id = v_conv for update;

  select * into v_row from public.conversations where id = v_conv;
  -- a manager has not yet looked since the last flag: keep the original time, only refresh the reason
  if v_row.manager_needed_at is not null
     and (v_row.manager_last_read_at is null or v_row.manager_last_read_at < v_row.manager_needed_at) then
    update public.conversations
       set manager_needed_reason = nullif(left(trim(coalesce(p_reason, '')), 200), '')
     where id = v_conv;
    return jsonb_build_object('conversation_id', v_conv, 'flagged', true, 'new', false);
  end if;

  update public.conversations
     set manager_needed_at = now(),
         manager_needed_reason = nullif(left(trim(coalesce(p_reason, '')), 200), '')
   where id = v_conv;
  return jsonb_build_object('conversation_id', v_conv, 'flagged', true, 'new', true);
end;
$$;

revoke execute on function public.flag_manager_needed(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.flag_manager_needed(uuid, text, text, text) to service_role;
