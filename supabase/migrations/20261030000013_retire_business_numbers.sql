-- A parallel, simpler version of "several numbers per business" (business_numbers / route_conversation /
-- set_business_number / list_business_numbers, migration 011_business_numbers) was applied by another session.
-- It is superseded by wa_numbers + conversations.wa_number_id (migration 012). Its table never held data.
drop function if exists public.route_conversation(uuid, text, text);
drop function if exists public.set_business_number(uuid, uuid, text, text, text, uuid, boolean);
drop function if exists public.list_business_numbers(uuid, uuid);
drop table if exists public.business_numbers;
alter table public.conversations drop column if exists phone_number_id;
