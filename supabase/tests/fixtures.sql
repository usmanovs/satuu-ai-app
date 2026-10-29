-- TEST FIXTURES. Run ONLY in a throwaway test project, never in production.
-- Creates two businesses (A, B), three users (manager A, manager B, a user with no membership)
-- and one integration key per business: test-key-A / test-key-B.
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,phone_change,phone_change_token)
select '00000000-0000-0000-0000-000000000000', u.id,'authenticated','authenticated',u.email, extensions.crypt('Test-Password-123!', extensions.gen_salt('bf')), now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','','','','',''
from (values ('a0000000-0000-0000-0000-00000000000a'::uuid,'manager-a@test.local'),
             ('b0000000-0000-0000-0000-00000000000b'::uuid,'manager-b@test.local'),
             ('c0000000-0000-0000-0000-00000000000c'::uuid,'nobody@test.local')) as u(id,email);
insert into auth.identities (id,user_id,provider_id,provider,identity_data,created_at,updated_at,last_sign_in_at)
select gen_random_uuid(), id, id::text, 'email', jsonb_build_object('sub', id::text, 'email', email), now(), now(), now() from auth.users where email like '%@test.local';
insert into public.businesses (id,name) values ('a1000000-0000-0000-0000-0000000000a1','Test Business A'),('b1000000-0000-0000-0000-0000000000b1','Test Business B');
insert into public.business_memberships (business_id,user_id) values
 ('a1000000-0000-0000-0000-0000000000a1','a0000000-0000-0000-0000-00000000000a'),
 ('b1000000-0000-0000-0000-0000000000b1','b0000000-0000-0000-0000-00000000000b');
insert into public.integration_keys (business_id,label,key_hash) values
 ('a1000000-0000-0000-0000-0000000000a1','test', encode(extensions.digest('test-key-A','sha256'),'hex')),
 ('b1000000-0000-0000-0000-0000000000b1','test', encode(extensions.digest('test-key-B','sha256'),'hex'));
