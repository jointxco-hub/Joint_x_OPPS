-- Lets an order's product list be frozen before it reaches production
-- (e.g. once a client has approved it), in addition to the automatic lock
-- once the order's own status moves past 'confirmed'. Frontend-enforced;
-- see products_locked_at/products_locked_by on public.orders.
-- Additive only. Rollback: drop the two columns below.

alter table public.orders
  add column if not exists products_locked_at timestamptz,
  add column if not exists products_locked_by text;
