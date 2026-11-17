-- Customer photos, videos and documents (applied 2026-11-17).
alter table public.messages
  add column if not exists media_path text,
  add column if not exists media_mime text,
  add column if not exists media_name text,
  add column if not exists media_size integer;

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-media', 'chat-media', false, 26214400)
on conflict (id) do update set file_size_limit = excluded.file_size_limit, public = false;

-- Managers can read a file only if they can see its conversation (path: business/conversation/file).
drop policy if exists chat_media_read on storage.objects;
create policy chat_media_read on storage.objects for select to authenticated
using (
  bucket_id = 'chat-media'
  and split_part(name, '/', 2) ~ '^[0-9a-f-]{36}$'
  and public.can_see_conversation(split_part(name, '/', 2)::uuid)
);

create or replace function public.message_media_target(p_business uuid, p_provider_message_id text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('message_id', m.id, 'conversation_id', m.conversation_id, 'already', m.media_path is not null)
  from public.messages m
  where m.business_id = p_business and m.provider_message_id = p_provider_message_id
  limit 1;
$$;

create or replace function public.attach_message_media(p_business uuid, p_message uuid, p_path text, p_mime text, p_name text, p_size integer)
returns void language sql security definer set search_path = public as $$
  update public.messages set media_path = p_path, media_mime = p_mime, media_name = p_name, media_size = p_size
  where id = p_message and business_id = p_business;
$$;

revoke all on function public.message_media_target(uuid, text), public.attach_message_media(uuid, uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.message_media_target(uuid, text), public.attach_message_media(uuid, uuid, text, text, text, integer) to service_role;
