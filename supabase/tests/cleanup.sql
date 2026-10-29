-- Removes everything fixtures.sql and the integration tests created. Test project only.
delete from public.businesses where id in ('a1000000-0000-0000-0000-0000000000a1','b1000000-0000-0000-0000-0000000000b1');
delete from auth.users where email like '%@test.local';
drop table if exists public.test_mock_calls;
