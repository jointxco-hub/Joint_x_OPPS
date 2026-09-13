-- CLIENT PRODUCT PRICING CONFIGURATION — enable 'addon' as a real
-- component_type.
--
-- Audit finding (see PR description): _client_product_breakdown_role
-- (20260912140000) already maps component_type 'addon' -> role 'addon',
-- and _xos_freeze_client_product_price_breakdown (20260912130000)
-- already filters product_components.component_type in (..., 'addon'),
-- and _xos_sanitize_frozen_price_breakdown's allowed role list already
-- includes 'addon' — all three were written anticipating this value,
-- but product_components_component_type_check has never actually
-- permitted it, so no product_components row could ever be created with
-- component_type = 'addon'. This migration is the one missing piece:
-- widening the CHECK so add-ons (sleeve print, neck label, custom
-- packaging, special finish, etc.) can actually exist as components,
-- using code that already exists and is already reviewed/live.
--
-- Purely additive — no existing row's component_type changes, no other
-- constraint touched, no default changed. Mirrors the exact
-- drop-constraint/add-constraint pattern already used for this same
-- constraint in 202608220004_product_composition_pricing_hierarchy_and_setup_fees.sql.
--
-- STAGING ONLY in this phase — not applied to production.

begin;

alter table public.product_components drop constraint product_components_component_type_check;
alter table public.product_components add constraint product_components_component_type_check
  check (component_type in ('blank_garment', 'print_service', 'material', 'packaging', 'labour', 'setup_fee', 'addon', 'other'));

alter table public.order_line_component_snapshots drop constraint order_line_component_snapshots_component_type_check;
alter table public.order_line_component_snapshots add constraint order_line_component_snapshots_component_type_check
  check (component_type in ('blank_garment', 'print_service', 'material', 'packaging', 'labour', 'setup_fee', 'addon', 'other'));

commit;
