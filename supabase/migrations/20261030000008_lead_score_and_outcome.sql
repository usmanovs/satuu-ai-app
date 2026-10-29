-- Buying signal per conversation (AI estimate, NOT a probability) and the manager-recorded outcome.
-- The score is written only by n8n through record_lead_score(); the outcome only by a signed-in manager
-- through set_conversation_outcome(). Dashboard reads stay SELECT-only under the existing RLS policies.

alter table public.conversations
  add column lead_score smallint check (lead_score between 0 and 100),
  add column lead_label text check (lead_label in ('cold', 'warm', 'hot')),
  add column lead_reason text,
  add column lead_scored_at timestamptz,
  add column outcome text check (outcome in ('won', 'lost')),
  add column outcome_at timestamptz,
  add column outcome_by uuid;

-- Recent messages for scoring, oldest first. Customer, AI and manager roles only; no ids or phone numbers.
create function public.get_lead_context(p_business uuid, p_wa_id text, p_limit int default 12)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv uuid;
  v_rows jsonb;
begin
  select cv.id into v_conv
  from public.conversations cv
  join public.contacts c on c.id = cv.contact_id
  where cv.business_id = p_business and c.wa_id = trim(p_wa_id);
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

create function public.record_lead_score(p_business uuid, p_wa_id text, p_score int, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv uuid;
  v_score int := greatest(0, least(coalesce(p_score, 0), 100));
  v_label text;
begin
  v_label := case when v_score >= 70 then 'hot' when v_score >= 40 then 'warm' else 'cold' end;

  select cv.id into v_conv
  from public.conversations cv
  join public.contacts c on c.id = cv.contact_id
  where cv.business_id = p_business and c.wa_id = trim(p_wa_id)
  for update of cv;
  if v_conv is null then raise exception 'not_found'; end if;

  update public.conversations
     set lead_score = v_score, lead_label = v_label,
         lead_reason = nullif(left(trim(coalesce(p_reason, '')), 200), ''),
         lead_scored_at = now()
   where id = v_conv;

  return jsonb_build_object('conversation_id', v_conv, 'lead_score', v_score, 'lead_label', v_label);
end;
$$;

-- p_outcome: 'won' | 'lost' | 'open' (open clears a mistaken mark)
create function public.set_conversation_outcome(p_business uuid, p_conversation uuid, p_outcome text, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv public.conversations;
begin
  if p_outcome not in ('won', 'lost', 'open') then raise exception 'invalid_outcome'; end if;

  select * into v_conv from public.conversations
  where id = p_conversation and business_id = p_business for update;
  if not found then raise exception 'not_found'; end if;

  update public.conversations
     set outcome = case when p_outcome = 'open' then null else p_outcome end,
         outcome_at = case when p_outcome = 'open' then null else now() end,
         outcome_by = case when p_outcome = 'open' then null else p_user end
   where id = v_conv.id
  returning * into v_conv;

  return jsonb_build_object('conversation_id', v_conv.id, 'outcome', v_conv.outcome, 'outcome_at', v_conv.outcome_at);
end;
$$;

revoke execute on function public.get_lead_context(uuid, text, int) from public, anon, authenticated;
revoke execute on function public.record_lead_score(uuid, text, int, text) from public, anon, authenticated;
revoke execute on function public.set_conversation_outcome(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.get_lead_context(uuid, text, int) to service_role;
grant execute on function public.record_lead_score(uuid, text, int, text) to service_role;
grant execute on function public.set_conversation_outcome(uuid, uuid, text, uuid) to service_role;
