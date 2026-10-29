-- Coexistence support: a message the manager types in the WhatsApp Business app (same number as the AI)
-- arrives from Meta as an smb_message_echoes event. ingest_manager_echo() records it as a MANAGER
-- message and pauses the AI for that conversation (-> human_handling), so the bot never talks over a person.
-- Idempotent on provider_message_id. The customer-service window is NOT affected (only customer messages open it).

create function public.ingest_manager_echo(
  p_business uuid, p_to_wa_id text, p_provider_message_id text, p_type text,
  p_text text, p_ts timestamptz, p_phone_number_id text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_contact uuid;
  v_conv public.conversations;
  v_msg uuid;
  v_body text;
  v_changed boolean := false;
  v_ts timestamptz := coalesce(p_ts, now());
  v_type text := lower(coalesce(nullif(trim(p_type), ''), 'text'));
  v_text text := nullif(trim(coalesce(p_text, '')), '');
  v_phone text := case when trim(coalesce(p_phone_number_id, '')) ~ '^[0-9]{5,25}$' then trim(p_phone_number_id) end;
begin
  if coalesce(trim(p_to_wa_id), '') = '' then raise exception 'invalid_sender_id'; end if;
  if coalesce(trim(p_provider_message_id), '') = '' then raise exception 'invalid_provider_message_id'; end if;
  if v_type in ('status', 'statuses', 'receipt', 'delivery', 'sent', 'delivered', 'read', 'failed') then
    raise exception 'not_a_message';
  end if;

  v_body := case
    when v_text is not null and v_type in ('text', 'button', 'interactive') then v_text
    when v_text is not null then '[Менеджер отправил в приложении WhatsApp: ' || v_type || '] ' || v_text
    else '[Менеджер отправил в приложении WhatsApp: ' || v_type || ']'
  end;
  v_body := left(v_body, 4096);

  insert into public.contacts (business_id, wa_id)
  values (p_business, trim(p_to_wa_id))
  on conflict (business_id, wa_id) do nothing;
  select id into v_contact from public.contacts where business_id = p_business and wa_id = trim(p_to_wa_id);

  insert into public.conversations (business_id, contact_id)
  values (p_business, v_contact)
  on conflict (business_id, contact_id) do nothing;

  select * into v_conv from public.conversations
  where business_id = p_business and contact_id = v_contact for update;

  insert into public.messages (business_id, conversation_id, provider_message_id, sender_role, direction,
                               message_type, body, is_placeholder, message_timestamp, status, status_updated_at)
  values (p_business, v_conv.id, trim(p_provider_message_id), 'manager', 'outbound',
          v_type, v_body, not (v_text is not null and v_type in ('text', 'button', 'interactive')), v_ts, 'sent', v_ts)
  on conflict (business_id, provider_message_id) do nothing
  returning id into v_msg;

  update public.businesses
     set wa_phone_number_id = coalesce(v_phone, wa_phone_number_id)
   where id = p_business;

  if v_msg is not null then
    update public.conversations
       set last_message_preview = case when v_ts >= coalesce(last_message_at, '-infinity'::timestamptz)
                                       then left(v_body, 140) else last_message_preview end,
           last_message_at = greatest(coalesce(last_message_at, '-infinity'::timestamptz), v_ts),
           manager_last_read_at = now()
     where id = v_conv.id;

    -- a human wrote: the AI must stop (also from human_requested)
    if v_conv.state <> 'human_handling' then
      update public.conversations
         set state = 'human_handling', state_version = state_version + 1, state_updated_at = now(),
             state_updated_by = null,
             state_note = 'Менеджер ответил из приложения WhatsApp: AI приостановлен'
       where id = v_conv.id;
      v_changed := true;
    end if;

    perform public._replay_status_events(p_business, trim(p_provider_message_id));
  end if;

  select * into v_conv from public.conversations where id = v_conv.id;
  return jsonb_build_object(
    'duplicate', v_msg is null,
    'message_id', v_msg,
    'conversation_id', v_conv.id,
    'state', v_conv.state,
    'state_version', v_conv.state_version,
    'state_changed', v_changed
  );
end;
$$;

revoke execute on function public.ingest_manager_echo(uuid, text, text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.ingest_manager_echo(uuid, text, text, text, text, timestamptz, text) to service_role;
