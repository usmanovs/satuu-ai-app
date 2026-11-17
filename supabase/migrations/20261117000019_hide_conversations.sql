-- Conversations can be hidden from the dashboard (test chats). Nothing is deleted; clear hidden_at to show a chat again.
alter table public.conversations add column hidden_at timestamptz;

-- Hide the chats on the Vietnamese number (+84 58 257 2652) that were only tests, except the one real lead (applied 2026-11-17).
update public.conversations cv set hidden_at = now()
 where cv.wa_number_id = (select id from public.wa_numbers where phone_number_id = '1398492603357886')
   and cv.contact_id not in (select id from public.contacts where wa_id = '996508010410');

-- team_stats_impl was replaced so team statistics ignore hidden chats (see the live function).
