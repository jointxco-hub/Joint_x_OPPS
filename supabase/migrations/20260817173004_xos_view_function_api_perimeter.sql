-- XOS 1: make internal views honor caller RLS and remove implicit execution of
-- security-definer helpers. Public storefront/payment contracts are unchanged.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
declare v_view text;
begin
  foreach v_view in array array[
    'active_tasks','v_company_north_star','v_projects','active_orders',
    'v_orders','v_purchase_orders','expenses','income',
    'inventory_product_availability','inventory_product_source_options',
    'inventory_variant_availability','v_founder_dependency_score'
  ] loop
    if to_regclass(format('public.%I', v_view)) is not null then
      execute format('alter view public.%I set (security_invoker = true)', v_view);
      execute format('revoke all privileges on table public.%I from public, anon, authenticated', v_view);
      execute format('grant select on table public.%I to authenticated, service_role', v_view);
    end if;
  end loop;
end;
$$;

-- Remove PostgreSQL's default PUBLIC execution channel. Existing explicit
-- anon/authenticated/service_role function contracts remain intact.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', r.signature);
  end loop;
end;
$$;

-- Trigger/event-trigger functions are not client-callable RPCs.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.prorettype in ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
  loop
    execute format('revoke execute on function %s from anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end;
$$;

-- Backend-only helpers must not be callable with an end-user JWT.
revoke all on function public.upsert_opps_conversation(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_opps_conversation(uuid, text, text, text, text)
  to service_role;
revoke all on function public.xlab_bridge_file_ref_matches_tenant(text, uuid)
  from public, anon, authenticated;
grant execute on function public.xlab_bridge_file_ref_matches_tenant(text, uuid)
  to service_role;

-- Production readiness previously trusted email/JWT fallbacks.
create or replace function public.can_manage_order_production_readiness()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$ select public.is_opps_staff() $$;
revoke all on function public.can_manage_order_production_readiness()
  from public, anon, authenticated, service_role;
grant execute on function public.can_manage_order_production_readiness()
  to authenticated, service_role;

-- These folder helpers are OPPS UI operations. SECURITY INVOKER makes their
-- existing orders/clients/folders RLS checks effective for the caller.
alter function public.get_or_create_clients_root(uuid) security invoker;
alter function public.get_or_create_client_asset_folder(uuid, text, text) security invoker;
alter function public.get_or_create_order_asset_folder(uuid, text) security invoker;
alter function public.provision_order_asset_folders(uuid) security invoker;
revoke execute on function public.get_or_create_clients_root(uuid) from public, anon;
revoke execute on function public.get_or_create_client_asset_folder(uuid, text, text) from public, anon;
revoke execute on function public.get_or_create_order_asset_folder(uuid, text) from public, anon;
revoke execute on function public.provision_order_asset_folders(uuid) from public, anon;
grant execute on function public.get_or_create_clients_root(uuid) to authenticated;
grant execute on function public.get_or_create_client_asset_folder(uuid, text, text) to authenticated;
grant execute on function public.get_or_create_order_asset_folder(uuid, text) to authenticated;
grant execute on function public.provision_order_asset_folders(uuid) to authenticated;

commit;
