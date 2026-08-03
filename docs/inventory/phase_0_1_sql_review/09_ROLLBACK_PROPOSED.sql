-- PROPOSED RECOVERY/INVERSE SQL - DO NOT RUN WITHOUT OWNER AUTHORIZATION.
-- This never alters public.inventory or current_stock. It first removes access
-- and read/RPC surfaces. Base tables are dropped only when every Phase 1 table
-- is empty; otherwise identity and mapping history are preserved in place.

begin;
set local lock_timeout = '5s';

-- Disable all client access first.
revoke all on table public.inventory_identity_v from public, anon, authenticated;
revoke all on table public.inventory_supplier_mapping_v from public, anon, authenticated;
revoke all on table public.inventory_legacy_mapping_review_v from public, anon, authenticated;
revoke all on table public.inventory_legacy_compat_v from public, anon, authenticated;
revoke all on table public.inventory_products from public, anon, authenticated;
revoke all on table public.inventory_variants from public, anon, authenticated;
revoke all on table public.inventory_supplier_products from public, anon, authenticated;
revoke all on table public.inventory_supplier_variants from public, anon, authenticated;
revoke all on table public.inventory_legacy_mappings from public, anon, authenticated;

revoke all on function public.search_inventory_phase1(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.inventory_decide_legacy_mapping(uuid, uuid, text, text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.inventory_create_mapping_revision(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.inventory_stage_legacy_mapping(
  uuid, uuid, uuid, text, text, numeric, jsonb, text[], uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.inventory_can_review_tenant(uuid) from public, anon, authenticated;

-- Read/search surfaces can be removed without deleting review history.
drop view if exists public.inventory_legacy_compat_v;
drop view if exists public.inventory_legacy_mapping_review_v;
drop view if exists public.inventory_supplier_mapping_v;
drop view if exists public.inventory_identity_v;
drop function if exists public.search_inventory_phase1(uuid, text, integer);
drop function if exists public.inventory_decide_legacy_mapping(uuid, uuid, text, text, uuid, uuid, uuid, uuid);
drop function if exists public.inventory_create_mapping_revision(uuid, uuid, uuid, text);
drop function if exists public.inventory_stage_legacy_mapping(
  uuid, uuid, uuid, text, text, numeric, jsonb, text[], uuid, uuid, uuid, uuid
);
drop function if exists public.inventory_can_review_tenant(uuid);

-- Drop base tables only when all are unused. If any identity or mapping history
-- exists, retain every base table and its integrity triggers/functions.
do $$
declare
  v_mapping_rows bigint;
  v_product_rows bigint;
  v_variant_rows bigint;
  v_supplier_product_rows bigint;
  v_supplier_variant_rows bigint;
begin
  select count(*) into v_mapping_rows from public.inventory_legacy_mappings;
  select count(*) into v_product_rows from public.inventory_products;
  select count(*) into v_variant_rows from public.inventory_variants;
  select count(*) into v_supplier_product_rows from public.inventory_supplier_products;
  select count(*) into v_supplier_variant_rows from public.inventory_supplier_variants;

  if v_mapping_rows + v_product_rows + v_variant_rows
       + v_supplier_product_rows + v_supplier_variant_rows = 0 then
    execute 'drop table public.inventory_legacy_mappings';
    execute 'drop table public.inventory_supplier_variants';
    execute 'drop table public.inventory_supplier_products';
    execute 'drop table public.inventory_variants';
    execute 'drop table public.inventory_products';
    execute 'drop function if exists public.inventory_phase1_protect_mapping_history()';
    execute 'drop function if exists public.inventory_phase1_validate_supplier_variant()';
    execute 'drop function if exists public.inventory_phase1_validate_supplier_product()';
    execute 'drop function if exists public.inventory_phase1_touch_updated_at()';
    raise notice 'Empty Phase 1 identity/mapping objects removed.';
  else
    raise notice 'Phase 1 data exists; base tables and immutable mapping history were preserved with client grants revoked.';
  end if;
end;
$$;

commit;

-- Recovery notes:
-- 1. Disable the application feature flag before this SQL.
-- 2. Export mapping history before any later destructive recovery proposal.
-- 3. If data exists, prefer a reviewed forward correction. Do not delete approved
--    mapping history as routine rollback.
-- 4. public.inventory remains the Phase 1 source of recorded quantity, so there
--    is no stock, opening-balance, reservation, or movement reversal.
