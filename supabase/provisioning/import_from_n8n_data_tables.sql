-- ONE-TIME import of the unpublished n8n Data Tables into Supabase.
-- STATUS: template, NOT tested against your real export. Run on a copy first.
--
-- 1. Export the n8n Data Tables wa_customers and wa_messages as CSV.
-- 2. Supabase dashboard -> Table editor -> create tables `import_wa_customers` and `import_wa_messages`
--    from those CSVs (all columns as text).
-- 3. Replace :business_id below, run this file, check the counts, then DROP the import_* tables.
--
-- Imported history cannot tell AI replies from manager replies, so outbound rows become sender_role = 'ai'.
-- Delivery status is unknown for old rows, so they are imported as 'accepted' (never as delivered).

do $$
declare v_biz uuid := '00000000-0000-0000-0000-000000000000'; -- <-- your business_id
begin
  insert into public.contacts (business_id, wa_id, display_name)
  select v_biz, trim(sender_id), nullif(trim(display_name), '')
  from public.import_wa_customers
  on conflict (business_id, wa_id) do nothing;

  insert into public.conversations (business_id, contact_id, state, state_note, state_updated_at,
                                    last_inbound_at, last_message_at, last_message_preview)
  select v_biz, c.id,
         case i.state when 'human_requested' then 'human_requested' when 'human_handling' then 'human_handling' else 'ai_active' end,
         nullif(i.state_note, ''),
         coalesce(nullif(i.state_updated_at, '')::timestamptz, now()),
         nullif(i.last_inbound_at, '')::timestamptz,
         nullif(i.last_inbound_at, '')::timestamptz,
         left(i.last_message_preview, 140)
  from public.import_wa_customers i
  join public.contacts c on c.business_id = v_biz and c.wa_id = trim(i.sender_id)
  on conflict (business_id, contact_id) do nothing;

  insert into public.messages (business_id, conversation_id, provider_message_id, sender_role, direction,
                               message_type, body, message_timestamp, status)
  select v_biz, cv.id, nullif(trim(m.provider_message_id), ''),
         case when m.direction = 'inbound' then 'customer' else 'ai' end,
         case when m.direction = 'inbound' then 'inbound' else 'outbound' end,
         'text', coalesce(m.body, ''),
         coalesce(nullif(m.message_timestamp, '')::timestamptz, now()),
         case when m.direction = 'inbound' then 'received' else 'accepted' end
  from public.import_wa_messages m
  join public.contacts c on c.business_id = v_biz and c.wa_id = trim(m.sender_id)
  join public.conversations cv on cv.business_id = v_biz and cv.contact_id = c.id
  on conflict (business_id, provider_message_id) do nothing;
end $$;

select (select count(*) from public.contacts) as contacts,
       (select count(*) from public.conversations) as conversations,
       (select count(*) from public.messages) as messages;
