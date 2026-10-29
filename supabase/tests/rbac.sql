-- RBAC permission test. Safe to run on the live project: it creates temporary users and a second business,
-- runs the checks, then raises an exception so EVERYTHING is rolled back. Read the RBAC_TEST lines in the
-- error message: each ends with "(want ...)" and must match.
do $$
declare
  b1 uuid; b2 uuid; owner_u uuid;
  d uuid := gen_random_uuid(); m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid();
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  out text[] := '{}';
  n int; r jsonb; a uuid;
begin
  select business_id, user_id into b1, owner_u from public.business_memberships where role='owner' limit 1;
  insert into public.businesses(name) values ('OTHER BIZ') returning id into b2;
  insert into auth.users(id, email, aud, role) values (d,'d@t.test','authenticated','authenticated'),(m1,'m1@t.test','authenticated','authenticated'),(m2,'m2@t.test','authenticated','authenticated'),(o2,'o2@t.test','authenticated','authenticated');
  insert into public.business_memberships(business_id,user_id,role,email,display_name) values
    (b1,d,'director','d@t.test','Dir'),(b1,m1,'manager','m1@t.test','M1'),(b1,m2,'manager','m2@t.test','M2'),(b2,o2,'owner','o2@t.test','Other owner');
  select (array_agg(id order by created_at))[1], (array_agg(id order by created_at))[2], (array_agg(id order by created_at))[3], (array_agg(id order by created_at))[4]
    into c1,c2,c3,c4 from public.conversations where business_id=b1;   -- needs at least 4 conversations
  update public.conversations set assigned_to=m1 where id=c1;
  update public.conversations set assigned_to=m2 where id=c2;
  update public.conversations set assigned_to=null where id in (c3,c4);

  perform set_config('request.jwt.claim.sub', m1::text, true); execute 'set local role authenticated';
  select count(*) into n from public.conversations; out := out || ('M1 sees conversations: '||n||' (want 1)');
  select count(*) into n from public.messages where conversation_id = c2; out := out || ('M1 sees M2 messages: '||n||' (want 0)');
  select count(*) into n from public.contacts; out := out || ('M1 sees contacts: '||n||' (want 1)');
  select count(*) into n from public.business_memberships; out := out || ('M1 sees memberships: '||n||' (want 1)');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', d::text, true); execute 'set local role authenticated';
  select count(*) into n from public.conversations; out := out || ('Director sees conversations: '||n||' (want 4)');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', o2::text, true); execute 'set local role authenticated';
  select count(*) into n from public.conversations; out := out || ('Other business owner sees conversations: '||n||' (want 0)');
  execute 'reset role';

  begin perform public.set_conversation_state(b1, c2, 'takeover', m1); out := out || 'FAIL: M1 took over M2 chat'; exception when others then out := out || ('M1 takeover of M2 chat: '||sqlerrm||' (want forbidden)'); end;
  begin perform public.set_conversation_outcome(b1, c2, 'won', m1); out := out || 'FAIL'; exception when others then out := out || ('M1 outcome on M2 chat: '||sqlerrm||' (want forbidden)'); end;
  begin perform public.assert_conversation_access(b1, m1, c2); out := out || 'FAIL'; exception when others then out := out || ('M1 reply access on M2 chat: '||sqlerrm||' (want forbidden)'); end;
  r := public.set_conversation_state(b1, c1, 'takeover', m1); out := out || ('M1 takeover own chat: '||(r->>'state')||' (want human_handling)');
  r := public.set_conversation_state(b1, c1, 'resume', m1); out := out || ('M1 return own chat to AI: '||(r->>'state')||' (want ai_active)');
  begin perform public.assign_conversation(b1, c1, m2, m1); out := out || 'FAIL'; exception when others then out := out || ('M1 assign: '||sqlerrm||' (want forbidden)'); end;
  begin perform public.set_conversation_state(b1, c1, 'takeover', o2); out := out || 'FAIL'; exception when others then out := out || ('Outsider acting on business 1: '||sqlerrm||' (want forbidden)'); end;
  r := public.set_conversation_state(b1, c3, 'takeover', d); out := out || ('Director takeover unassigned -> assigned to director: '||((r->>'assigned_to')::uuid = d)||' (want true)');
  r := public.assign_conversation(b1, c1, m2, d); out := out || ('Director reassigns M1->M2: '||((r->>'assigned_to')::uuid = m2)||' (want true)');
  begin perform public.assign_conversation(b1, c1, d, owner_u); out := out || 'FAIL'; exception when others then out := out || ('Assign to non-manager: '||sqlerrm||' (want not_a_manager)'); end;
  begin perform public.team_add_member(b1, d, gen_random_uuid(), 'x@t.test','X','manager'); out := out || 'FAIL'; exception when others then out := out || ('Director adds member: '||sqlerrm||' (want forbidden)'); end;
  begin perform public.team_update_member(b1, owner_u, owner_u, 'manager', null, null); out := out || 'FAIL'; exception when others then out := out || ('Change owner role: '||sqlerrm||' (want forbidden)'); end;

  update public.conversations set assigned_to=null, state='ai_active' where id=c4;
  update public.conversations set state='human_requested' where id=c4;
  select assigned_to into a from public.conversations where id=c4;
  out := out || ('Auto-assign on human request picked M1 (fewest open chats): '||(a = m1)||' (want true)');
  update public.conversations set state='ai_active' where id=c4; update public.conversations set state='human_requested' where id=c4;
  select count(*) into n from public.conversations where id=c4 and assigned_to=m1; out := out || ('Second request keeps same manager: '||n||' (want 1)');
  perform public.team_update_member(b1, owner_u, m1, null, null, false);
  select count(*) into n from public.conversations where assigned_to=m1; out := out || ('Chats left on deactivated manager: '||n||' (want 0)');
  r := public.team_stats(b1, m2, now() - interval '30 days'); out := out || ('Manager stats rows: '||jsonb_array_length(r->'managers')||' (want 1, own only)');
  r := public.team_stats(b1, d, now() - interval '30 days'); out := out || ('Director stats rows: '||jsonb_array_length(r->'managers')||' (want 1: only M2 active)');

  raise exception E'RBAC_TEST\n%', array_to_string(out, E'\n');
end $$;
