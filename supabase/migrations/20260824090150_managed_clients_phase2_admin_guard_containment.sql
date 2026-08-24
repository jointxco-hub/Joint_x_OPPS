-- Managed Clients Control Plane — Phase 2 emergency containment.
--
-- CRITICAL AUTH FINDING (live production validation, rollback-wrapped):
-- public.is_app_admin() can return NULL - not FALSE - for an
-- authenticated identity that has no matching public.users row and does
-- not match the hardcoded admin email allowlist (its role-check arm,
-- `public.current_user_app_role() = 'admin'`, evaluates to NULL when
-- current_user_app_role() itself returns NULL, and `NULL OR FALSE` is
-- NULL in three-valued SQL logic). Every Phase 2 RPC guards with
-- `IF NOT public.is_app_admin() THEN RAISE ... END IF;`, but `NOT NULL`
-- is also NULL, and PL/pgSQL's IF does not enter its THEN branch on a
-- NULL condition - so that guard silently fails OPEN for exactly this
-- identity shape, letting a normal authenticated (non-admin) user bypass
-- the intended admin-only gate. Proven in production by the disposable
-- rollback-wrapped SQL suite (supabase/tests/managed_clients_phase2_operations.sql);
-- the transaction rolled back, so no persistent GSB or other production
-- data change occurred.
--
-- This migration is the immediate containment step: revoke authenticated
-- EXECUTE from all six Phase 2 operational RPCs, making them
-- unreachable from the browser entirely until the shared authority
-- helper itself is fixed to never return NULL (see the follow-up
-- migration, 20260824090200_app_admin_null_safety_and_phase2_regrant.sql,
-- which restores these grants only after CREATE OR REPLACING
-- public.is_app_admin() to guarantee a real boolean). This does not
-- alter any RPC's body, only its authenticated-role grant.

revoke execute on function
  public.admin_update_managed_client_workspace(uuid, jsonb)
  from authenticated;

revoke execute on function
  public.admin_initialize_managed_client_workspace(uuid, jsonb)
  from authenticated;

revoke execute on function
  public.admin_preview_managed_brand_provisioning(jsonb)
  from authenticated;

revoke execute on function
  public.admin_provision_managed_brand(jsonb, text)
  from authenticated;

revoke execute on function
  public.admin_activate_managed_xos_domain(uuid)
  from authenticated;

revoke execute on function
  public.admin_set_managed_tenant_products_capability(uuid, boolean)
  from authenticated;
