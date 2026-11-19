-- n8n uptime monitor. The n8n watchdog cannot report when n8n itself is down (2026-11-18 outage), so the
-- database pings n8n every 5 minutes. Two failed probes in a row raise a dashboard banner (bot_alerts); the
-- banner clears itself on the first healthy probe. Probes older than 3 days are removed.
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table public.n8n_health (
  id bigserial primary key,
  checked_at timestamptz not null default now(),
  request_id bigint,
  status_code int,
  ok boolean
);
create index n8n_health_checked_idx on public.n8n_health (checked_at desc);
alter table public.n8n_health enable row level security;
revoke all on public.n8n_health from anon, authenticated;

create function public.n8n_health_probe() returns void
language plpgsql security definer set search_path = ''
as $$
declare v_req bigint;
begin
  select net.http_get(url := 'https://getforce.app.n8n.cloud/healthz', timeout_milliseconds := 10000) into v_req;
  insert into public.n8n_health (request_id) values (v_req);
end;
$$;

create function public.n8n_health_eval() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_business uuid;
  v_bad int;
  v_last boolean;
begin
  -- fill in the results of probes sent at least 20 s ago (a probe with no response row counts as failed)
  update public.n8n_health h
     set status_code = r.status_code,
         ok = (r.status_code between 200 and 299)
    from net._http_response r
   where r.id = h.request_id and h.ok is null and h.checked_at < now() - interval '20 seconds';
  update public.n8n_health set ok = false
   where ok is null and checked_at < now() - interval '2 minutes';

  select id into v_business from public.businesses limit 1;
  if v_business is null then return; end if;

  select count(*) filter (where not ok) into v_bad from (
    select ok from public.n8n_health where ok is not null order by checked_at desc limit 2) t;
  select ok into v_last from public.n8n_health where ok is not null order by checked_at desc limit 1;

  if v_bad = 2 then
    perform public.record_bot_alert(v_business, 'error', 'n8n не отвечает: бот не работает',
      'Проверка n8n (healthz) не прошла 2 раза подряд. Откройте getforce.app.n8n.cloud: лимит выполнений, оплата, статус.',
      'n8n uptime', 'n8n-health', null);
  elsif v_last then
    update public.bot_alerts set resolved_at = now()
     where business_id = v_business and resolved_at is null and node = 'n8n-health';
  end if;

  delete from public.n8n_health where checked_at < now() - interval '3 days';
end;
$$;

revoke execute on function public.n8n_health_probe() from public, anon, authenticated;
revoke execute on function public.n8n_health_eval() from public, anon, authenticated;

select cron.schedule('n8n-health-probe', '*/5 * * * *', $$select public.n8n_health_probe()$$);
select cron.schedule('n8n-health-eval', '2-59/5 * * * *', $$select public.n8n_health_eval()$$);
