-- Row-level security: authenticated business members may READ their business's
-- data. Nobody writes from the browser; all writes go through server functions
-- that use the service role.

alter table public.businesses           enable row level security;
alter table public.business_memberships enable row level security;
alter table public.integration_keys     enable row level security;
alter table public.contacts             enable row level security;
alter table public.conversations        enable row level security;
alter table public.messages             enable row level security;
alter table public.status_events        enable row level security;

create function public.is_business_member(p_business uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_memberships m
    where m.business_id = p_business and m.user_id = (select auth.uid())
  );
$$;

create policy businesses_select on public.businesses
  for select to authenticated using (public.is_business_member(id));

create policy memberships_select_own on public.business_memberships
  for select to authenticated using (user_id = (select auth.uid()));

create policy contacts_select on public.contacts
  for select to authenticated using (public.is_business_member(business_id));

create policy conversations_select on public.conversations
  for select to authenticated using (public.is_business_member(business_id));

create policy messages_select on public.messages
  for select to authenticated using (public.is_business_member(business_id));

-- integration_keys and status_events: RLS on, no policies => service role only.

-- Defense in depth on top of RLS: no write privileges, no anon access at all.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.businesses, public.business_memberships, public.contacts,
                public.conversations, public.messages to authenticated;
