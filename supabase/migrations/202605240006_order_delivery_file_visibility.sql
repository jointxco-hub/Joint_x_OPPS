-- Add order delivery metadata and per-file client portal visibility.
-- Safe additive columns used by OPPS order drawer and the public order tracker.

alter table public.orders
  add column if not exists pep_code text null,
  add column if not exists delivery_note text null,
  add column if not exists portal_visible_file_urls text[] null,
  add column if not exists order_file_folders jsonb not null default '[]'::jsonb;

create index if not exists idx_orders_pep_code on public.orders using btree (pep_code);

