alter table public.products
  add column if not exists code text,
  add column if not exists gsm text,
  add column if not exists material text,
  add column if not exists videos jsonb not null default '[]'::jsonb,
  add column if not exists addons jsonb not null default '[]'::jsonb,
  add column if not exists print_options jsonb not null default '[]'::jsonb,
  add column if not exists store_visible boolean not null default true;

create index if not exists idx_products_store_visible
  on public.products(store_visible);
