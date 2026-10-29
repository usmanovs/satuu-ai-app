-- 1) n8n-side idempotency for human sends: an atomic, database-enforced "claim".
--    n8n calls claim_human_send() BEFORE it sends. Exactly one caller can ever claim a given
--    idempotency key, so a duplicate webhook delivery, a retry or a double click cannot cause a
--    second WhatsApp send, regardless of what the dashboard did. The claim also returns the
--    canonical recipient/text from the database, so n8n never has to trust the webhook body.
-- 2) request_human no longer takes a customer id. It is bound to the inbound message that
--    triggered the AI run, so an AI agent cannot pick an arbitrary customer.

alter table public.messages add column send_claimed_at timestamptz;

create function public.claim_human_send(p_business uuid, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_msg public.messages;
  v_conv public.conversations;
  v_wa text;
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
  -- the manager may have handed the chat back to the AI after pressing send
  if v_conv.state <> 'human_handling' then
    return jsonb_build_object('claimed', false, 'reason', 'not_human_handling', 'status', v_msg.status);
  end if;

  select wa_id into v_wa from public.contacts where id = v_conv.contact_id;
  update public.messages set send_claimed_at = now() where id = v_msg.id;

  return jsonb_build_object(
    'claimed', true,
    'message_id', v_msg.id,
    'to', v_wa,
    'type', v_msg.message_type,
    'text', case when v_msg.message_type = 'template' then null else v_msg.body end,
    'template_name', v_msg.template_name
  );
end;
$$;

drop function public.request_human(uuid, text, text);

create function public.request_human(p_business uuid, p_trigger_provider_message_id text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_msg public.messages;
  v_conv public.conversations;
  v_changed boolean := false;
begin
  -- the trigger must be a CUSTOMER message of this business that we ingested recently
  select * into v_msg from public.messages
  where business_id = p_business and provider_message_id = trim(p_trigger_provider_message_id)
    and sender_role = 'customer';
  if not found then raise exception 'unknown_trigger'; end if;
  if v_msg.created_at < now() - interval '15 minutes' then raise exception 'stale_trigger'; end if;

  select * into v_conv from public.conversations where id = v_msg.conversation_id for update;

  if v_conv.state = 'ai_active' then
    update public.conversations
       set state = 'human_requested', state_version = state_version + 1, state_updated_at = now(),
           state_updated_by = null,
           state_note = 'Запрос человека (AI): ' || left(coalesce(nullif(trim(p_reason), ''), 'клиент попросил человека'), 200)
     where id = v_conv.id
    returning * into v_conv;
    v_changed := true;
  end if;
  return jsonb_build_object('changed', v_changed, 'conversation_id', v_conv.id, 'state', v_conv.state,
                            'state_version', v_conv.state_version);
end;
$$;

-- new functions get default grants again, so lock them down explicitly
revoke execute on function public.claim_human_send(uuid, text) from public, anon, authenticated;
revoke execute on function public.request_human(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_human_send(uuid, text) to service_role;
grant execute on function public.request_human(uuid, text, text) to service_role;
