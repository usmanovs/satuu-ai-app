-- Second, later follow-up: one approved WhatsApp message template to warm leads who went quiet 3-7 days ago
-- (the free 24 h window is closed by then, so only a template can be sent). At most once per conversation.

alter table public.conversations add column followup2_sent_at timestamptz;

create function public.get_followup2_candidates(p_business uuid, p_limit int default 10)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  -- Bishkek daytime only (10:00-18:59)
  if extract(hour from (now() at time zone 'Asia/Bishkek')) not between 10 and 18 then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select cv.id as conversation_id, ct.wa_id, ct.display_name, wn.phone_number_id, cv.state_version, cv.lead_score,
           (select left(m.body, 200) from public.messages m
             where m.conversation_id = cv.id and m.direction = 'inbound' and not m.is_placeholder
             order by m.message_timestamp desc limit 1) as last_text
      from public.conversations cv
      join public.contacts ct on ct.id = cv.contact_id
      left join public.wa_numbers wn on wn.id = cv.wa_number_id
     where cv.business_id = p_business
       and cv.state = 'ai_active'
       and cv.outcome is null
       and cv.followup2_sent_at is null
       and ct.wa_id not like '99900%'
       and coalesce(cv.lead_score, 0) >= 40
       and cv.last_inbound_at between now() - interval '7 days' and now() - interval '3 days'
       and not exists (select 1 from public.messages m
                        where m.conversation_id = cv.id and m.direction = 'inbound'
                          and m.body ~* '(stop|стоп|не пишите|не беспокойте|не звоните|токтот)')
       and not exists (select 1 from public.messages m
                        where m.conversation_id = cv.id and m.sender_role = 'manager')
     order by cv.last_inbound_at desc
     limit greatest(1, least(coalesce(p_limit, 10), 20))
  ) r;
  return v_rows;
end;
$$;

-- Atomic claim so a message is never sent twice; release if the send failed so it can be retried later.
create function public.followup2_claim(p_business uuid, p_conversation uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.conversations set followup2_sent_at = now()
   where id = p_conversation and business_id = p_business and followup2_sent_at is null and state = 'ai_active'
  returning id into v_id;
  return jsonb_build_object('claimed', v_id is not null);
end;
$$;

create function public.followup2_release(p_business uuid, p_conversation uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  update public.conversations set followup2_sent_at = null
   where id = p_conversation and business_id = p_business;
  return jsonb_build_object('released', true);
end;
$$;

revoke execute on function public.get_followup2_candidates(uuid, int) from public, anon, authenticated;
revoke execute on function public.followup2_claim(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.followup2_release(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_followup2_candidates(uuid, int) to service_role;
grant execute on function public.followup2_claim(uuid, uuid) to service_role;
grant execute on function public.followup2_release(uuid, uuid) to service_role;
