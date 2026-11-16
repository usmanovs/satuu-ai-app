-- Follow-up nudges for quiet leads and a one-time "hot lead" alert.
-- Both are driven by n8n (service role only). Each happens at most once per conversation.

alter table public.conversations
  add column followup_sent_at timestamptz,
  add column hot_alerted_at timestamptz;

-- record_lead_score now also tells n8n whether to alert a human (score >= 80, first time, still open).
create or replace function public.record_lead_score(p_business uuid, p_wa_id text, p_score int, p_reason text, p_phone_number_id text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv uuid;
  v_score int := greatest(0, least(coalesce(p_score, 0), 100));
  v_label text;
  v_phone text := case when trim(coalesce(p_phone_number_id, '')) ~ '^[0-9]{5,25}$' then trim(p_phone_number_id) end;
  v_alert boolean := false;
  v_row public.conversations;
  v_name text;
  v_number text;
begin
  v_label := case when v_score >= 70 then 'hot' when v_score >= 40 then 'warm' else 'cold' end;
  v_conv := public._conversation_for(p_business, p_wa_id, v_phone);
  if v_conv is null then raise exception 'not_found'; end if;
  perform 1 from public.conversations where id = v_conv for update;

  update public.conversations
     set lead_score = v_score, lead_label = v_label,
         lead_reason = nullif(left(trim(coalesce(p_reason, '')), 200), ''),
         lead_scored_at = now()
   where id = v_conv
  returning * into v_row;

  if v_score >= 80 and v_row.hot_alerted_at is null and v_row.outcome is null then
    update public.conversations set hot_alerted_at = now() where id = v_conv;
    v_alert := true;
  end if;

  select ct.display_name into v_name
    from public.contacts ct where ct.id = v_row.contact_id;
  select coalesce(wn.label, wn.display_phone) into v_number
    from public.wa_numbers wn where wn.id = v_row.wa_number_id;

  return jsonb_build_object(
    'conversation_id', v_conv, 'lead_score', v_score, 'lead_label', v_label,
    'alert', v_alert, 'reason', v_row.lead_reason, 'display_name', v_name, 'number_label', v_number);
end;
$$;

-- Conversations where the AI answered last, the customer then went quiet 16-23 hours ago (still inside
-- WhatsApp's free 24 h window), showed real interest (score >= 30), and no one has nudged yet.
-- Only during Bishkek daytime (09:00-20:59). Customers who asked to stop are excluded.
create function public.get_followup_candidates(p_business uuid, p_limit int default 20)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if extract(hour from (now() at time zone 'Asia/Bishkek')) not between 9 and 20 then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select cv.id as conversation_id, ct.wa_id, ct.display_name, wn.phone_number_id,
           cv.state_version, cv.lead_score,
           (select coalesce(jsonb_agg(jsonb_build_object('role', t.sender_role, 'text', t.body) order by t.message_timestamp), '[]'::jsonb)
              from (select sender_role, left(body, 400) as body, message_timestamp
                      from public.messages
                     where conversation_id = cv.id and not is_placeholder and status <> 'failed'
                     order by message_timestamp desc limit 8) t) as messages
      from public.conversations cv
      join public.contacts ct on ct.id = cv.contact_id
      left join public.wa_numbers wn on wn.id = cv.wa_number_id
     where cv.business_id = p_business
       and cv.state = 'ai_active'
       and cv.outcome is null
       and cv.followup_sent_at is null
       and coalesce(cv.lead_score, 0) >= 30
       and cv.last_inbound_at between now() - interval '23 hours' and now() - interval '16 hours'
       and (select m.sender_role from public.messages m
             where m.conversation_id = cv.id and not m.is_placeholder
             order by m.message_timestamp desc limit 1) = 'ai'
       and not exists (select 1 from public.messages m
                        where m.conversation_id = cv.id and m.direction = 'inbound'
                          and m.body ~* '(stop|стоп|не пишите|не беспокойте|не звоните|токтот)')
     order by cv.last_inbound_at
     limit greatest(1, least(coalesce(p_limit, 20), 50))
  ) r;

  return v_rows;
end;
$$;

-- Atomic claim: only the first caller gets claimed = true, so a nudge is never sent twice.
create function public.followup_claim(p_business uuid, p_conversation uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.conversations
     set followup_sent_at = now()
   where id = p_conversation and business_id = p_business
     and followup_sent_at is null and state = 'ai_active'
  returning id into v_id;
  return jsonb_build_object('claimed', v_id is not null);
end;
$$;

revoke execute on function public.get_followup_candidates(uuid, int) from public, anon, authenticated;
revoke execute on function public.followup_claim(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.record_lead_score(uuid, text, int, text, text) from public, anon, authenticated;
grant execute on function public.get_followup_candidates(uuid, int) to service_role;
grant execute on function public.followup_claim(uuid, uuid) to service_role;
grant execute on function public.record_lead_score(uuid, text, int, text, text) to service_role;
