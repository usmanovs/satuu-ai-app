-- One WhatsApp number per salesperson, each with its own AI assistant settings.
--   * wa_numbers: a number (Cloud API phone_number_id), its owner (a manager) and its assistant profile.
--   * A conversation now belongs to a customer AND a number, so the same customer writing to two
--     salespeople gets two separate chats. A chat on a number with an owner belongs to that owner from
--     the first message (assigned_to), so only they and the owner/director can see it.
--   * Numbers without an owner behave as before (shared number, auto-assign when a human is requested).
-- Existing data moves onto the business's current number, so nothing changes for today's chats.

-- ---------------------------------------------------------------- numbers
create table public.wa_numbers (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  phone_number_id  text not null,
  display_phone    text,
  label            text not null default 'Номер',
  owner_user_id    uuid references auth.users (id) on delete set null,
  assistant_name   text,
  assistant_profile text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (business_id, phone_number_id),
  unique (id, business_id)
);
create index wa_numbers_owner_idx on public.wa_numbers (business_id, owner_user_id);
alter table public.wa_numbers enable row level security;

create function public.can_see_number(p_business uuid, p_owner uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.business_memberships m
    where m.business_id = p_business and m.user_id = (select auth.uid()) and m.active
      and (m.role in ('owner', 'director') or (m.role = 'manager' and p_owner = m.user_id))
  );
$$;
revoke execute on function public.can_see_number(uuid, uuid) from public, anon;
grant execute on function public.can_see_number(uuid, uuid) to authenticated;

create policy wa_numbers_select on public.wa_numbers
  for select to authenticated using (public.can_see_number(business_id, owner_user_id));
revoke all on public.wa_numbers from anon, authenticated;
grant select on public.wa_numbers to authenticated;

-- today's number becomes the first registered number
insert into public.wa_numbers (business_id, phone_number_id, label)
select b.id, b.wa_phone_number_id, 'Основной номер'
from public.businesses b
where b.wa_phone_number_id is not null
on conflict do nothing;

-- a business with chats but no known number gets a placeholder so every chat has one
insert into public.wa_numbers (business_id, phone_number_id, label)
select distinct c.business_id, 'legacy-' || substr(c.business_id::text, 1, 8), 'Основной номер'
from public.conversations c
where not exists (select 1 from public.wa_numbers n where n.business_id = c.business_id)
on conflict do nothing;

-- ---------------------------------------------------------------- conversations per number
alter table public.conversations add column wa_number_id uuid;

update public.conversations c
   set wa_number_id = (select n.id from public.wa_numbers n where n.business_id = c.business_id order by n.created_at limit 1)
 where c.wa_number_id is null;

alter table public.conversations
  alter column wa_number_id set not null,
  add constraint conversations_wa_number_fkey
    foreign key (wa_number_id, business_id) references public.wa_numbers (id, business_id);

alter table public.conversations drop constraint conversations_business_id_contact_id_key;
create unique index conversations_contact_number_key
  on public.conversations (business_id, contact_id, wa_number_id);
create index conversations_number_idx on public.conversations (wa_number_id);

-- ---------------------------------------------------------------- helpers
-- Finds (or registers) the number a WhatsApp event belongs to. Unknown numbers register themselves
-- so the bot keeps working; an owner/director then assigns them to a salesperson.
create function public._resolve_number(p_business uuid, p_phone text)
returns public.wa_numbers
language plpgsql security definer set search_path = ''
as $$
declare
  v public.wa_numbers;
begin
  if p_phone is not null then
    select * into v from public.wa_numbers where business_id = p_business and phone_number_id = p_phone;
    if not found then
      insert into public.wa_numbers (business_id, phone_number_id, label)
      values (p_business, p_phone, 'Номер …' || right(p_phone, 4))
      on conflict (business_id, phone_number_id) do nothing;
      select * into v from public.wa_numbers where business_id = p_business and phone_number_id = p_phone;
    end if;
  else
    select * into v from public.wa_numbers where business_id = p_business order by created_at limit 1;
    if not found then raise exception 'phone_number_required'; end if;
  end if;
  return v;
end;
$$;

-- the chat of a customer on a given number; without a number: the most recent chat of that customer
create function public._conversation_for(p_business uuid, p_wa_id text, p_phone text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select c.id
  from public.conversations c
  join public.contacts k on k.id = c.contact_id
  join public.wa_numbers n on n.id = c.wa_number_id
  where c.business_id = p_business and k.wa_id = trim(p_wa_id)
    and (p_phone is null or n.phone_number_id = p_phone)
  order by c.last_message_at desc nulls last, c.created_at desc
  limit 1;
$$;

-- ---------------------------------------------------------------- ingest (customer message)
drop function public.ingest_inbound_message(uuid, text, text, text, text, timestamptz, text, boolean, text);
create function public.ingest_inbound_message(
  p_business uuid, p_wa_id text, p_provider_message_id text, p_type text,
  p_text text, p_ts timestamptz, p_display_name text default null,
  p_detect_human boolean default true, p_phone_number_id text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_contact uuid;
  v_conv public.conversations;
  v_num public.wa_numbers;
  v_msg uuid;
  v_supported boolean;
  v_body text;
  v_human_now boolean := false;
  v_owner_name text;
  v_ts timestamptz := coalesce(p_ts, now());
  v_type text := lower(coalesce(nullif(trim(p_type), ''), 'text'));
  v_text text := nullif(trim(coalesce(p_text, '')), '');
  v_phone text := case when trim(coalesce(p_phone_number_id, '')) ~ '^[0-9]{5,25}$' then trim(p_phone_number_id) end;
begin
  if v_type in ('status', 'statuses', 'receipt', 'delivery', 'sent', 'delivered', 'read', 'failed') then
    raise exception 'not_a_message';
  end if;
  if coalesce(trim(p_wa_id), '') = '' then raise exception 'invalid_sender_id'; end if;
  if coalesce(trim(p_provider_message_id), '') = '' then raise exception 'invalid_provider_message_id'; end if;

  v_num := public._resolve_number(p_business, v_phone);

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

  -- a chat on a salesperson's number belongs to that salesperson from the first message
  insert into public.conversations (business_id, contact_id, wa_number_id, assigned_to, assigned_at, assigned_by)
  values (p_business, v_contact, v_num.id, v_num.owner_user_id,
          case when v_num.owner_user_id is not null then now() end, null)
  on conflict (business_id, contact_id, wa_number_id) do nothing;

  select * into v_conv from public.conversations
  where business_id = p_business and contact_id = v_contact and wa_number_id = v_num.id for update;

  insert into public.messages (business_id, conversation_id, provider_message_id, sender_role, direction,
                               message_type, body, is_placeholder, message_timestamp, status)
  values (p_business, v_conv.id, trim(p_provider_message_id), 'customer', 'inbound',
          v_type, v_body, not v_supported, v_ts, 'received')
  on conflict (business_id, provider_message_id) do nothing
  returning id into v_msg;

  update public.businesses
     set last_ingest_at = now(), wa_phone_number_id = coalesce(v_phone, wa_phone_number_id)
   where id = p_business;

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
  select coalesce(nullif(m.display_name, ''), m.email) into v_owner_name
    from public.business_memberships m where m.business_id = p_business and m.user_id = v_num.owner_user_id;

  return jsonb_build_object(
    'duplicate', v_msg is null,
    'message_id', v_msg,
    'conversation_id', v_conv.id,
    'contact_id', v_contact,
    'state', v_conv.state,
    'state_version', v_conv.state_version,
    'ai_allowed', v_conv.state = 'ai_active',
    'supported', v_supported,
    'human_requested_now', v_human_now,
    'wa_number_id', v_num.id,
    'assistant_name', v_num.assistant_name,
    'assistant_profile', v_num.assistant_profile,
    'salesperson_name', v_owner_name
  );
end;
$$;

-- ---------------------------------------------------------------- ingest (message typed in the WhatsApp Business app)
create or replace function public.ingest_manager_echo(
  p_business uuid, p_to_wa_id text, p_provider_message_id text, p_type text,
  p_text text, p_ts timestamptz, p_phone_number_id text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_contact uuid;
  v_conv public.conversations;
  v_num public.wa_numbers;
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

  v_num := public._resolve_number(p_business, v_phone);

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

  insert into public.conversations (business_id, contact_id, wa_number_id, assigned_to, assigned_at, assigned_by)
  values (p_business, v_contact, v_num.id, v_num.owner_user_id,
          case when v_num.owner_user_id is not null then now() end, null)
  on conflict (business_id, contact_id, wa_number_id) do nothing;

  select * into v_conv from public.conversations
  where business_id = p_business and contact_id = v_contact and wa_number_id = v_num.id for update;

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

-- ---------------------------------------------------------------- the n8n calls that look a chat up by customer id
drop function public.ai_permission(uuid, text, text, integer);
create function public.ai_permission(
  p_business uuid, p_wa_id text, p_stage text, p_expected_version integer default null,
  p_phone_number_id text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_id uuid;
  v_reason text;
  v_phone text := case when trim(coalesce(p_phone_number_id, '')) ~ '^[0-9]{5,25}$' then trim(p_phone_number_id) end;
begin
  if p_stage not in ('before_generate', 'before_send') then raise exception 'invalid_stage'; end if;
  update public.businesses set last_ai_check_at = now() where id = p_business;

  v_id := public._conversation_for(p_business, p_wa_id, v_phone);
  -- fail closed: an unknown conversation is never "allowed"
  if v_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_conversation', 'stage', p_stage);
  end if;
  select * into v_conv from public.conversations where id = v_id;

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

drop function public.record_ai_message(uuid, text, text, text, text, timestamptz, text);
create function public.record_ai_message(
  p_business uuid, p_wa_id text, p_provider_message_id text, p_type text,
  p_text text, p_ts timestamptz, p_status text default 'accepted', p_phone_number_id text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv uuid;
  v_msg uuid;
  v_ts timestamptz := coalesce(p_ts, now());
  v_body text := left(coalesce(p_text, ''), 4096);
  v_phone text := case when trim(coalesce(p_phone_number_id, '')) ~ '^[0-9]{5,25}$' then trim(p_phone_number_id) end;
begin
  if coalesce(trim(p_provider_message_id), '') = '' then raise exception 'invalid_provider_message_id'; end if;
  if p_status not in ('accepted', 'sent', 'delivered', 'read', 'failed') then raise exception 'invalid_status'; end if;

  v_conv := public._conversation_for(p_business, p_wa_id, v_phone);
  if v_conv is null then raise exception 'unknown_conversation'; end if;
  perform 1 from public.conversations where id = v_conv for update;

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

drop function public.get_lead_context(uuid, text, integer);
create function public.get_lead_context(p_business uuid, p_wa_id text, p_limit int default 12, p_phone_number_id text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv uuid;
  v_rows jsonb;
  v_phone text := case when trim(coalesce(p_phone_number_id, '')) ~ '^[0-9]{5,25}$' then trim(p_phone_number_id) end;
begin
  v_conv := public._conversation_for(p_business, p_wa_id, v_phone);
  if v_conv is null then raise exception 'not_found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('role', t.sender_role, 'text', t.body) order by t.message_timestamp), '[]'::jsonb)
    into v_rows
  from (
    select sender_role, left(body, 600) as body, message_timestamp
    from public.messages
    where conversation_id = v_conv and not is_placeholder and status <> 'failed'
    order by message_timestamp desc
    limit greatest(1, least(coalesce(p_limit, 12), 30))
  ) t;

  return jsonb_build_object('conversation_id', v_conv, 'messages', v_rows);
end;
$$;

drop function public.record_lead_score(uuid, text, integer, text);
create function public.record_lead_score(p_business uuid, p_wa_id text, p_score int, p_reason text, p_phone_number_id text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv uuid;
  v_score int := greatest(0, least(coalesce(p_score, 0), 100));
  v_label text;
  v_phone text := case when trim(coalesce(p_phone_number_id, '')) ~ '^[0-9]{5,25}$' then trim(p_phone_number_id) end;
begin
  v_label := case when v_score >= 70 then 'hot' when v_score >= 40 then 'warm' else 'cold' end;
  v_conv := public._conversation_for(p_business, p_wa_id, v_phone);
  if v_conv is null then raise exception 'not_found'; end if;
  perform 1 from public.conversations where id = v_conv for update;

  update public.conversations
     set lead_score = v_score, lead_label = v_label,
         lead_reason = nullif(left(trim(coalesce(p_reason, '')), 200), ''),
         lead_scored_at = now()
   where id = v_conv;

  return jsonb_build_object('conversation_id', v_conv, 'lead_score', v_score, 'lead_label', v_label);
end;
$$;

-- ---------------------------------------------------------------- dashboard replies go out from the chat's own number
create or replace function public.claim_human_send(p_business uuid, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_msg public.messages;
  v_conv public.conversations;
  v_wa text;
  v_phone text;
begin
  select * into v_msg from public.messages
  where business_id = p_business and idempotency_key = p_idempotency_key and sender_role = 'manager'
  for update;
  if not found then raise exception 'unknown_message'; end if;

  if v_msg.send_claimed_at is not null then
    return jsonb_build_object('claimed', false, 'reason', 'already_claimed', 'status', v_msg.status);
  end if;
  if v_msg.status <> 'pending' then
    return jsonb_build_object('claimed', false, 'reason', 'not_pending', 'status', v_msg.status);
  end if;

  select * into v_conv from public.conversations where id = v_msg.conversation_id;
  if v_conv.state <> 'human_handling' then
    return jsonb_build_object('claimed', false, 'reason', 'not_human_handling', 'status', v_msg.status);
  end if;

  select n.phone_number_id into v_phone from public.wa_numbers n where n.id = v_conv.wa_number_id;
  -- a placeholder number was never a real Cloud API id: fall back to the last number WhatsApp told us about
  if v_phone is null or v_phone like 'legacy-%' then
    select wa_phone_number_id into v_phone from public.businesses where id = p_business;
  end if;
  if v_phone is null then
    return jsonb_build_object('claimed', false, 'reason', 'phone_number_unknown', 'status', v_msg.status);
  end if;

  select wa_id into v_wa from public.contacts where id = v_conv.contact_id;
  update public.messages set send_claimed_at = now() where id = v_msg.id;

  return jsonb_build_object(
    'claimed', true,
    'message_id', v_msg.id,
    'to', v_wa,
    'type', v_msg.message_type,
    'text', case when v_msg.message_type = 'template' then null else v_msg.body end,
    'template_name', v_msg.template_name,
    'phone_number_id', v_phone
  );
end;
$$;

-- ---------------------------------------------------------------- managing numbers (owner / director; a manager edits only their own assistant)
create function public.number_add(p_business uuid, p_actor uuid, p_phone_number_id text, p_display_phone text,
                                  p_label text, p_owner uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.member_role(p_business, p_actor);
  v_num public.wa_numbers;
begin
  if v_role is null or v_role not in ('owner', 'director') then raise exception 'forbidden'; end if;
  if coalesce(trim(p_phone_number_id), '') !~ '^[0-9]{5,25}$' then raise exception 'invalid_phone_number_id'; end if;
  if p_owner is not null and public.member_role(p_business, p_owner) is distinct from 'manager' then
    raise exception 'not_a_manager';
  end if;
  if exists (select 1 from public.wa_numbers where business_id = p_business and phone_number_id = trim(p_phone_number_id)) then
    raise exception 'number_exists';
  end if;
  insert into public.wa_numbers (business_id, phone_number_id, display_phone, label, owner_user_id)
  values (p_business, trim(p_phone_number_id), nullif(trim(coalesce(p_display_phone, '')), ''),
          coalesce(nullif(trim(coalesce(p_label, '')), ''), 'Номер'), p_owner)
  returning * into v_num;
  return jsonb_build_object('id', v_num.id);
end;
$$;

-- p_patch keys: label, display_phone, owner_user_id, active, assistant_name, assistant_profile
create function public.number_save(p_business uuid, p_actor uuid, p_number uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.member_role(p_business, p_actor);
  v_num public.wa_numbers;
  v_new_owner uuid;
  v_admin boolean;
begin
  if v_role is null then raise exception 'forbidden'; end if;
  v_admin := v_role in ('owner', 'director');

  select * into v_num from public.wa_numbers where id = p_number and business_id = p_business for update;
  if not found then raise exception 'not_found'; end if;
  -- a manager may edit only their own number, and only the assistant fields
  if not v_admin and v_num.owner_user_id is distinct from p_actor then raise exception 'forbidden'; end if;
  if not v_admin and (p_patch ? 'label' or p_patch ? 'display_phone' or p_patch ? 'owner_user_id' or p_patch ? 'active') then
    raise exception 'forbidden';
  end if;

  if p_patch ? 'owner_user_id' then
    v_new_owner := nullif(p_patch ->> 'owner_user_id', '')::uuid;
    if v_new_owner is not null and public.member_role(p_business, v_new_owner) is distinct from 'manager' then
      raise exception 'not_a_manager';
    end if;
    if v_new_owner is distinct from v_num.owner_user_id then
      -- chats still with the previous owner follow the number
      update public.conversations
         set assigned_to = v_new_owner,
             assigned_at = case when v_new_owner is null then null else now() end,
             assigned_by = case when v_new_owner is null then null else p_actor end
       where wa_number_id = v_num.id and assigned_to is not distinct from v_num.owner_user_id;
    end if;
  end if;

  update public.wa_numbers set
    label = case when p_patch ? 'label' then coalesce(nullif(trim(p_patch ->> 'label'), ''), label) else label end,
    display_phone = case when p_patch ? 'display_phone' then nullif(trim(p_patch ->> 'display_phone'), '') else display_phone end,
    owner_user_id = case when p_patch ? 'owner_user_id' then v_new_owner else owner_user_id end,
    active = case when p_patch ? 'active' then (p_patch ->> 'active')::boolean else active end,
    assistant_name = case when p_patch ? 'assistant_name' then left(nullif(trim(p_patch ->> 'assistant_name'), ''), 60) else assistant_name end,
    assistant_profile = case when p_patch ? 'assistant_profile' then left(nullif(trim(p_patch ->> 'assistant_profile'), ''), 3000) else assistant_profile end
  where id = v_num.id;

  return jsonb_build_object('id', v_num.id);
end;
$$;

-- a member who is deactivated or stops being a manager no longer owns a number
create function public.release_numbers_of_member()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.active = false or new.role <> 'manager' then
    update public.wa_numbers set owner_user_id = null
     where business_id = new.business_id and owner_user_id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger release_numbers_trg
  after update of active, role on public.business_memberships
  for each row execute function public.release_numbers_of_member();

-- ---------------------------------------------------------------- grants (server-side functions: service role only)
revoke execute on function public._resolve_number(uuid, text) from public, anon, authenticated;
revoke execute on function public._conversation_for(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.release_numbers_of_member() from public, anon, authenticated;
revoke execute on function public.number_add(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.number_save(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.ingest_inbound_message(uuid, text, text, text, text, timestamptz, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.ai_permission(uuid, text, text, integer, text) from public, anon, authenticated;
revoke execute on function public.record_ai_message(uuid, text, text, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke execute on function public.get_lead_context(uuid, text, integer, text) from public, anon, authenticated;
revoke execute on function public.record_lead_score(uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public._resolve_number(uuid, text) to service_role;
grant execute on function public._conversation_for(uuid, text, text) to service_role;
grant execute on function public.number_add(uuid, uuid, text, text, text, uuid) to service_role;
grant execute on function public.number_save(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.ingest_inbound_message(uuid, text, text, text, text, timestamptz, text, boolean, text) to service_role;
grant execute on function public.ai_permission(uuid, text, text, integer, text) to service_role;
grant execute on function public.record_ai_message(uuid, text, text, text, text, timestamptz, text, text) to service_role;
grant execute on function public.get_lead_context(uuid, text, integer, text) to service_role;
grant execute on function public.record_lead_score(uuid, text, integer, text, text) to service_role;
