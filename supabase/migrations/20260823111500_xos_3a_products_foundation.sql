-- XOS 3A — Product Authority Foundation.
--
-- Introduces a generic, tenant-scoped commerce product contract for XOS,
-- deliberately separate from public.client_products (the existing
-- managed/B2B/client-approval product system: xlab_product_id/
-- opps_product_id linkage, print_method/placement/garment_* production
-- fields, requires_quote, internal_notes, approved_by/approved_at
-- approval workflow). client_products models Joint X producing a custom
-- item for one client with staff approval at every step - it has no
-- concept of a client-browsable catalog, availability, or per-tenant
-- publish state, and retrofitting those onto it would conflate two
-- different authority models. XOS 3A's commerce.products is additive,
-- capability-gated, and fully reversible (drop the two new functions,
-- the two commerce tables and their schema, and tenant_capabilities -
-- nothing else references them yet).
--
-- Full detail: docs/XOS_3A_PRODUCTS_FOUNDATION.md

-- =====================================================================
-- 1. commerce schema - never exposed to PostgREST (not in the exposed
--    schema list), and explicitly locked down at the grant level too as
--    defense in depth, matching the XOS 2.5 lesson that a fresh CREATE
--    can silently grant PUBLIC access unless revoked explicitly.
-- =====================================================================

create schema if not exists commerce;

revoke all on schema commerce from public;
revoke all on schema commerce from anon;
revoke all on schema commerce from authenticated;

-- =====================================================================
-- 2. commerce.products
-- =====================================================================

create table commerce.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  slug text not null,
  name text not null,
  description text,
  price numeric,
  sale_price numeric,
  currency text not null default 'ZAR',
  primary_image_url text,
  availability text not null default 'available',
  status text not null default 'draft',
  source_system text,
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_products_status_check
    check (status in ('draft', 'published', 'archived')),
  constraint commerce_products_availability_check
    check (availability in ('available', 'out_of_stock', 'preorder', 'unavailable')),
  constraint commerce_products_price_nonneg
    check (price is null or price >= 0),
  constraint commerce_products_sale_price_nonneg
    check (sale_price is null or sale_price >= 0),
  constraint commerce_products_sale_price_le_price
    check (sale_price is null or price is null or sale_price <= price),
  constraint commerce_products_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint commerce_products_tenant_slug_unique
    unique (tenant_id, slug)
);

-- tenant/source identity uniqueness only where a source identity actually
-- exists - manually-created products (source_ref null) never collide.
create unique index commerce_products_tenant_source_ref_unique
  on commerce.products (tenant_id, source_system, source_ref)
  where source_ref is not null;

create index commerce_products_tenant_status_idx
  on commerce.products (tenant_id, status);

alter table commerce.products enable row level security;
-- No policies defined - RLS enabled with zero policies is a hard default
-- deny for every role except the table owner. This table is only ever
-- read/written through SECURITY DEFINER RPCs (which execute as the
-- function owner and bypass RLS), never directly.

revoke all on commerce.products from public;
revoke all on commerce.products from anon;
revoke all on commerce.products from authenticated;

create trigger commerce_products_set_updated_at
  before update on commerce.products
  for each row execute function public.update_updated_at();

-- =====================================================================
-- 3. commerce.product_variants
-- =====================================================================

create table commerce.product_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references commerce.products(id) on delete cascade,
  sku text,
  title text,
  size text,
  color text,
  price_override numeric,
  availability text not null default 'available',
  sort_order integer not null default 0,
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_variants_availability_check
    check (availability in ('available', 'out_of_stock', 'preorder', 'unavailable')),
  constraint commerce_variants_price_override_nonneg
    check (price_override is null or price_override >= 0)
);

create index commerce_variants_product_idx
  on commerce.product_variants (product_id);
create index commerce_variants_tenant_idx
  on commerce.product_variants (tenant_id);

alter table commerce.product_variants enable row level security;
-- Same "RLS enabled, zero policies, SECURITY DEFINER RPCs only" pattern
-- as commerce.products.

revoke all on commerce.product_variants from public;
revoke all on commerce.product_variants from anon;
revoke all on commerce.product_variants from authenticated;

-- A variant's tenant_id must never be able to disagree with its parent
-- product's tenant - rather than validate-and-reject an input value,
-- this derives tenant_id server-side from the parent product on every
-- insert/product_id change, so the mismatched state is structurally
-- impossible rather than merely checked for.
create function commerce.sync_variant_tenant_id()
returns trigger
language plpgsql
as $function$
declare
  v_product_tenant uuid;
begin
  select tenant_id into v_product_tenant
  from commerce.products
  where id = new.product_id;

  if v_product_tenant is null then
    raise exception 'commerce.product_variants.product_id must reference an existing product.';
  end if;

  new.tenant_id := v_product_tenant;
  return new;
end;
$function$;

create trigger commerce_product_variants_sync_tenant
  before insert or update of product_id on commerce.product_variants
  for each row execute function commerce.sync_variant_tenant_id();

create trigger commerce_product_variants_set_updated_at
  before update on commerce.product_variants
  for each row execute function public.update_updated_at();

-- =====================================================================
-- 4. public.tenant_capabilities
-- =====================================================================

create table if not exists public.tenant_capabilities (
  tenant_id uuid not null references public.tenants(id),
  capability_key text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, capability_key)
);

alter table public.tenant_capabilities enable row level security;
-- No policies - no direct client CRUD, only through
-- get_xos_capabilities_for_host (read) and a future explicit internal
-- admin path (not built in this phase) for writes.

-- public schema tables ARE reachable via PostgREST when grants exist
-- (unlike the commerce schema, which isn't in the exposed schema list at
-- all) - revoke explicitly rather than assume this is safe by default.
revoke all on public.tenant_capabilities from public;
revoke all on public.tenant_capabilities from anon;
revoke all on public.tenant_capabilities from authenticated;

create trigger tenant_capabilities_set_updated_at
  before update on public.tenant_capabilities
  for each row execute function public.update_updated_at();

-- =====================================================================
-- 5. get_xos_capabilities_for_host(p_hostname) - authenticated only
-- =====================================================================

create function public.get_xos_capabilities_for_host(p_hostname text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  resolved_tenant_id uuid;
  result jsonb;
begin
  select tenant_id
  into resolved_tenant_id
  from public.resolve_authenticated_tenant_host(p_hostname, 'xos_admin')
  limit 1;

  if resolved_tenant_id is null then
    raise exception 'XOS access denied.';
  end if;

  -- Only enabled capabilities are returned as keys at all - a disabled or
  -- missing capability simply has no entry, so the frontend can gate
  -- purely on key presence without distinguishing "disabled" from
  -- "never configured".
  select coalesce(
    jsonb_object_agg(tc.capability_key, jsonb_build_object('enabled', tc.enabled, 'config', tc.config)),
    '{}'::jsonb
  )
  into result
  from public.tenant_capabilities tc
  where tc.tenant_id = resolved_tenant_id
    and tc.enabled = true;

  return result;
end;
$function$;

revoke all on function public.get_xos_capabilities_for_host(text) from public;
revoke all on function public.get_xos_capabilities_for_host(text) from anon;
grant execute on function public.get_xos_capabilities_for_host(text) to authenticated;

-- =====================================================================
-- 6. get_xos_products_for_host(p_hostname, p_limit) - authenticated only
-- =====================================================================

create function public.get_xos_products_for_host(p_hostname text, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  resolved_tenant_id uuid;
  products_enabled boolean;
  safe_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  result jsonb;
begin
  select tenant_id
  into resolved_tenant_id
  from public.resolve_authenticated_tenant_host(p_hostname, 'xos_admin')
  limit 1;

  if resolved_tenant_id is null then
    raise exception 'XOS access denied.';
  end if;

  select coalesce(tc.enabled, false)
  into products_enabled
  from public.tenant_capabilities tc
  where tc.tenant_id = resolved_tenant_id
    and tc.capability_key = 'products';

  -- Generic message either way (capability disabled vs never configured)
  -- - never distinguishes the two, and never reveals anything about any
  -- other tenant's capability state.
  if not coalesce(products_enabled, false) then
    raise exception 'Products are not available for this workspace.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'slug', p.slug,
      'name', p.name,
      'description', p.description,
      'price', p.price,
      'sale_price', p.sale_price,
      'currency', p.currency,
      'primary_image_url', p.primary_image_url,
      'availability', p.availability,
      'status', p.status,
      'variants', coalesce(v.variants, '[]'::jsonb)
    )
    order by p.created_at desc
  ), '[]'::jsonb)
  into result
  from (
    select *
    from commerce.products
    where tenant_id = resolved_tenant_id
      and status <> 'archived'
    order by created_at desc
    limit safe_limit
  ) p
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', pv.id,
        'sku', pv.sku,
        'title', pv.title,
        'size', pv.size,
        'color', pv.color,
        'price_override', pv.price_override,
        'availability', pv.availability,
        'sort_order', pv.sort_order
      )
      order by pv.sort_order, pv.created_at
    ) as variants
    from commerce.product_variants pv
    where pv.product_id = p.id
  ) v on true;

  return result;
end;
$function$;

-- Explicit no-anon, authenticated-only - the exact lesson from XOS 2.5:
-- a fresh CREATE FUNCTION on this project auto-grants EXECUTE to PUBLIC,
-- which anon/authenticated both inherit unless revoked from PUBLIC
-- specifically (revoking only from the named roles is not sufficient).
revoke all on function public.get_xos_products_for_host(text, integer) from public;
revoke all on function public.get_xos_products_for_host(text, integer) from anon;
grant execute on function public.get_xos_products_for_host(text, integer) to authenticated;

-- =====================================================================
-- Post-apply verification (run manually, not part of this script):
--   select has_function_privilege('anon', 'public.get_xos_capabilities_for_host(text)', 'EXECUTE'); -- expect false
--   select has_function_privilege('anon', 'public.get_xos_products_for_host(text,integer)', 'EXECUTE'); -- expect false
--   select has_table_privilege('anon', 'commerce.products', 'SELECT'); -- expect false
--   select has_table_privilege('authenticated', 'commerce.products', 'SELECT'); -- expect false
--   select has_table_privilege('authenticated', 'public.tenant_capabilities', 'SELECT'); -- expect false
-- =====================================================================
