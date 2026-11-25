-- Login counts per person. Supabase keeps no login history, so every sign-in is logged from now on
-- (a trigger on auth.users.last_sign_in_at); the existing last sign-in of each user seeds one event.
create table if not exists public.login_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists login_events_user_time on public.login_events (user_id, created_at desc);
alter table public.login_events enable row level security;

create or replace function public.log_login() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.login_events (user_id, created_at) values (new.id, coalesce(new.last_sign_in_at, now()));
  return new;
end;
$$;
revoke execute on function public.log_login() from public, anon, authenticated;

drop trigger if exists on_user_login on auth.users;
create trigger on_user_login after update of last_sign_in_at on auth.users
  for each row when (new.last_sign_in_at is not null and new.last_sign_in_at is distinct from old.last_sign_in_at)
  execute function public.log_login();

insert into public.login_events (user_id, created_at)
select id, last_sign_in_at from auth.users where last_sign_in_at is not null
and not exists (select 1 from public.login_events e where e.user_id = auth.users.id);

-- team_stats now also returns logins (in the period) and last_login: see the updated function in
-- 20261121000027_team_stats_assigned_period.sql, which holds the current definition.
