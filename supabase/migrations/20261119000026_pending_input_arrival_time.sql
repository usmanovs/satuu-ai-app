-- A customer phone with a wrong clock sends WhatsApp timestamps that can be older than the previous message
-- (2026-11-19: 996709717721, 04:55:12 after 04:55:31), so the "is this the newest message" check dropped the
-- greeting and the bot stayed silent. Order and compare by arrival time (created_at, our server clock) instead.
create or replace function public.pending_customer_input(p_business uuid, p_wa_id text, p_provider_message_id text, p_phone_number_id text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
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
   order by created_at desc limit 1;

  select coalesce(max(created_at), '-infinity'::timestamptz) into v_since from public.messages
   where conversation_id = v_conv and direction = 'outbound' and status <> 'failed';

  select string_agg(body, E'\n' order by created_at), count(*) into v_text, v_n
    from public.messages
   where conversation_id = v_conv and direction = 'inbound' and not is_placeholder
     and created_at > v_since and body is not null and body <> '';

  return jsonb_build_object('latest', coalesce(v_last = p_provider_message_id, true), 'text', v_text, 'count', coalesce(v_n, 0));
end;
$function$;
