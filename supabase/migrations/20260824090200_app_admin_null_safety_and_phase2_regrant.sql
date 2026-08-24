-- App-admin authority: NULL-safety fix, plus the Phase 2 re-grant that
-- depends on it.
--
-- Fixes the shared root cause of the CRITICAL AUTH FINDING contained by
-- 20260824090150_managed_clients_phase2_admin_guard_containment.sql: the
-- fix belongs at the shared authority source (public.is_app_admin()),
-- not duplicated across the six Phase 2 RPC bodies that call it.
--
-- public.is_app_admin() is not Managed-Clients-specific - production
-- inspection shows it is already used by RLS policies and other RPCs
-- across the codebase (orders/clients tenant-manage policies,
-- add_internal_user_to_joint_x_team's grants, etc.). Changing its NULL
-- result to FALSE is a pure security-hardening tightening, never a grant
-- of new authority: every existing SQL predicate that already treated
-- NULL as "not true" (RLS USING/WITH CHECK clauses, WHERE clauses)
-- continues to deny exactly as before - NULL and FALSE both fail those
-- checks identically. The only behavioral change is in PL/pgSQL
-- `IF NOT public.is_app_admin() THEN ... END IF;` callers (the Phase 2
-- RPCs), where NULL previously and incorrectly failed to enter the
-- raise-and-deny branch; FALSE now correctly does.
--
-- CREATE OR REPLACE preserves the function's identity exactly - same
-- signature, LANGUAGE sql, STABLE, SECURITY DEFINER, search_path, and
-- the existing hardcoded admin-email allowlist (not expanded, not
-- reduced). The only change: the role-check arm,
-- `public.current_user_app_role() = 'admin'`, is now wrapped in
-- `coalesce(..., false)`. current_user_app_role() itself returns NULL
-- when the calling identity has no matching public.users row (its query
-- is `select role from public.users where auth_user_id = auth.uid()`,
-- zero rows -> NULL) - previously that NULL propagated through `= 'admin'`
-- (also NULL) and then through the outer `OR`, producing a NULL overall
-- result whenever the email arm was also false (the email arm itself is
-- always a real boolean, never NULL, because of its own inner
-- coalesce(...,'') - so the bug could only ever manifest through the
-- role arm). Wrapping only that arm in coalesce(...,false) is sufficient
-- and minimal:
--   known app admin (public.users.role = 'admin')      -> TRUE
--   allowlisted admin email                             -> TRUE
--   ordinary authenticated user (has a users row)        -> FALSE
--   identity with no public.users row                    -> FALSE
--   anonymous/missing claims                             -> FALSE
-- No input shape can produce NULL any more.

create or replace function public.is_app_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(public.current_user_app_role() = 'admin', false)
    or lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'jointx.co@gmail.com', 'jointsexclusive@gmail.com',
      'jasperjaimataruse@gmail.com', 'jaicreativerealm@gmail.com'
    );
$$;

-- =====================================================================
-- Phase 2 re-grant - ONLY now that is_app_admin() is guaranteed to
-- return a real boolean, never NULL, so every `IF NOT
-- public.is_app_admin() THEN RAISE ... END IF;` guard in these six RPCs
-- correctly denies a non-admin identity instead of silently admitting
-- one. No RPC body is modified in this migration - only the
-- authenticated-role EXECUTE grant revoked by 20260824090150 is
-- restored, function-for-function.
-- =====================================================================

grant execute on function
  public.admin_update_managed_client_workspace(uuid, jsonb)
  to authenticated;

grant execute on function
  public.admin_initialize_managed_client_workspace(uuid, jsonb)
  to authenticated;

grant execute on function
  public.admin_preview_managed_brand_provisioning(jsonb)
  to authenticated;

grant execute on function
  public.admin_provision_managed_brand(jsonb, text)
  to authenticated;

grant execute on function
  public.admin_activate_managed_xos_domain(uuid)
  to authenticated;

grant execute on function
  public.admin_set_managed_tenant_products_capability(uuid, boolean)
  to authenticated;

-- =====================================================================
-- Post-apply verification (run manually, not part of this script):
--   select public.is_app_admin() is not null; -- expect true, always, for every caller shape
--   select has_function_privilege('authenticated', 'public.admin_provision_managed_brand(jsonb,text)', 'EXECUTE'); -- expect true
-- =====================================================================
