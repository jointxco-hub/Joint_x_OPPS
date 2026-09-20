-- Record the PAXI dispatch gate hardening already applied to staging and production.
-- Trigger helpers are internal implementation details and must not be callable
-- through PostgREST by anon or authenticated roles.

begin;

alter function public._normalize_courier_code(text)
  set search_path = pg_catalog;

revoke execute on function public._normalize_courier_code(text)
  from public, anon, authenticated;

revoke execute on function public._enforce_order_paxi_dispatch_gate()
  from public, anon, authenticated;

revoke execute on function public._log_order_paxi_dispatch_activity()
  from public, anon, authenticated;

commit;
