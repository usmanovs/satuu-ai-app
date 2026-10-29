-- Role-based access control: owner | director | manager.
--   owner    all conversations, manages directors and managers, settings
--   director all conversations, assigns/reassigns, takes over, sees every manager's performance
--   manager  ONLY conversations assigned to them (enforced by RLS and by every write function)
-- Business isolation is unchanged: every check is scoped to the caller's own business membership.

-- ---------------------------------------------------------------- members
alter table public.business_memberships drop constraint business_memberships_role_check;
alter table public.business_memberships
  add constraint business_memberships_role_check check (role in ('owner', 'director', 'manager')),
  add column display_name text,
  add column email text,
  add column active boolean not null default true;

update public.business_memberships m
   set email = u.email
  from auth.users u
 where u.id = m.user_id and m.email is null;

-- ---------------------------------------------------------------- assignment
alter table public.conversations
  add column assigned_to uuid references auth.users (id) on delete set null,
  add column assigned_at timestamptz,
  add column assigned_by uuid references auth.users (id) on delete set null; -- null = automatic
create index conversations_assigned_idx on public.conversations (business_id, assigned_to);

-- ---------------------------------------------------------------- helpers
-- role of an ACTIVE member of that business, else null
create function public.member_role(p_business uuid, p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select m.role from public.business_memberships m
  where m.business_id = p_business and m.user_id = p_user and m.active;
$$;

-- may the signed-in user (auth.uid()) see a conversation of this business assigned to p_assigned?
create function public.can_see(p_business uuid, p_assigned uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.business_memberships m
    where m.business_id = p_business and m.user_id = (select auth.uid()) and m.active
      and (m.role in ('owner', 'director') or (m.role = 'manager' and p_assigned = m.user_id))
  );
$$;

create function public.can_see_conversation(p_conversation uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation and public.can_see(c.business_id, c.assigned_to)
  );
$$;

create function public.can_see_contact(p_contact uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.contact_id = p_contact and public.can_see(c.business_id, c.assigned_to)
  );
$$;

-- same rule for server code that acts on behalf of a user (service role): raises 'forbidden'
create function public.assert_conversation_access(p_business uuid, p_user uuid, p_conversation uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text := public.member_role(p_business, p_user);
  v_assigned uuid;
begin
  if v_role is null then raise exception 'forbidden'; end if;
  select assigned_to into v_assigned from public.conversations
   where id = p_conversation and business_id = p_business;
  if not found then raise exception 'not_found'; end if;
  if v_role = 'manager' and v_assigned is distinct from p_user then raise exception 'forbidden'; end if;
  return v_role;
end;
$$;

-- ---------------------------------------------------------------- RLS
create or replace function public.is_business_member(p_business uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.business_memberships m
    where m.business_id = p_business and m.user_id = (select auth.uid()) and m.active
  );
$$;

drop policy conversations_select on public.conversations;
drop policy messages_select on public.messages;
drop policy contacts_select on public.contacts;

create policy conversations_select on public.conversations
  for select to authenticated using (public.can_see(business_id, assigned_to));
create policy messages_select on public.messages
  for select to authenticated using (public.can_see_conversation(conversation_id));
create policy contacts_select on public.contacts
  for select to authenticated using (public.can_see_contact(id));

-- ---------------------------------------------------------------- auto-assign on human request
-- active manager with the fewest open human chats; ties go to whoever was assigned longest ago
create function public.pick_manager(p_business uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.user_id from public.business_memberships m
  where m.business_id = p_business and m.role = 'manager' and m.active
  order by
    (select count(*) from public.conversations c
      where c.business_id = m.business_id and c.assigned_to = m.user_id and c.outcome is null
        and c.state in ('human_requested', 'human_handling')),
    (select coalesce(max(c.assigned_at), '-infinity'::timestamptz) from public.conversations c
      where c.business_id = m.business_id and c.assigned_to = m.user_id),
    m.created_at
  limit 1;
$$;

-- Fires for every path that sets human_requested (keyword detection in ingest, AI request_human).
-- A chat that already has an assigned manager keeps them.
create function public.conversations_autoassign()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.state = 'human_requested' and old.state is distinct from 'human_requested' and new.assigned_to is null then
    new.assigned_to := public.pick_manager(new.business_id);
    if new.assigned_to is not null then
      new.assigned_at := now();
      new.assigned_by := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger conversations_autoassign_trg
  before update of state on public.conversations
  for each row execute function public.conversations_autoassign();

-- ---------------------------------------------------------------- state changes with permission checks
create or replace function public.set_conversation_state(
  p_business uuid, p_conversation uuid, p_action text, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_role text;
  v_changed boolean := false;
begin
  v_role := public.member_role(p_business, p_user);
  if v_role is null then raise exception 'forbidden'; end if;

  select * into v_conv from public.conversations
  where id = p_conversation and business_id = p_business for update;
  if not found then raise exception 'not_found'; end if;
  if v_role = 'manager' and v_conv.assigned_to is distinct from p_user then raise exception 'forbidden'; end if;

  if p_action = 'takeover' then
    if v_conv.state <> 'human_handling' then
      update public.conversations
         set state = 'human_handling', state_version = state_version + 1, state_updated_at = now(),
             state_updated_by = p_user, state_note = null, manager_last_read_at = now()
       where id = v_conv.id returning * into v_conv;
      v_changed := true;
    end if;
    -- an unassigned chat belongs to whoever takes it
    if v_conv.assigned_to is null then
      update public.conversations
         set assigned_to = p_user, assigned_at = now(), assigned_by = p_user
       where id = v_conv.id returning * into v_conv;
    end if;
  elsif p_action = 'resume' then
    if v_conv.state <> 'ai_active' then
      update public.conversations
         set state = 'ai_active', state_version = state_version + 1, state_updated_at = now(),
             state_updated_by = p_user, state_note = null
       where id = v_conv.id returning * into v_conv;
      v_changed := true;
    end if;
  elsif p_action = 'mark_read' then
    update public.conversations set manager_last_read_at = now() where id = v_conv.id
    returning * into v_conv;
  else
    raise exception 'invalid_action';
  end if;

  return jsonb_build_object('changed', v_changed, 'conversation_id', v_conv.id, 'state', v_conv.state,
                            'state_version', v_conv.state_version, 'state_updated_at', v_conv.state_updated_at,
                            'assigned_to', v_conv.assigned_to);
end;
$$;

create or replace function public.set_conversation_outcome(p_business uuid, p_conversation uuid, p_outcome text, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv public.conversations;
begin
  if p_outcome not in ('won', 'lost', 'open') then raise exception 'invalid_outcome'; end if;
  perform public.assert_conversation_access(p_business, p_user, p_conversation);

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

-- owner / director only. p_to = null un-assigns; otherwise the target must be an active manager.
create function public.assign_conversation(p_business uuid, p_conversation uuid, p_to uuid, p_by uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.member_role(p_business, p_by);
  v_conv public.conversations;
begin
  if v_role is null or v_role not in ('owner', 'director') then raise exception 'forbidden'; end if;
  if p_to is not null and public.member_role(p_business, p_to) is distinct from 'manager' then
    raise exception 'not_a_manager';
  end if;

  select * into v_conv from public.conversations
  where id = p_conversation and business_id = p_business for update;
  if not found then raise exception 'not_found'; end if;

  update public.conversations
     set assigned_to = p_to,
         assigned_at = case when p_to is null then null else now() end,
         assigned_by = case when p_to is null then null else p_by end
   where id = v_conv.id
  returning * into v_conv;

  return jsonb_build_object('conversation_id', v_conv.id, 'assigned_to', v_conv.assigned_to);
end;
$$;

-- ---------------------------------------------------------------- team
-- members of the business; a manager gets only their own row
create function public.team_list(p_business uuid, p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text := public.member_role(p_business, p_user);
begin
  if v_role is null then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', m.user_id, 'email', m.email, 'display_name', m.display_name,
             'role', m.role, 'active', m.active) order by m.created_at)
    from public.business_memberships m
    where m.business_id = p_business and (v_role in ('owner', 'director') or m.user_id = p_user)
  ), '[]'::jsonb);
end;
$$;

-- owner only. The auth user already exists (created by the Edge Function); one business per user.
create function public.team_add_member(p_business uuid, p_actor uuid, p_user uuid, p_email text, p_name text, p_role text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if public.member_role(p_business, p_actor) is distinct from 'owner' then raise exception 'forbidden'; end if;
  if p_role not in ('director', 'manager') then raise exception 'invalid_role'; end if;
  if exists (select 1 from public.business_memberships where user_id = p_user) then
    raise exception 'user_in_other_business';
  end if;
  insert into public.business_memberships (business_id, user_id, role, email, display_name)
  values (p_business, p_user, p_role, lower(trim(p_email)), nullif(trim(coalesce(p_name, '')), ''));
  return jsonb_build_object('user_id', p_user, 'role', p_role);
end;
$$;

-- owner only; the owner row itself can never be changed here
create function public.team_update_member(p_business uuid, p_actor uuid, p_target uuid, p_role text, p_name text, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_target public.business_memberships;
begin
  if public.member_role(p_business, p_actor) is distinct from 'owner' then raise exception 'forbidden'; end if;
  select * into v_target from public.business_memberships where business_id = p_business and user_id = p_target for update;
  if not found then raise exception 'not_found'; end if;
  if v_target.role = 'owner' then raise exception 'forbidden'; end if;
  if p_role is not null and p_role not in ('director', 'manager') then raise exception 'invalid_role'; end if;

  update public.business_memberships
     set role = coalesce(p_role, role),
         display_name = coalesce(nullif(trim(coalesce(p_name, '')), ''), display_name),
         active = coalesce(p_active, active)
   where id = v_target.id;

  -- a deactivated member, or one who stops being a manager, must not keep chats
  if coalesce(p_active, true) = false or (p_role is not null and p_role <> 'manager') then
    update public.conversations
       set assigned_to = null, assigned_at = null, assigned_by = null
     where business_id = p_business and assigned_to = p_target;
  end if;
  return jsonb_build_object('user_id', p_target);
end;
$$;

create function public.team_remove_member(p_business uuid, p_actor uuid, p_target uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_target public.business_memberships;
begin
  if public.member_role(p_business, p_actor) is distinct from 'owner' then raise exception 'forbidden'; end if;
  select * into v_target from public.business_memberships where business_id = p_business and user_id = p_target for update;
  if not found then raise exception 'not_found'; end if;
  if v_target.role = 'owner' then raise exception 'forbidden'; end if;

  update public.conversations
     set assigned_to = null, assigned_at = null, assigned_by = null
   where business_id = p_business and assigned_to = p_target;
  delete from public.business_memberships where id = v_target.id;
  return jsonb_build_object('user_id', p_target);
end;
$$;

-- ---------------------------------------------------------------- performance
-- owner/director: every active manager. manager: only themselves. Summary follows the same scope.
create function public.team_stats(p_business uuid, p_user uuid, p_since timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text := public.member_role(p_business, p_user);
  v_rows jsonb;
  v_sum jsonb;
begin
  if v_role is null then raise exception 'forbidden'; end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.name), '[]'::jsonb) into v_rows
  from (
    select m.user_id, coalesce(nullif(m.display_name, ''), m.email) as name,
      (select count(*) from public.conversations c
        where c.business_id = p_business and c.assigned_to = m.user_id) as assigned_total,
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
    where m.business_id = p_business and m.role = 'manager' and m.active
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

-- ---------------------------------------------------------------- grants
revoke execute on function public.member_role(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.assert_conversation_access(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.pick_manager(uuid) from public, anon, authenticated;
revoke execute on function public.conversations_autoassign() from public, anon, authenticated;
revoke execute on function public.assign_conversation(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.team_list(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.team_add_member(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.team_update_member(uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.team_remove_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.team_stats(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.member_role(uuid, uuid) to service_role;
grant execute on function public.assert_conversation_access(uuid, uuid, uuid) to service_role;
grant execute on function public.pick_manager(uuid) to service_role;
grant execute on function public.assign_conversation(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.team_list(uuid, uuid) to service_role;
grant execute on function public.team_add_member(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.team_update_member(uuid, uuid, uuid, text, text, boolean) to service_role;
grant execute on function public.team_remove_member(uuid, uuid, uuid) to service_role;
grant execute on function public.team_stats(uuid, uuid, timestamptz) to service_role;
-- can_see / can_see_conversation / can_see_contact / is_business_member are used by RLS policies and
-- must stay callable by `authenticated`; they only ever answer about auth.uid().
