-- Commercial Alerts: dedicated internal dispatcher secret.
begin;

create or replace function public.dispatch_pending_commercial_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_service_role text;
  v_dispatch_secret text;
  v_function_url text;
  v_dispatched integer := 0;
  v_alert record;
begin
  select decrypted_secret into v_service_role
  from vault.decrypted_secrets
  where name = 'commercial_alert_dispatch_service_role'
  order by created_at desc
  limit 1;

  select decrypted_secret into v_dispatch_secret
  from vault.decrypted_secrets
  where name = 'commercial_alert_dispatch_secret'
  order by created_at desc
  limit 1;

  select decrypted_secret into v_function_url
  from vault.decrypted_secrets
  where name = 'commercial_alert_dispatch_function_url'
  order by created_at desc
  limit 1;

  if nullif(v_service_role, '') is null
     or nullif(v_dispatch_secret, '') is null
     or nullif(v_function_url, '') is null then
    return 0;
  end if;

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
        url := v_function_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_role,
          'apikey', v_service_role,
          'x-commercial-dispatch-secret', v_dispatch_secret
        ),
        body := jsonb_build_object('commercial_alert_id', v_alert.id),
        timeout_milliseconds := 5000
      );

      v_dispatched := v_dispatched + 1;
    exception when others then
      raise warning 'commercial alert schedule dispatch failed for %: %', v_alert.id, sqlerrm;
    end;
  end loop;

  return v_dispatched;
end;
$function$;

revoke all on function public.dispatch_pending_commercial_alerts() from public, anon, authenticated;

comment on function public.dispatch_pending_commercial_alerts() is
  'Dispatches post-activation commercial alerts. Uses a Vault-configured function URL and Supabase server key for the Edge gateway, plus a separate commercial_alert_dispatch_secret for internal authorization.';

commit;
