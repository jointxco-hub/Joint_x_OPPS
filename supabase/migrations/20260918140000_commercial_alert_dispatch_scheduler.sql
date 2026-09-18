-- Commercial Alerts: scheduled dispatcher.
-- Requires one Vault secret named commercial_alert_dispatch_service_role.
-- Until that secret exists, the scheduled worker safely no-ops.

begin;

create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

-- Activation cutoff prevents historical/backfilled alerts from suddenly
-- generating browser pushes when this scheduler is first enabled.
create table if not exists public.commercial_alert_dispatch_config (
  singleton boolean primary key default true check (singleton),
  activated_at timestamptz not null default now()
);

insert into public.commercial_alert_dispatch_config (singleton)
values (true)
on conflict (singleton) do nothing;

revoke all on public.commercial_alert_dispatch_config from public, anon, authenticated;

create or replace function public.dispatch_pending_commercial_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_service_role text;
  v_dispatched integer := 0;
  v_alert record;
begin
  select decrypted_secret
    into v_service_role
  from vault.decrypted_secrets
  where name = 'commercial_alert_dispatch_service_role'
  order by created_at desc
  limit 1;

  -- Secret is intentionally provisioned outside migrations.
  -- Missing secret must never break quote/payment flows or cron execution.
  if nullif(v_service_role, '') is null then
    return 0;
  end if;

  -- Recover a worker that died after claiming but before finalizing.
  update public.commercial_alerts
  set delivery_status = 'failed',
      last_error = coalesce(last_error, 'Recovered stale processing claim')
  where delivery_status = 'processing'
    and coalesce(last_attempt_at, created_at) <= now() - interval '15 minutes'
    and coalesce(delivery_attempts, 0) < 5;

  for v_alert in
    select a.id
    from public.commercial_alerts a
    cross join public.commercial_alert_dispatch_config cfg
    where cfg.singleton = true
      and a.created_at >= cfg.activated_at
      and (
        a.delivery_status = 'pending'
        or (
          a.delivery_status = 'failed'
          and coalesce(a.delivery_attempts, 0) < 5
          and coalesce(a.last_attempt_at, a.created_at) <= now() - interval '5 minutes'
        )
      )
    order by a.created_at asc
    limit 20
  loop
    begin
      perform net.http_post(
        url := 'https://tijiamrfnxrbitafiflj.supabase.co/functions/v1/send-push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_role,
          'apikey', v_service_role
        ),
        body := jsonb_build_object(
          'commercial_alert_id', v_alert.id
        ),
        timeout_milliseconds := 5000
      );

      v_dispatched := v_dispatched + 1;
    exception when others then
      -- Scheduling transport failures are isolated from commercial activity.
      raise warning 'commercial alert schedule dispatch failed for %: %', v_alert.id, sqlerrm;
    end;
  end loop;

  return v_dispatched;
end;
$function$;

revoke all on function public.dispatch_pending_commercial_alerts() from public, anon, authenticated;

do $block$
declare
  v_existing_job_id bigint;
begin
  select jobid
    into v_existing_job_id
  from cron.job
  where jobname = 'commercial-alert-dispatch-every-minute'
  limit 1;

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;

  perform cron.schedule(
    'commercial-alert-dispatch-every-minute',
    '* * * * *',
    'select public.dispatch_pending_commercial_alerts();'
  );
end;
$block$;

comment on function public.dispatch_pending_commercial_alerts() is
  'Dispatches up to 20 commercial alerts created after scheduler activation to the send-push-notification Edge Function. Historical/backfilled alerts are deliberately excluded from browser push. Retries failed alerts no more than 5 times with a 5-minute cooldown and recovers stale processing claims after 15 minutes. Requires Vault secret commercial_alert_dispatch_service_role; safely no-ops while missing.';

commit;
