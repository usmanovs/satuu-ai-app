-- Multi-number / per-salesperson assistant test. Rolls back everything it creates (it raises at the end);
-- read the MULTI_NUMBER_TEST lines in the error text: each ends with "(want ...)" and must match.
do $$
declare
  b uuid; owner_u uuid;
  d uuid := gen_random_uuid(); m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid();
  n1 uuid; n2 uuid; n0 uuid;
  r jsonb; r2 jsonb; c1 uuid; c2 uuid; c0 uuid; k int; a uuid; ph text;
  out text[] := '{}';
begin
  select business_id, user_id into b, owner_u from public.business_memberships where role='owner' limit 1;
  insert into auth.users(id,email,aud,role) values (d,'d@t.test','authenticated','authenticated'),(m1,'m1@t.test','authenticated','authenticated'),(m2,'m2@t.test','authenticated','authenticated');
  insert into public.business_memberships(business_id,user_id,role,email,display_name) values
    (b,d,'director','d@t.test','Director'),(b,m1,'manager','m1@t.test','Aigerim'),(b,m2,'manager','m2@t.test','Bakyt');
  select id into n0 from public.wa_numbers where business_id=b order by created_at limit 1;     -- today's shared number
  r := public.number_add(b, d, '111111111111', '+996 700 111 111', 'Aigerim', m1); n1 := (r->>'id')::uuid;
  r := public.number_add(b, owner_u, '222222222222', '+996 700 222 222', 'Bakyt', m2); n2 := (r->>'id')::uuid;
  perform public.number_save(b, m1, n1, jsonb_build_object('assistant_name','Айгерим AI','assistant_profile','Спокойный тон, фокус: live-классы'));

  -- the same customer writes to two salespeople
  r  := public.ingest_inbound_message(b,'996555000111','wamid.T1','text','Привет, цена?',now(),'Test Customer',true,'111111111111');
  r2 := public.ingest_inbound_message(b,'996555000111','wamid.T2','text','Здравствуйте, цена?',now(),'Test Customer',true,'222222222222');
  out := out || ('Two numbers -> two separate chats: '||((r->>'conversation_id') <> (r2->>'conversation_id'))||' (want true)');
  out := out || ('Assistant profile returned for number 1: '||(r->>'assistant_name')||' (want Айгерим AI)');
  out := out || ('Salesperson name returned: '||(r->>'salesperson_name')||' (want Aigerim)');
  out := out || ('Number 2 has no assistant settings yet: '||coalesce(r2->>'assistant_name','null')||' (want null)');
  c1 := (r->>'conversation_id')::uuid; c2 := (r2->>'conversation_id')::uuid;
  select assigned_to into a from public.conversations where id=c1; out := out || ('Chat on number 1 belongs to Aigerim from message 1: '||(a=m1)||' (want true)');
  select assigned_to into a from public.conversations where id=c2; out := out || ('Chat on number 2 belongs to Bakyt: '||(a=m2)||' (want true)');

  -- visibility
  perform set_config('request.jwt.claim.sub', m1::text, true); execute 'set local role authenticated';
  select count(*) into k from public.conversations; out := out || ('Aigerim sees chats: '||k||' (want 1)');
  select count(*) into k from public.wa_numbers; out := out || ('Aigerim sees numbers: '||k||' (want 1, her own)');
  select count(*) into k from public.messages where conversation_id=c2; out := out || ('Aigerim sees Bakyt chat messages: '||k||' (want 0)');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', d::text, true); execute 'set local role authenticated';
  select count(*) into k from public.conversations where contact_id=(select id from public.contacts where wa_id='996555000111'); out := out || ('Director sees both chats of the customer: '||k||' (want 2)');
  select count(*) into k from public.wa_numbers; out := out || ('Director sees numbers: '||k||' (want 3)');
  execute 'reset role';

  -- the bot looks up the right chat by number
  perform public.set_conversation_state(b, c2, 'takeover', m2);
  r := public.ai_permission(b,'996555000111','before_generate',null,'111111111111');
  r2 := public.ai_permission(b,'996555000111','before_generate',null,'222222222222');
  out := out || ('AI allowed on number 1 chat: '||(r->>'allowed')||' (want true)');
  out := out || ('AI blocked on number 2 chat (Bakyt took over): '||(r2->>'allowed')||' (want false)');
  perform public.record_ai_message(b,'996555000111','wamid.AI1','text','Ответ ассистента Айгерим',now(),'accepted','111111111111');
  select count(*) into k from public.messages where conversation_id=c1 and sender_role='ai'; out := out || ('AI reply recorded on number 1 chat: '||k||' (want 1)');
  select count(*) into k from public.messages where conversation_id=c2 and sender_role='ai'; out := out || ('AI reply NOT on number 2 chat: '||k||' (want 0)');

  -- human replies leave from the chat's own number
  r := public.create_human_message(b, c2, m2, 'key-1', 'Привет от Бакыта', false, null);
  r2 := public.claim_human_send(b, 'key-1');
  out := out || ('Reply from Bakyt goes out from number 2: '||(r2->>'phone_number_id')||' (want 222222222222)');

  -- human request on an owned number keeps the owner
  r := public.ingest_inbound_message(b,'996555000111','wamid.T3','text','Позовите менеджера',now(),null,true,'111111111111');
  select assigned_to into a from public.conversations where id=c1;
  out := out || ('Human requested: stays with Aigerim: '||(a=m1)||' (want true), notice flag: '||(r->>'human_requested_now')||' (want true)');

  -- shared (ownerless) number still auto-assigns
  r := public.ingest_inbound_message(b,'996555000222','wamid.T4','text','Хочу поговорить с человеком',now(),'Other',true,null::text);
  select assigned_to, id into a, c0 from public.conversations where id=(r->>'conversation_id')::uuid;
  out := out || ('Shared number + human request auto-assigns a manager: '||(a is not null)||' (want true)');
  out := out || ('Null phone falls back to the first number: '||((select wa_number_id from public.conversations where id=c0)=n0)||' (want true)');

  -- unknown number registers itself
  r := public.ingest_inbound_message(b,'996555000333','wamid.T5','text','hi',now(),null,true,'999999999999');
  out := out || ('Unknown number auto-registered: '||(select count(*) from public.wa_numbers where business_id=b and phone_number_id='999999999999')||' (want 1)');

  -- who may edit what
  begin perform public.number_save(b, m1, n2, jsonb_build_object('assistant_name','hack')); out := out||'FAIL: edited other number'; exception when others then out := out||('Aigerim edits Bakyt number: '||sqlerrm||' (want forbidden)'); end;
  begin perform public.number_save(b, m1, n1, jsonb_build_object('owner_user_id', m2::text)); out := out||'FAIL: manager changed owner'; exception when others then out := out||('Manager changes number owner: '||sqlerrm||' (want forbidden)'); end;
  perform public.number_save(b, m1, n1, jsonb_build_object('assistant_name','Айгерим помощник'));
  out := out || ('Manager edits own assistant: '||(select assistant_name from public.wa_numbers where id=n1)||' (want Айгерим помощник)');
  begin perform public.number_add(b, m1, '333333333333', null, 'x', null); out := out||'FAIL: manager added number'; exception when others then out := out||('Manager adds number: '||sqlerrm||' (want forbidden)'); end;
  begin perform public.number_save(b, d, n1, jsonb_build_object('owner_user_id', d::text)); out := out||'FAIL: director as number owner'; exception when others then out := out||('Owner must be a manager: '||sqlerrm||' (want not_a_manager)'); end;

  -- director moves the number to Bakyt: its chats follow
  perform public.number_save(b, d, n1, jsonb_build_object('owner_user_id', m2::text));
  select assigned_to into a from public.conversations where id=c1; out := out || ('Chats follow the number to the new owner: '||(a=m2)||' (want true)');

  -- deactivating a manager releases their numbers
  perform public.team_update_member(b, owner_u, m2, null, null, false);
  out := out || ('Deactivated manager no longer owns numbers: '||(select count(*) from public.wa_numbers where owner_user_id=m2)||' (want 0)');

  raise exception E'MULTI_NUMBER_TEST\n%', array_to_string(out, E'\n');
end $$;
