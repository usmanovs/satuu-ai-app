-- After-payment sequence: which option was bought, one row per sent step, and the "what is due now" query for n8n.
-- Steps: welcome (right after "Купил"), prep (next day), reminder (26-27 Nov, live/mentorship), checkin (4 Dec), demo (12 Dec, live/mentorship).

alter table public.conversations
  add column if not exists purchased_option text check (purchased_option in ('recordings', 'live', 'mentorship'));

create table if not exists public.onboarding_sends (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  step text not null check (step in ('welcome', 'prep', 'reminder', 'checkin', 'demo')),
  template text,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (conversation_id, step)
);
alter table public.onboarding_sends enable row level security; -- no policies: only the service role (n8n functions) touches it

-- "Купил" now carries the option. Marking won again only changes the option and keeps the original time.
drop function if exists public.set_conversation_outcome(uuid, uuid, text, uuid);
create or replace function public.set_conversation_outcome(p_business uuid, p_conversation uuid, p_outcome text, p_user uuid, p_option text default null)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  v_conv public.conversations;
begin
  if p_outcome not in ('won', 'lost', 'open') then raise exception 'invalid_outcome'; end if;
  if p_option is not null and p_option not in ('recordings', 'live', 'mentorship') then raise exception 'invalid_option'; end if;
  perform public.assert_conversation_access(p_business, p_user, p_conversation);

  select * into v_conv from public.conversations
  where id = p_conversation and business_id = p_business for update;
  if not found then raise exception 'not_found'; end if;

  if p_outcome = 'won' and v_conv.outcome = 'won' then
    update public.conversations set purchased_option = coalesce(p_option, purchased_option) where id = v_conv.id returning * into v_conv;
  else
    update public.conversations
       set outcome = case when p_outcome = 'open' then null else p_outcome end,
           outcome_at = case when p_outcome = 'open' then null else now() end,
           outcome_by = case when p_outcome = 'open' then null else p_user end,
           purchased_option = case when p_outcome = 'won' then p_option else null end
     where id = v_conv.id
    returning * into v_conv;
  end if;

  return jsonb_build_object('conversation_id', v_conv.id, 'outcome', v_conv.outcome, 'outcome_at', v_conv.outcome_at, 'purchased_option', v_conv.purchased_option);
end;
$fn$;
revoke execute on function public.set_conversation_outcome(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_conversation_outcome(uuid, uuid, text, uuid, text) to service_role;

-- What is due now (08:00-20:59 Bishkek only). At most one step per chat per run, and 12 h between steps.
create or replace function public.get_onboarding_due(p_business uuid, p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  v_now timestamptz := now();
  v_since constant timestamptz := timestamptz '2026-11-17 22:00:00+00';   -- buyers marked before this date get nothing
  v_start constant timestamptz := timestamptz '2026-11-27 00:00:00+06';
  v_rem_from constant timestamptz := timestamptz '2026-11-26 10:00:00+06';
  v_rem_to constant timestamptz := timestamptz '2026-11-27 12:00:00+06';
  v_chk_from constant timestamptz := timestamptz '2026-12-04 10:00:00+06';
  v_chk_to constant timestamptz := timestamptz '2026-12-08 00:00:00+06';
  v_demo_from constant timestamptz := timestamptz '2026-12-12 10:00:00+06';
  v_demo_to constant timestamptz := timestamptz '2026-12-16 00:00:00+06';
  v_rows jsonb;
begin
  if extract(hour from (v_now at time zone 'Asia/Bishkek')) not between 8 and 20 then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) - 'rank'), '[]'::jsonb) into v_rows
  from (
   select * from (
    select distinct on (x.conversation_id) x.*
    from (
      select cv.id as conversation_id, ct.wa_id, ct.display_name, wn.phone_number_id, cv.purchased_option, s.step, s.rank,
             (select left(m.body, 200) from public.messages m
               where m.conversation_id = cv.id and m.direction = 'inbound' and not m.is_placeholder
               order by m.message_timestamp desc limit 1) as last_text
        from public.conversations cv
        join public.contacts ct on ct.id = cv.contact_id
        left join public.wa_numbers wn on wn.id = cv.wa_number_id
        cross join (values ('welcome', 1), ('prep', 2), ('reminder', 3), ('checkin', 4), ('demo', 5)) as s(step, rank)
       where cv.business_id = p_business
         and cv.outcome = 'won' and cv.outcome_at >= v_since
         and ct.wa_id not like '99900%'
         and not exists (select 1 from public.onboarding_sends o where o.conversation_id = cv.id and o.step = s.step)
         and not exists (select 1 from public.messages m
                          where m.conversation_id = cv.id and m.direction = 'inbound'
                            and m.body ~* '(stop|стоп|не пишите|не беспокойте|не звоните|токтот)')
         and (
           s.step = 'welcome'
           or (
                not exists (select 1 from public.onboarding_sends o where o.conversation_id = cv.id and o.claimed_at > v_now - interval '12 hours')
                and exists (select 1 from public.onboarding_sends o where o.conversation_id = cv.id and o.step = 'welcome' and o.sent_at is not null)
                and (
                  (s.step = 'prep' and exists (select 1 from public.onboarding_sends o where o.conversation_id = cv.id and o.step = 'welcome' and o.sent_at <= v_now - interval '20 hours')
                       and v_now < v_start + interval '1 day')
                  or (s.step = 'reminder' and cv.purchased_option in ('live', 'mentorship') and v_now between v_rem_from and v_rem_to)
                  or (s.step = 'checkin' and v_now between v_chk_from and v_chk_to)
                  or (s.step = 'demo' and cv.purchased_option in ('live', 'mentorship') and v_now between v_demo_from and v_demo_to)
                )
              )
         )
    ) x
    order by x.conversation_id, x.rank
   ) d
   order by d.rank, d.conversation_id
   limit greatest(1, least(coalesce(p_limit, 10), 20))
  ) r;
  return v_rows;
end;
$fn$;

create or replace function public.onboarding_claim(p_business uuid, p_conversation uuid, p_step text, p_template text)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid;
begin
  insert into public.onboarding_sends (business_id, conversation_id, step, template)
  values (p_business, p_conversation, p_step, p_template)
  on conflict (conversation_id, step) do nothing
  returning id into v_id;
  return jsonb_build_object('claimed', v_id is not null);
end;
$fn$;

create or replace function public.onboarding_confirm(p_business uuid, p_conversation uuid, p_step text)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
begin
  update public.onboarding_sends set sent_at = now()
   where conversation_id = p_conversation and step = p_step and business_id = p_business;
  return jsonb_build_object('confirmed', true);
end;
$fn$;

create or replace function public.onboarding_release(p_business uuid, p_conversation uuid, p_step text)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
begin
  delete from public.onboarding_sends
   where conversation_id = p_conversation and step = p_step and business_id = p_business and sent_at is null;
  return jsonb_build_object('released', true);
end;
$fn$;

revoke execute on function public.get_onboarding_due(uuid, integer), public.onboarding_claim(uuid, uuid, text, text),
  public.onboarding_confirm(uuid, uuid, text), public.onboarding_release(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.get_onboarding_due(uuid, integer), public.onboarding_claim(uuid, uuid, text, text),
  public.onboarding_confirm(uuid, uuid, text), public.onboarding_release(uuid, uuid, text) to service_role;

-- Dashboard: the manager picks (or corrects) the bought option after marking "Купил".
create or replace function public.set_purchased_option(p_conversation uuid, p_option text)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  v public.conversations;
begin
  select * into v from public.conversations where id = p_conversation for update;
  if not found or not public.can_see(v.business_id, v.assigned_to) then raise exception 'not_found'; end if;
  if v.outcome is distinct from 'won' then raise exception 'not_won'; end if;
  if p_option is null or p_option not in ('recordings', 'live', 'mentorship') then raise exception 'invalid_option'; end if;
  update public.conversations set purchased_option = p_option where id = v.id;
  return jsonb_build_object('conversation_id', v.id, 'purchased_option', p_option);
end;
$fn$;
revoke execute on function public.set_purchased_option(uuid, text) from public, anon;
grant execute on function public.set_purchased_option(uuid, text) to authenticated;

-- The due-query takes the time as a parameter so it can be tested at any date; get_onboarding_due() is the production entry (now()).
create or replace function public.get_onboarding_due_at(p_business uuid, p_limit integer, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  v_now timestamptz := p_now;
  v_since constant timestamptz := timestamptz '2026-11-17 22:00:00+00';   -- buyers marked before this date get nothing
  v_start constant timestamptz := timestamptz '2026-11-27 00:00:00+06';
  v_rem_from constant timestamptz := timestamptz '2026-11-26 10:00:00+06';
  v_rem_to constant timestamptz := timestamptz '2026-11-27 12:00:00+06';
  v_chk_from constant timestamptz := timestamptz '2026-12-04 10:00:00+06';
  v_chk_to constant timestamptz := timestamptz '2026-12-08 00:00:00+06';
  v_demo_from constant timestamptz := timestamptz '2026-12-12 10:00:00+06';
  v_demo_to constant timestamptz := timestamptz '2026-12-16 00:00:00+06';
  v_rows jsonb;
begin
  if extract(hour from (v_now at time zone 'Asia/Bishkek')) not between 8 and 20 then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) - 'rank'), '[]'::jsonb) into v_rows
  from (
   select * from (
    select distinct on (x.conversation_id) x.*
    from (
      select cv.id as conversation_id, ct.wa_id, ct.display_name, wn.phone_number_id, cv.purchased_option, s.step, s.rank,
             (select left(m.body, 200) from public.messages m
               where m.conversation_id = cv.id and m.direction = 'inbound' and not m.is_placeholder
               order by m.message_timestamp desc limit 1) as last_text
        from public.conversations cv
        join public.contacts ct on ct.id = cv.contact_id
        left join public.wa_numbers wn on wn.id = cv.wa_number_id
        cross join (values ('welcome', 1), ('prep', 2), ('reminder', 3), ('checkin', 4), ('demo', 5)) as s(step, rank)
       where cv.business_id = p_business
         and cv.outcome = 'won' and cv.outcome_at >= v_since
         and ct.wa_id not like '99900%'
         and not exists (select 1 from public.onboarding_sends o where o.conversation_id = cv.id and o.step = s.step)
         and not exists (select 1 from public.messages m
                          where m.conversation_id = cv.id and m.direction = 'inbound'
                            and m.body ~* '(stop|стоп|не пишите|не беспокойте|не звоните|токтот)')
         and (
           s.step = 'welcome'
           or (
                not exists (select 1 from public.onboarding_sends o where o.conversation_id = cv.id and o.claimed_at > v_now - interval '12 hours')
                and exists (select 1 from public.onboarding_sends o where o.conversation_id = cv.id and o.step = 'welcome' and o.sent_at is not null)
                and (
                  (s.step = 'prep' and exists (select 1 from public.onboarding_sends o where o.conversation_id = cv.id and o.step = 'welcome' and o.sent_at <= v_now - interval '20 hours')
                       and v_now < v_start + interval '1 day')
                  or (s.step = 'reminder' and cv.purchased_option in ('live', 'mentorship') and v_now between v_rem_from and v_rem_to)
                  or (s.step = 'checkin' and v_now between v_chk_from and v_chk_to)
                  or (s.step = 'demo' and cv.purchased_option in ('live', 'mentorship') and v_now between v_demo_from and v_demo_to)
                )
              )
         )
    ) x
    order by x.conversation_id, x.rank
   ) d
   order by d.rank, d.conversation_id
   limit greatest(1, least(coalesce(p_limit, 10), 20))
  ) r;
  return v_rows;
end;
$fn$;

create or replace function public.get_onboarding_due(p_business uuid, p_limit integer default 10)
returns jsonb language sql security definer set search_path to '' as $fn$
  select public.get_onboarding_due_at(p_business, p_limit, now());
$fn$;

revoke execute on function public.get_onboarding_due_at(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.get_onboarding_due_at(uuid, integer, timestamptz) to service_role;
