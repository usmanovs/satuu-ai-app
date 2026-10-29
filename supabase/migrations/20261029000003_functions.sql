-- Server-side operations. Every function is SECURITY DEFINER and executable by
-- service_role only: the Edge Functions authenticate the caller (manager JWT or
-- n8n key), derive the business id, then call these.
-- Errors are raised with a short machine code as the message (e.g. 'window_closed').

create function public.resolve_integration_key(p_hash text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select business_id from public.integration_keys
  where key_hash = p_hash and revoked_at is null;
$$;

-- ---------------------------------------------------------------- status ----

-- Monotonic status update for one outbound message. Never moves backwards
-- (delivered -> sent is ignored); 'failed' cannot overwrite delivered/read.
create function public._bump_status(p_message uuid, p_status text, p_ts timestamptz, p_code text, p_msg text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_cur text;
  v_cur_rank int;
  v_new_rank int;
begin
  if p_status not in ('accepted', 'sent', 'delivered', 'read', 'failed') then
    raise exception 'invalid_status';
  end if;

  select status into v_cur from public.messages
  where id = p_message and direction = 'outbound' for update;
  if not found then return false; end if;

  if p_status = 'failed' then
    if v_cur in ('pending', 'accepted', 'sent') then
      update public.messages
         set status = 'failed', status_updated_at = coalesce(p_ts, now()),
             error_code = p_code, error_message = p_msg
       where id = p_message;
      return true;
    end if;
    return false;
  end if;

  v_cur_rank := case v_cur when 'pending' then 0 when 'accepted' then 1 when 'sent' then 2
                           when 'delivered' then 3 when 'read' then 4 else -1 end;
  v_new_rank := case p_status when 'accepted' then 1 when 'sent' then 2
                              when 'delivered' then 3 when 'read' then 4 end;

  -- a failed message can only be revived by hard evidence of delivery
  if v_cur = 'failed' and p_status not in ('delivered', 'read') then return false; end if;

  if v_new_rank > v_cur_rank then
    update public.messages
       set status = p_status, status_updated_at = coalesce(p_ts, now()),
           error_code = null, error_message = null
     where id = p_message;
    return true;
  end if;
  return false;
end;
$$;

create function public._replay_status_events(p_business uuid, p_provider_id text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_msg uuid;
  e record;
begin
  select id into v_msg from public.messages
  where business_id = p_business and provider_message_id = p_provider_id;
  if v_msg is null then return; end if;
  for e in
    select status, event_ts, error_code, error_message from public.status_events
    where business_id = p_business and provider_message_id = p_provider_id
    order by event_ts nulls first, created_at
  loop
    perform public._bump_status(v_msg, e.status, e.event_ts, e.error_code, e.error_message);
  end loop;
end;
$$;

-- Delivery receipts land here and ONLY here. They never create chat messages.
create function public.apply_message_status(
  p_business uuid, p_provider_id text, p_status text, p_ts timestamptz,
  p_error_code text default null, p_error_message text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_msg uuid;
  v_applied boolean := false;
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'invalid_status';
  end if;
  if coalesce(trim(p_provider_id), '') = '' then raise exception 'invalid_provider_message_id'; end if;

  insert into public.status_events (business_id, provider_message_id, status, event_ts, error_code, error_message)
  values (p_business, p_provider_id, p_status, p_ts, p_error_code, p_error_message)
  on conflict (business_id, provider_message_id, status) do nothing;

  select id into v_msg from public.messages
  where business_id = p_business and provider_message_id = p_provider_id;

  if v_msg is null then
    return jsonb_build_object('matched', false, 'buffered', true);
  end if;
  v_applied := public._bump_status(v_msg, p_status, p_ts, p_error_code, p_error_message);
  return jsonb_build_object('matched', true, 'applied', v_applied);
end;
$$;

-- ---------------------------------------------------------------- inbound ---

create function public._unsupported_placeholder(p_type text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_type
    when 'image'    then '[Изображение — ассистент не обрабатывает изображения]'
    when 'audio'    then '[Голосовое сообщение — ассистент не распознаёт аудио]'
    when 'voice'    then '[Голосовое сообщение — ассистент не распознаёт аудио]'
    when 'video'    then '[Видео — ассистент не обрабатывает видео]'
    when 'document' then '[Документ — ассистент не обрабатывает файлы]'
    when 'sticker'  then '[Стикер]'
    when 'location' then '[Геолокация — ассистент её не обрабатывает]'
    when 'contacts' then '[Контакт — ассистент не обрабатывает контакты]'
    when 'reaction' then '[Реакция на сообщение]'
    else '[Сообщение типа «' || coalesce(nullif(p_type, ''), 'неизвестно') || '» не поддерживается]'
  end;
$$;

-- Conservative phrase list (RU + KY). A false positive only costs the manager a
-- glance: they can press "Вернуть AI". The AI agent can also call the
-- request-human endpoint explicitly.
create function public._asks_for_human(p_text text)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_text ~* any (array[
    '(позови|позовите|вызови|вызовите|соедини|соедините|переключи|переключите).{0,20}(менеджер|оператор|человек|сотрудник|админ)',
    '(поговорить|пообщаться|связаться|говорить).{0,20}(с )?(менеджер|оператор|человеком|живым|сотрудник|админ)',
    '(нужен|нужна|хочу|дайте) (живой )?(менеджер|оператор|админ)',
    '(нужен|хочу|дайте) живо(й|го) (человек|оператор)',
    '(менеджер|оператор|администратор)\w*\s+(чакыр|керек|кошул)',
    'адам менен сүйлөш',
    'жандуу адам'
  ]);
$$;

create function public.ingest_inbound_message(
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
    'supported', v_supported
  );
end;
$$;

-- ------------------------------------------------------------ AI gate ------

create function public.ai_permission(
  p_business uuid, p_wa_id text, p_stage text, p_expected_version integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_reason text;
begin
  if p_stage not in ('before_generate', 'before_send') then raise exception 'invalid_stage'; end if;
  update public.businesses set last_ai_check_at = now() where id = p_business;

  select c.* into v_conv
  from public.conversations c join public.contacts k on k.id = c.contact_id
  where c.business_id = p_business and k.wa_id = trim(p_wa_id);

  -- fail closed: an unknown conversation is never "allowed"
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_conversation', 'stage', p_stage);
  end if;

  v_reason := case
    when v_conv.state <> 'ai_active' then 'state_' || v_conv.state
    when p_expected_version is not null and p_expected_version <> v_conv.state_version then 'state_changed'
    else 'ok'
  end;

  return jsonb_build_object(
    'allowed', v_reason = 'ok', 'reason', v_reason, 'stage', p_stage,
    'state', v_conv.state, 'state_version', v_conv.state_version, 'checked_at', now());
end;
$$;

create function public.request_human(p_business uuid, p_wa_id text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_changed boolean := false;
begin
  select c.* into v_conv
  from public.conversations c join public.contacts k on k.id = c.contact_id
  where c.business_id = p_business and k.wa_id = trim(p_wa_id) for update of c;
  if not found then raise exception 'unknown_conversation'; end if;

  -- only ai_active -> human_requested; never downgrades human_handling
  if v_conv.state = 'ai_active' then
    update public.conversations
       set state = 'human_requested', state_version = state_version + 1, state_updated_at = now(),
           state_updated_by = null, state_note = left(coalesce(nullif(trim(p_reason), ''), 'Клиент попросил человека'), 300)
     where id = v_conv.id
    returning * into v_conv;
    v_changed := true;
  end if;
  return jsonb_build_object('changed', v_changed, 'state', v_conv.state, 'state_version', v_conv.state_version);
end;
$$;

-- --------------------------------------------------- AI outbound record -----

create function public.record_ai_message(
  p_business uuid, p_wa_id text, p_provider_message_id text, p_type text,
  p_text text, p_ts timestamptz, p_status text default 'accepted')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv uuid;
  v_msg uuid;
  v_ts timestamptz := coalesce(p_ts, now());
  v_body text := left(coalesce(p_text, ''), 4096);
begin
  if coalesce(trim(p_provider_message_id), '') = '' then raise exception 'invalid_provider_message_id'; end if;
  if p_status not in ('accepted', 'sent', 'delivered', 'read', 'failed') then raise exception 'invalid_status'; end if;

  select c.id into v_conv
  from public.conversations c join public.contacts k on k.id = c.contact_id
  where c.business_id = p_business and k.wa_id = trim(p_wa_id) for update of c;
  if v_conv is null then raise exception 'unknown_conversation'; end if;

  -- initial status 'accepted' means "WhatsApp API took it", NOT delivered
  insert into public.messages (business_id, conversation_id, provider_message_id, sender_role, direction,
                               message_type, body, message_timestamp, status)
  values (p_business, v_conv, trim(p_provider_message_id), 'ai', 'outbound',
          coalesce(nullif(p_type, ''), 'text'), v_body, v_ts,
          case when p_status = 'failed' then 'accepted' else p_status end)
  on conflict (business_id, provider_message_id) do nothing
  returning id into v_msg;

  if v_msg is not null then
    update public.conversations
       set last_message_preview = case when v_ts >= coalesce(last_message_at, '-infinity'::timestamptz)
                                       then left(v_body, 140) else last_message_preview end,
           last_message_at = greatest(coalesce(last_message_at, '-infinity'::timestamptz), v_ts)
     where id = v_conv;
    if p_status = 'failed' then
      perform public._bump_status(v_msg, 'failed', v_ts, null, null);
    end if;
    perform public._replay_status_events(p_business, trim(p_provider_message_id));
  end if;

  return jsonb_build_object('duplicate', v_msg is null, 'message_id', v_msg, 'conversation_id', v_conv);
end;
$$;

-- ----------------------------------------------- dashboard conversation -----

create function public.set_conversation_state(
  p_business uuid, p_conversation uuid, p_action text, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_changed boolean := false;
begin
  select * into v_conv from public.conversations
  where id = p_conversation and business_id = p_business for update;
  if not found then raise exception 'not_found'; end if;

  if p_action = 'takeover' then
    if v_conv.state <> 'human_handling' then
      update public.conversations
         set state = 'human_handling', state_version = state_version + 1, state_updated_at = now(),
             state_updated_by = p_user, state_note = null, manager_last_read_at = now()
       where id = v_conv.id returning * into v_conv;
      v_changed := true;
    end if;
  elsif p_action = 'resume' then
    if v_conv.state <> 'ai_active' then
      update public.conversations
         set state = 'ai_active', state_version = state_version + 1, state_updated_at = now(),
             state_updated_by = p_user, state_note = null
       where id = v_conv.id returning * into v_conv;
      v_changed := true;
    end if;
  elsif p_action = 'mark_read' then
    -- viewing never touches the AI state
    update public.conversations set manager_last_read_at = now() where id = v_conv.id
    returning * into v_conv;
  else
    raise exception 'invalid_action';
  end if;

  return jsonb_build_object('changed', v_changed, 'conversation_id', v_conv.id, 'state', v_conv.state,
                            'state_version', v_conv.state_version, 'state_updated_at', v_conv.state_updated_at);
end;
$$;

-- ---------------------------------------------------- human reply (manager) -

-- Creates the PENDING message row. Enforces: human_handling state, the 24h
-- customer-service window (template required outside it) and idempotency.
create function public.create_human_message(
  p_business uuid, p_conversation uuid, p_user uuid, p_idempotency_key text,
  p_text text, p_use_template boolean, p_template_name text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_wa_id text;
  v_existing public.messages;
  v_msg public.messages;
  v_in_window boolean;
  v_body text;
begin
  if coalesce(trim(p_idempotency_key), '') = '' or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;

  select * into v_conv from public.conversations
  where id = p_conversation and business_id = p_business for update;
  if not found then raise exception 'not_found'; end if;
  select wa_id into v_wa_id from public.contacts where id = v_conv.contact_id;

  -- same key => same message, never a second send
  select * into v_existing from public.messages
  where business_id = p_business and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('created', false, 'message', to_jsonb(v_existing), 'wa_id', v_wa_id);
  end if;

  if v_conv.state <> 'human_handling' then raise exception 'not_human_handling'; end if;

  v_in_window := v_conv.last_inbound_at is not null and now() - v_conv.last_inbound_at < interval '24 hours';
  if not v_in_window and not p_use_template then raise exception 'window_closed'; end if;
  if p_use_template and coalesce(trim(p_template_name), '') = '' then raise exception 'template_not_configured'; end if;

  if p_use_template then
    v_body := '[Шаблон: ' || trim(p_template_name) || ']';
  else
    v_body := trim(coalesce(p_text, ''));
    if v_body = '' or length(v_body) > 4096 then raise exception 'invalid_text'; end if;
  end if;

  insert into public.messages (business_id, conversation_id, idempotency_key, sender_role, sender_user_id,
                               direction, message_type, body, template_name, message_timestamp, status)
  values (p_business, v_conv.id, p_idempotency_key, 'manager', p_user, 'outbound',
          case when p_use_template then 'template' else 'text' end, v_body,
          case when p_use_template then trim(p_template_name) end, now(), 'pending')
  returning * into v_msg;

  update public.conversations
     set last_message_at = v_msg.message_timestamp, last_message_preview = left(v_body, 140),
         manager_last_read_at = now()
   where id = v_conv.id;

  return jsonb_build_object('created', true, 'message', to_jsonb(v_msg), 'wa_id', v_wa_id);
end;
$$;

-- Outcome of a manager send, reported by the Edge Function (n8n accepted /
-- rejected) or later by n8n (sent + WhatsApp message id, or failed).
create function public.record_manager_outcome(
  p_business uuid, p_idempotency_key text, p_status text, p_provider_message_id text default null,
  p_ts timestamptz default null, p_error_code text default null, p_error_message text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_msg public.messages;
  v_applied boolean;
begin
  select * into v_msg from public.messages
  where business_id = p_business and idempotency_key = p_idempotency_key and sender_role = 'manager'
  for update;
  if not found then raise exception 'unknown_message'; end if;

  if coalesce(trim(p_provider_message_id), '') <> '' and v_msg.provider_message_id is null then
    update public.messages set provider_message_id = trim(p_provider_message_id) where id = v_msg.id;
  end if;

  v_applied := public._bump_status(v_msg.id, p_status, p_ts, p_error_code, left(p_error_message, 500));
  if coalesce(trim(p_provider_message_id), '') <> '' then
    perform public._replay_status_events(p_business, trim(p_provider_message_id));
  end if;

  select * into v_msg from public.messages where id = v_msg.id;
  return jsonb_build_object('applied', v_applied, 'status', v_msg.status, 'message_id', v_msg.id);
end;
$$;

-- ------------------------------------------------------------- privileges ---

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
grant execute on function public.is_business_member(uuid) to authenticated;
