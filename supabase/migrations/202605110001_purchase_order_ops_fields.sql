alter table if exists public.purchase_orders
  add column if not exists supplier_name text,
  add column if not exists subtotal numeric(12, 2) default 0,
  add column if not exists total numeric(12, 2) default 0,
  add column if not exists order_date date,
  add column if not exists expected_delivery date,
  add column if not exists comments jsonb not null default '[]';

update public.purchase_orders
set
  total = coalesce(total, total_amount, 0),
  subtotal = coalesce(subtotal, total_amount, total, 0),
  expected_delivery = coalesce(expected_delivery, expected_date),
  order_date = coalesce(order_date, created_at::date)
where true;
