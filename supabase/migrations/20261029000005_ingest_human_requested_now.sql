-- ingest_inbound_message now also returns human_requested_now: true ONLY when this very message
-- moved the conversation ai_active -> human_requested (phrase detection). n8n uses it to send the
-- customer exactly one notice. Duplicate deliveries and later messages in an already-paused chat
-- return false, so the customer is never notified twice.

create or replace function public.ingest_inbound_message(
  p_business uuid, p_wa_id text, p_provider_message_id text, p_type text,
  p_text text, p_ts timestamptz, p_display_name text default null,
  p_detect_human boolean default true)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_contact uuid;
  v_conv public.conversations;
  v_msg uuid;
  v_supported boolean;
  v_body text;
  v_human_now boolean := false;
  v_ts timestamptz := coalesce(p_ts, now());
  v_type text := lower(coalesce(nullif(trim(p_type), ''), 'text'));
  v_text text := nullif(trim(coalesce(p_text, '')), '');
begin
  if v_type in ('status', 'statuses', 'receipt', 'delivery', 'sent', 'delivered', 'read', 'failed') then
    raise exception 'not_a_message';
  end if;
  if coalesce(trim(p_wa_id), '') = '' then raise exception 'invalid_sender_id'; end if;
  if coalesce(trim(p_provider_message_id), '') = '' then raise exception 'invalid_provider_message_id'; end if;

  v_supported := v_type in ('text', 'button', 'interactive') and v_text is not null;
  v_body := case
    when v_supported then v_text
    when v_text is not null then public._unsupported_placeholder(v_type) || E'\n' || v_text
    else public._unsupported_placeholder(v_type)
  end;
  v_body := left(v_body, 4096);

  insert into public.contacts (business_id, wa_id, display_name)
  values (p_business, trim(p_wa_id), nullif(trim(coalesce(p_display_name, '')), ''))
  on conflict (business_id, wa_id)
  do update set display_name = coalesce(excluded.display_name, public.contacts.display_name)
  returning id into v_contact;

  insert into public.conversations (business_id, contact_id)
  values (p_business, v_contact)
  on conflict (business_id, contact_id) do nothing;

  select * into v_conv from public.conversations
  where business_id = p_business and contact_id = v_contact for update;

  insert into public.messages (business_id, conversation_id, provider_message_id, sender_role, direction,
                               message_type, body, is_placeholder, message_timestamp, status)
  values (p_business, v_conv.id, trim(p_provider_message_id), 'customer', 'inbound',
          v_type, v_body, not v_supported, v_ts, 'received')
  on conflict (business_id, provider_message_id) do nothing
  returning id into v_msg;

  update public.businesses set last_ingest_at = now() where id = p_business;

  if v_msg is not null then
    update public.conversations
       set last_inbound_at = greatest(coalesce(last_inbound_at, '-infinity'::timestamptz), v_ts),
           last_message_preview = case when v_ts >= coalesce(last_message_at, '-infinity'::timestamptz)
                                       then left(v_body, 140) else last_message_preview end,
           last_message_at = greatest(coalesce(last_message_at, '-infinity'::timestamptz), v_ts)
     where id = v_conv.id;

    if p_detect_human and v_supported and v_conv.state = 'ai_active' and public._asks_for_human(v_body) then
      update public.conversations
         set state = 'human_requested', state_version = state_version + 1,
             state_updated_at = now(), state_updated_by = null,
             state_note = 'Клиент попросил человека (автоопределение по тексту)'
       where id = v_conv.id;
      v_human_now := true;
    end if;
  end if;

  select * into v_conv from public.conversations where id = v_conv.id;
  return jsonb_build_object(
    'duplicate', v_msg is null,
    'message_id', v_msg,
    'conversation_id', v_conv.id,
    'contact_id', v_contact,
    'state', v_conv.state,
    'state_version', v_conv.state_version,
    'ai_allowed', v_conv.state = 'ai_active',
    'supported', v_supported,
    'human_requested_now', v_human_now
  );
end;
$$;
