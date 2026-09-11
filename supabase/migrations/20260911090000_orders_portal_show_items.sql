-- Client Portal / public tracker: staff-controlled visibility of order line
-- items, matching the existing portal_show_balance / portal_show_files
-- convention (202605180001_orders_invoice_portal_fields.sql).
--
-- A deliberate, per-order, staff-toggled flag — independent of order
-- status, payment state, or production state. Defaults false: existing
-- (historical) orders AND newly-created OPPS orders both start with items
-- hidden from the public tracker. This matches the safest, already-
-- established opt-in pattern every other portal_show_* field uses — staff
-- explicitly turn it on per order from the existing Client Portal tab
-- (Order drawer), exactly like Outstanding Balance / Uploaded Files.
--
-- This flag affects ONLY the public tracking projection
-- (public.get_public_order_tracking_for_host — see the companion
-- migration 20260911100000). It does not read, write, gate, or in any way
-- mutate orders.products[] itself; toggling it never deletes or rewrites
-- an order's line items, only whether the public tracker is allowed to
-- project a safe, allowlisted summary of them.
--
-- Additive only: no RLS policy touched, no other table changed.

alter table public.orders
  add column if not exists portal_show_items boolean not null default false;

comment on column public.orders.portal_show_items is
  'Client-facing visibility flag: when true, the public tracker (get_public_order_tracking_for_host) includes a customer-safe, allowlisted projection of this order''s line items (product name, quantity, size, colour, print/service description, safe https thumbnail, line total). Staff-toggled per order from the Order drawer''s Client Portal tab; independent of order status, payment state, and production state. Default false (opt-in) for both historical and newly-created orders, matching portal_show_balance / portal_show_files. Never derived from status; never mutates orders.products[].';
