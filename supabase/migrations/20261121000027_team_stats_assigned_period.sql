-- Leads per person: count everyone who holds leads (directors and owner too), and leads assigned within the period.
create or replace function public.team_stats(p_business uuid, p_user uuid, p_since timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text := public.member_role(p_business, p_user);
  v_rows jsonb;
  v_sum jsonb;
begin
  if v_role is null then raise exception 'forbidden'; end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.assigned_period desc, t.name), '[]'::jsonb) into v_rows
  from (
    select m.user_id, coalesce(nullif(m.display_name, ''), m.email) as name,
      (select count(*) from public.conversations c
        where c.business_id = p_business and c.assigned_to = m.user_id) as assigned_total,
      (select count(*) from public.conversations c
        where c.business_id = p_business and c.assigned_to = m.user_id and c.assigned_at >= p_since) as assigned_period,
      (select count(*) from public.conversations c
        where c.business_id = p_business and c.assigned_to = m.user_id and c.outcome is null
          and c.state in ('human_requested', 'human_handling')) as open_now,
      (select count(*) from public.messages x
        where x.business_id = p_business and x.sender_user_id = m.user_id and x.sender_role = 'manager'
          and x.created_at >= p_since and x.status <> 'failed') as replies,
      (select count(*) from public.conversations c
        where c.business_id = p_business and c.assigned_to = m.user_id and c.outcome = 'won' and c.outcome_at >= p_since) as won,
      (select count(*) from public.conversations c
        where c.business_id = p_business and c.assigned_to = m.user_id and c.outcome = 'lost' and c.outcome_at >= p_since) as lost,
      (select round(avg(extract(epoch from (x.created_at - prev.ts)) / 60)::numeric, 1)
         from public.messages x
         cross join lateral (
           select max(y.message_timestamp) as ts from public.messages y
            where y.conversation_id = x.conversation_id and y.sender_role = 'customer'
              and y.message_timestamp <= x.created_at) prev
        where x.business_id = p_business and x.sender_user_id = m.user_id and x.sender_role = 'manager'
          and x.created_at >= p_since and prev.ts is not null) as avg_response_min
    from public.business_memberships m
    where m.business_id = p_business and m.active
      and (m.role in ('manager', 'director')
           or exists (select 1 from public.conversations c where c.business_id = p_business and c.assigned_to = m.user_id))
      and (v_role in ('owner', 'director') or m.user_id = p_user)
  ) t;

  select jsonb_build_object(
    'total', count(*),
    'ai_active', count(*) filter (where c.state = 'ai_active'),
    'human_requested', count(*) filter (where c.state = 'human_requested'),
    'human_handling', count(*) filter (where c.state = 'human_handling'),
    'unassigned', count(*) filter (where c.assigned_to is null),
    'hot_open', count(*) filter (where c.lead_label = 'hot' and c.outcome is null),
    'won', count(*) filter (where c.outcome = 'won'),
    'lost', count(*) filter (where c.outcome = 'lost'))
  into v_sum
  from public.conversations c
  where c.business_id = p_business and (v_role in ('owner', 'director') or c.assigned_to = p_user);

  return jsonb_build_object('role', v_role, 'since', p_since, 'managers', v_rows, 'summary', v_sum);
end;
$$;
