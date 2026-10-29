-- Creates the key n8n uses to call the `n8n` Edge Function. Run in the SQL editor.
-- The plain key is shown ONCE in the result. Only its SHA-256 hash is stored.
-- Put it into an n8n "Header Auth" credential:  Name = Authorization, Value = Bearer <key>
--
-- To rotate: run again, update the n8n credential, then revoke the old row:
--   update public.integration_keys set revoked_at = now() where id = '<old id>';

with k as (
  select 'sk_' || encode(extensions.gen_random_bytes(24), 'hex') as plain
), ins as (
  insert into public.integration_keys (business_id, label, key_hash)
  select (select id from public.businesses order by created_at limit 1),   -- single-business MVP
         'n8n',
         encode(extensions.digest(plain, 'sha256'), 'hex')
  from k
  returning id
)
select plain as "SAVE THIS KEY NOW (shown once)", (select id from ins) as key_id from k;
