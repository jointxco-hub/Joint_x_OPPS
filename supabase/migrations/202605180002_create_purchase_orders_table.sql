-- Ensure purchase_orders table exists with all required columns
create table if not exists public.purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  po_number        text,
  supplier_id      uuid,
  supplier_name    text,
  project_id       uuid,
  linked_order_id  uuid,
  status           text not null default 'draft',
  items            jsonb not null default '[]',
  notes            text,
  subtotal         numeric(12, 2) default 0,
  total_amount     numeric(12, 2) default 0,
  total            numeric(12, 2) default 0,
  order_date       date,
  expected_date    date,
  expected_delivery date,
  received_date    date,
  comments         jsonb not null default '[]',
  is_archived      boolean not null default false,
  archived_at      timestamptz,
  archived_by      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- If it already existed, patch any missing columns
alter table public.purchase_orders
  add column if not exists supplier_name    text,
  add column if not exists subtotal         numeric(12, 2) default 0,
  add column if not exists total            numeric(12, 2) default 0,
  add column if not exists order_date       date,
  add column if not exists expected_delivery date,
  add column if not exists comments         jsonb not null default '[]',
  add column if not exists project_id       uuid,
  add column if not exists linked_order_id  uuid,
  add column if not exists received_date    date,
  add column if not exists archived_by      text;

-- Enable RLS and allow authenticated users full access
alter table public.purchase_orders enable row level security;

create policy if not exists "Auth users manage purchase_orders"
  on public.purchase_orders for all
  to authenticated
  using (true)
  with check (true);
