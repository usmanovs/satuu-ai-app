-- Several WhatsApp numbers per business, each optionally owned by one salesperson.
--  * A customer who writes to a salesperson's number is assigned to that salesperson automatically.
--  * Replies (AI, dashboard, person notice) go out from the number the customer wrote to.
-- Works with plain Cloud API numbers today and with coexistence numbers later.

create table public.business_numbers (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  phone_number_id text not null unique,          -- Cloud API phone_number_id (digits)
  display_phone   text,                          -- e.g. +1 240 255 0596, for people to read
  label           text,
  owner_user_id   uuid references auth.users (id) on delete set null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  check (phone_number_id ~ '^[0-9]{5,25}$')
);
create index business_numbers_business_idx on public.business_numbers (business_id);

alter table public.business_numbers enable row level security;
-- owner/director read all numbers; a manager reads only their own
create policy business_numbers_select on public.business_numbers
  for select to authenticated using (
    exists (
      select 1 from public.business_memberships m
      where m.business_id = business_numbers.business_id and m.user_id = (select auth.uid()) and m.active
        and (m.role in ('owner', 'director') or business_numbers.owner_user_id = m.user_id)
    )
  );
revoke all on public.business_numbers from anon, authenticated;
grant select on public.business_numbers to authenticated;

-- which of the business's numbers the customer is talking to
alter table public.conversations add column phone_number_id text;

-- Called by the Edge Function after every inbound customer message and every manager echo.
-- Remembers the number on the conversation and, for an unassigned chat, assigns the number's owner.
create function public.route_conversation(p_business uuid, p_wa_id text, p_phone_number_id text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text := case when trim(coalesce(p_phone_number_id, '')) ~ '^[0-9]{5,25}$' then trim(p_phone_number_id) end;
  v_conv public.conversations;
  v_owner uuid;
begin
  if v_phone is null then return jsonb_build_object('routed', false, 'reason', 'no_phone_number_id'); end if;

  select cv.* into v_conv
  from public.conversations cv join public.contacts c on c.id = cv.contact_id
  where cv.business_id = p_business and c.wa_id = trim(p_wa_id)
  for update of cv;
  if not found then return jsonb_build_object('routed', false, 'reason', 'no_conversation'); end if;

  update public.conversations set phone_number_id = v_phone where id = v_conv.id and phone_number_id is distinct from v_phone;

  select n.owner_user_id into v_owner
  from public.business_numbers n
  where n.business_id = p_business and n.phone_number_id = v_phone and n.active
    and public.member_role(p_business, n.owner_user_id) = 'manager';

  if v_conv.assigned_to is null and v_owner is not null then
    update public.conversations
       set assigned_to = v_owner, assigned_at = now(), assigned_by = null
     where id = v_conv.id;
    return jsonb_build_object('routed', true, 'assigned_to', v_owner);
  end if;
  return jsonb_build_object('routed', true, 'assigned_to', v_conv.assigned_to);
end;
$$;

-- owner only: register or update a number and say whose it is
create function public.set_business_number(
  p_business uuid, p_actor uuid, p_phone_number_id text, p_display text, p_label text, p_owner uuid, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.business_numbers;
begin
  if public.member_role(p_business, p_actor) is distinct from 'owner' then raise exception 'forbidden'; end if;
  if trim(coalesce(p_phone_number_id, '')) !~ '^[0-9]{5,25}$' then raise exception 'invalid_phone_number_id'; end if;
  if p_owner is not null and public.member_role(p_business, p_owner) is distinct from 'manager' then
    raise exception 'not_a_manager';
  end if;
  if exists (select 1 from public.business_numbers where phone_number_id = trim(p_phone_number_id) and business_id <> p_business) then
    raise exception 'number_in_other_business';
  end if;

  insert into public.business_numbers (business_id, phone_number_id, display_phone, label, owner_user_id, active)
  values (p_business, trim(p_phone_number_id), nullif(trim(coalesce(p_display, '')), ''),
          nullif(trim(coalesce(p_label, '')), ''), p_owner, coalesce(p_active, true))
  on conflict (phone_number_id) do update
     set display_phone = excluded.display_phone, label = excluded.label,
         owner_user_id = excluded.owner_user_id, active = excluded.active
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create function public.list_business_numbers(p_business uuid, p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text := public.member_role(p_business, p_user);
begin
  if v_role is null then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(n) order by n.created_at) from public.business_numbers n
    where n.business_id = p_business and (v_role in ('owner', 'director') or n.owner_user_id = p_user)
  ), '[]'::jsonb);
end;
$$;

-- Replies leave from the number the customer wrote to; the business-level number is the fallback.
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

  v_phone := coalesce(v_conv.phone_number_id, (select wa_phone_number_id from public.businesses where id = p_business));
  -- no known sending number: refuse WITHOUT consuming the claim, so a later retry can still work
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

revoke execute on function public.route_conversation(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.set_business_number(uuid, uuid, text, text, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.list_business_numbers(uuid, uuid) from public, anon, authenticated;
grant execute on function public.route_conversation(uuid, text, text) to service_role;
grant execute on function public.set_business_number(uuid, uuid, text, text, text, uuid, boolean) to service_role;
grant execute on function public.list_business_numbers(uuid, uuid) to service_role;
