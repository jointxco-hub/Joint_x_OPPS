-- PROPOSED ONLY - DO NOT RUN WITHOUT THE REVIEW/AUTHORIZATION CHECKLIST.
-- Additive Phase 1 identity foundation. This file does not alter public.inventory,
-- current_stock, orders, balances, movements, reservations, or allocations.

begin;

create or replace function public.inventory_phase1_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.inventory_phase1_touch_updated_at() from public, anon, authenticated;

create table public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  internal_code text not null,
  internal_short_name text,
  internal_name text not null,
  internal_description text,
  category text,
  garment_type text,
  weight_gsm numeric(8, 2),
  fit text,
  material text,
  neck_style text,
  sleeve_type text,
  garment_cut text,
  compatibility jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_products_tenant_id_id_key unique (tenant_id, id),
  constraint inventory_products_internal_code_not_blank check (btrim(internal_code) <> ''),
  constraint inventory_products_internal_name_not_blank check (btrim(internal_name) <> ''),
  constraint inventory_products_weight_positive check (weight_gsm is null or weight_gsm > 0),
  constraint inventory_products_version_positive check (version > 0),
  constraint inventory_products_compatibility_object check (jsonb_typeof(compatibility) = 'object')
);

comment on table public.inventory_products is
  'Stable tenant-scoped Joint X product classes such as JET. Never stores physical quantity or balance.';
comment on column public.inventory_products.internal_code is
  'Permanent Joint X operational code. Supplier discontinuation must not rename this code.';

create unique index inventory_products_tenant_internal_code_uq
  on public.inventory_products (tenant_id, lower(btrim(internal_code)));
create index inventory_products_tenant_name_idx
  on public.inventory_products (tenant_id, lower(internal_name));
create index inventory_products_tenant_category_idx
  on public.inventory_products (tenant_id, category) where is_active;

create trigger inventory_products_touch_updated_at
before update on public.inventory_products
for each row execute function public.inventory_phase1_touch_updated_at();

create table public.inventory_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  inventory_product_id uuid not null,
  internal_sku text not null,
  colour_code text,
  colour_name text not null,
  size_code text,
  size_name text not null,
  internal_barcode text,
  version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_variants_tenant_id_id_key unique (tenant_id, id),
  constraint inventory_variants_product_tenant_fk
    foreign key (tenant_id, inventory_product_id)
    references public.inventory_products (tenant_id, id)
    on delete restrict,
  constraint inventory_variants_internal_sku_not_blank check (btrim(internal_sku) <> ''),
  constraint inventory_variants_colour_not_blank check (btrim(colour_name) <> ''),
  constraint inventory_variants_size_not_blank check (btrim(size_name) <> ''),
  constraint inventory_variants_version_positive check (version > 0)
);

comment on table public.inventory_variants is
  'Canonical internal colour/size requirements requested by orders. Never stores physical quantity or balance.';
comment on column public.inventory_variants.internal_sku is
  'Joint X-owned SKU, distinct in meaning and storage from a supplier SKU.';

create unique index inventory_variants_tenant_internal_sku_uq
  on public.inventory_variants (tenant_id, lower(btrim(internal_sku)));
create unique index inventory_variants_product_colour_size_version_uq
  on public.inventory_variants (
    tenant_id,
    inventory_product_id,
    lower(btrim(colour_name)),
    lower(btrim(size_name)),
    version
  );
create unique index inventory_variants_tenant_internal_barcode_uq
  on public.inventory_variants (tenant_id, lower(btrim(internal_barcode)))
  where nullif(btrim(internal_barcode), '') is not null;
create index inventory_variants_product_idx
  on public.inventory_variants (tenant_id, inventory_product_id, is_active);

create trigger inventory_variants_touch_updated_at
before update on public.inventory_variants
for each row execute function public.inventory_phase1_touch_updated_at();

create table public.inventory_supplier_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  inventory_product_id uuid not null,
  supplier_id uuid not null,
  official_product_code text,
  official_product_name text not null,
  official_description text,
  reference_url text,
  lead_time_days integer,
  compatibility_status text not null default 'pending_review',
  compatibility_notes text,
  specification_snapshot jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_supplier_products_tenant_id_id_key unique (tenant_id, id),
  constraint inventory_supplier_products_internal_product_tenant_fk
    foreign key (tenant_id, inventory_product_id)
    references public.inventory_products (tenant_id, id)
    on delete restrict,
  constraint inventory_supplier_products_name_not_blank check (btrim(official_product_name) <> ''),
  constraint inventory_supplier_products_lead_time_nonnegative check (lead_time_days is null or lead_time_days >= 0),
  constraint inventory_supplier_products_compatibility_status_check check (
    compatibility_status in ('pending_review', 'exact', 'approved_substitute', 'conditional', 'not_approved')
  ),
  constraint inventory_supplier_products_approval_pair check (
    (approved_by is null and approved_at is null)
    or (approved_by is not null and approved_at is not null)
  ),
  constraint inventory_supplier_products_specification_object check (jsonb_typeof(specification_snapshot) = 'object'),
  constraint inventory_supplier_products_version_positive check (version > 0)
);

comment on table public.inventory_supplier_products is
  'Exact supplier commercial products mapped to a Joint X product class. Mapping does not imply automatic substitution.';
comment on column public.inventory_supplier_products.supplier_id is
  'Tenant equality with public.suppliers is enforced by inventory_phase1_validate_supplier_product().';

create unique index inventory_supplier_products_supplier_code_uq
  on public.inventory_supplier_products (tenant_id, supplier_id, lower(btrim(official_product_code)), version)
  where nullif(btrim(official_product_code), '') is not null;
create index inventory_supplier_products_internal_product_idx
  on public.inventory_supplier_products (tenant_id, inventory_product_id, compatibility_status, is_active);
create index inventory_supplier_products_supplier_idx
  on public.inventory_supplier_products (tenant_id, supplier_id, is_active);
create unique index inventory_supplier_products_one_default_idx
  on public.inventory_supplier_products (tenant_id, inventory_product_id)
  where is_default and is_active;

create or replace function public.inventory_phase1_validate_supplier_product()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_supplier_tenant_id uuid;
begin
  select s.tenant_id
    into v_supplier_tenant_id
  from public.suppliers s
  where s.id = new.supplier_id;

  if not found then
    raise exception 'Supplier % does not exist.', new.supplier_id using errcode = '23503';
  end if;
  if v_supplier_tenant_id is null or v_supplier_tenant_id <> new.tenant_id then
    raise exception 'Supplier and supplier product must belong to the same tenant.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.inventory_phase1_validate_supplier_product() from public, anon, authenticated;

create trigger inventory_supplier_products_validate_tenant
before insert or update of tenant_id, supplier_id
on public.inventory_supplier_products
for each row execute function public.inventory_phase1_validate_supplier_product();

create trigger inventory_supplier_products_touch_updated_at
before update on public.inventory_supplier_products
for each row execute function public.inventory_phase1_touch_updated_at();

create table public.inventory_supplier_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  inventory_supplier_product_id uuid not null,
  inventory_variant_id uuid not null,
  supplier_sku text not null,
  official_colour_name text not null,
  official_size_name text not null,
  supplier_barcode text,
  unit_cost numeric(14, 4),
  currency_code text not null default 'ZAR',
  version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_supplier_variants_tenant_id_id_key unique (tenant_id, id),
  constraint inventory_supplier_variants_supplier_product_tenant_fk
    foreign key (tenant_id, inventory_supplier_product_id)
    references public.inventory_supplier_products (tenant_id, id)
    on delete restrict,
  constraint inventory_supplier_variants_internal_variant_tenant_fk
    foreign key (tenant_id, inventory_variant_id)
    references public.inventory_variants (tenant_id, id)
    on delete restrict,
  constraint inventory_supplier_variants_sku_not_blank check (btrim(supplier_sku) <> ''),
  constraint inventory_supplier_variants_colour_not_blank check (btrim(official_colour_name) <> ''),
  constraint inventory_supplier_variants_size_not_blank check (btrim(official_size_name) <> ''),
  constraint inventory_supplier_variants_unit_cost_nonnegative check (unit_cost is null or unit_cost >= 0),
  constraint inventory_supplier_variants_currency_code_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint inventory_supplier_variants_version_positive check (version > 0)
);

comment on table public.inventory_supplier_variants is
  'Exact supplier colour/size/SKU identity. This is the future traceable physical-stock identity; Phase 1 adds no balance.';
comment on column public.inventory_supplier_variants.supplier_sku is
  'Supplier-owned SKU. It never replaces inventory_variants.internal_sku.';

create unique index inventory_supplier_variants_supplier_sku_uq
  on public.inventory_supplier_variants (tenant_id, inventory_supplier_product_id, lower(btrim(supplier_sku)), version);
create unique index inventory_supplier_variants_supplier_barcode_uq
  on public.inventory_supplier_variants (tenant_id, lower(btrim(supplier_barcode)))
  where nullif(btrim(supplier_barcode), '') is not null;
create index inventory_supplier_variants_internal_variant_idx
  on public.inventory_supplier_variants (tenant_id, inventory_variant_id, is_active);

create or replace function public.inventory_phase1_validate_supplier_variant()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_supplier_internal_product_id uuid;
  v_variant_internal_product_id uuid;
begin
  select sp.inventory_product_id
    into v_supplier_internal_product_id
  from public.inventory_supplier_products sp
  where sp.tenant_id = new.tenant_id
    and sp.id = new.inventory_supplier_product_id;

  select v.inventory_product_id
    into v_variant_internal_product_id
  from public.inventory_variants v
  where v.tenant_id = new.tenant_id
    and v.id = new.inventory_variant_id;

  if v_supplier_internal_product_id is null or v_variant_internal_product_id is null then
    raise exception 'Supplier product and internal variant must exist in the same tenant.' using errcode = '23503';
  end if;
  if v_supplier_internal_product_id <> v_variant_internal_product_id then
    raise exception 'Supplier variant must map to a variant of the supplier product''s internal product.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.inventory_phase1_validate_supplier_variant() from public, anon, authenticated;

create trigger inventory_supplier_variants_validate_compatibility
before insert or update of tenant_id, inventory_supplier_product_id, inventory_variant_id
on public.inventory_supplier_variants
for each row execute function public.inventory_phase1_validate_supplier_variant();

create trigger inventory_supplier_variants_touch_updated_at
before update on public.inventory_supplier_variants
for each row execute function public.inventory_phase1_touch_updated_at();

-- RLS is enabled immediately; 06_RLS_AND_GRANTS_PROPOSED.sql defines access.
alter table public.inventory_products enable row level security;
alter table public.inventory_variants enable row level security;
alter table public.inventory_supplier_products enable row level security;
alter table public.inventory_supplier_variants enable row level security;

revoke all on table public.inventory_products from public, anon, authenticated;
revoke all on table public.inventory_variants from public, anon, authenticated;
revoke all on table public.inventory_supplier_products from public, anon, authenticated;
revoke all on table public.inventory_supplier_variants from public, anon, authenticated;

commit;
