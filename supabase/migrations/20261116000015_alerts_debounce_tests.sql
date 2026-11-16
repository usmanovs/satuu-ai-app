-- Bot failure alerts, "answer once" input merging, and helpers for the automatic regression tests.
-- All functions are service-role only (called by n8n through the n8n edge function).

-- ------------------------------------------------------------------ failure alerts
create table public.bot_alerts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('error', 'credits', 'whatsapp_token', 'unanswered', 'tests_failed')),
  title text not null,
  detail text,
  workflow text,
  node text,
  execution_id text,
  occurrences int not null default 1,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index bot_alerts_open_idx on public.bot_alerts (business_id, resolved_at, created_at desc);

alter table public.bot_alerts enable row level security;
create policy bot_alerts_select on public.bot_alerts
  for select to authenticated using (public.is_business_member(business_id));
revoke all on public.bot_alerts from anon, authenticated;
grant select on public.bot_alerts to authenticated;
alter publication supabase_realtime add table public.bot_alerts;

create function public.record_bot_alert(
  p_business uuid, p_kind text, p_title text, p_detail text, p_workflow text, p_node text, p_execution text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.bot_alerts
   where business_id = p_business and kind = p_kind and resolved_at is null
     and coalesce(node, '') = coalesce(left(p_node, 120), '')
     and last_seen_at > now() - interval '6 hours'
   order by created_at desc limit 1;

  if v_id is not null then
    update public.bot_alerts
       set occurrences = occurrences + 1, last_seen_at = now(),
           detail = coalesce(left(p_detail, 600), detail), execution_id = coalesce(left(p_execution, 60), execution_id)
     where id = v_id;
    return jsonb_build_object('id', v_id, 'new', false);
  end if;

  insert into public.bot_alerts (business_id, kind, title, detail, workflow, node, execution_id)
  values (p_business, p_kind, left(p_title, 200), left(p_detail, 600), left(p_workflow, 120), left(p_node, 120), left(p_execution, 60))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'new', true);
end;
$$;

-- A working bot clears the alerts about it: any new AI reply resolves open runtime alerts.
create function public._resolve_bot_alerts() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.sender_role = 'ai' and new.status in ('accepted', 'sent', 'delivered', 'read') then
    update public.bot_alerts set resolved_at = now()
     where business_id = new.business_id and resolved_at is null
       and kind in ('error', 'credits', 'whatsapp_token', 'unanswered');
  end if;
  return new;
end;
$$;
create trigger messages_resolve_bot_alerts after insert on public.messages
  for each row execute function public._resolve_bot_alerts();

-- Customers who wrote 5 minutes to 2 hours ago in an AI chat and got no reply at all.
create function public.watchdog_unanswered(p_business uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.conversations cv
  join public.contacts ct on ct.id = cv.contact_id
  where cv.business_id = p_business and cv.state = 'ai_active'
    and ct.wa_id not like '99900%'
    and exists (
      select 1 from public.messages m
       where m.conversation_id = cv.id and m.direction = 'inbound' and m.message_type = 'text'
         and not m.is_placeholder
         and m.created_at between now() - interval '2 hours' and now() - interval '5 minutes'
         and not exists (
           select 1 from public.messages o
            where o.conversation_id = cv.id and o.direction = 'outbound' and o.created_at > m.created_at));
  if v_count > 0 then
    perform public.record_bot_alert(p_business, 'unanswered', 'Бот не ответил клиентам',
      v_count || ' диалог(ов) без ответа более 5 минут. Проверьте n8n: кредиты AI, токен WhatsApp, ошибки.', 'watchdog', 'unanswered', null);
  end if;
  return jsonb_build_object('unanswered', v_count);
end;
$$;

-- ------------------------------------------------------------------ answer once
-- Is this inbound message the newest one in the chat, and what did the customer write since the last reply?
create function public.pending_customer_input(
  p_business uuid, p_wa_id text, p_provider_message_id text, p_phone_number_id text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv uuid;
  v_phone text := case when trim(coalesce(p_phone_number_id, '')) ~ '^[0-9]{5,25}$' then trim(p_phone_number_id) end;
  v_last text;
  v_since timestamptz;
  v_text text;
  v_n int;
begin
  v_conv := public._conversation_for(p_business, p_wa_id, v_phone);
  if v_conv is null then return jsonb_build_object('latest', true, 'text', null, 'count', 0); end if;

  select provider_message_id into v_last from public.messages
   where conversation_id = v_conv and direction = 'inbound' and not is_placeholder
   order by message_timestamp desc, created_at desc limit 1;

  select coalesce(max(message_timestamp), '-infinity'::timestamptz) into v_since from public.messages
   where conversation_id = v_conv and direction = 'outbound' and status <> 'failed';

  select string_agg(body, E'\n' order by message_timestamp, created_at), count(*) into v_text, v_n
    from public.messages
   where conversation_id = v_conv and direction = 'inbound' and not is_placeholder
     and message_timestamp > v_since and body is not null and body <> '';

  return jsonb_build_object('latest', coalesce(v_last = p_provider_message_id, true), 'text', v_text, 'count', coalesce(v_n, 0));
end;
$$;

-- ------------------------------------------------------------------ regression tests
-- Test chats use phone numbers starting with 99900 and are removed after each run.
create function public.test_replies(p_business uuid, p_wa_id text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_wa_id not like '99900%' then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('role', m.sender_role, 'direction', m.direction, 'text', m.body, 'at', m.created_at)
                     order by m.message_timestamp, m.created_at)
    from public.messages m
    join public.conversations cv on cv.id = m.conversation_id
    join public.contacts ct on ct.id = cv.contact_id
    where cv.business_id = p_business and ct.wa_id = p_wa_id), '[]'::jsonb);
end;
$$;

create function public.delete_test_data(p_business uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_n int;
begin
  delete from public.contacts where business_id = p_business and wa_id like '99900%';
  get diagnostics v_n = row_count;
  return jsonb_build_object('deleted_contacts', v_n);
end;
$$;

revoke execute on function public.record_bot_alert(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.watchdog_unanswered(uuid) from public, anon, authenticated;
revoke execute on function public.pending_customer_input(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.test_replies(uuid, text) from public, anon, authenticated;
revoke execute on function public.delete_test_data(uuid) from public, anon, authenticated;
revoke execute on function public._resolve_bot_alerts() from public, anon, authenticated;
grant execute on function public.record_bot_alert(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.watchdog_unanswered(uuid) to service_role;
grant execute on function public.pending_customer_input(uuid, text, text, text) to service_role;
grant execute on function public.test_replies(uuid, text) to service_role;
grant execute on function public.delete_test_data(uuid) to service_role;
