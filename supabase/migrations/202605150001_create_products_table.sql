create table if not exists public.products (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  category text,
  price numeric,
  image_url text,
  images jsonb,
  status text not null default 'active',
  display_order integer,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;

create policy "Authenticated can select products"
  on public.products for select to authenticated using (true);

create policy "Authenticated can insert products"
  on public.products for insert to authenticated with check (true);

create policy "Authenticated can update products"
  on public.products for update to authenticated using (true);

create policy "Authenticated can delete products"
  on public.products for delete to authenticated using (true);

create or replace function public.update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_updated_at
  before update on public.products
  for each row execute function public.update_updated_at();
