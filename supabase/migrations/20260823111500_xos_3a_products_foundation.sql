-- XOS 3A — Product Authority Foundation.
--
-- Introduces a generic, tenant-wide commercial/B2C catalog contract for
-- XOS, deliberately separate from public.client_products - the existing
-- managed client-account/reorder/approval product layer (xlab_product_id/
-- opps_product_id linkage, visible_in_account, reorder_enabled,
-- client_price, available_variants, primary_mockup, artwork/revision/
-- order-link relationships, print_method/placement/garment_* production
-- fields, requires_quote, internal_notes, approved_by/approved_at
-- approval workflow). client_products already has real client-facing
-- catalog/account concepts (visible_in_account, reorder_enabled) - it is
-- not made the universal Commerce authority not because it lacks those
-- concepts, but because it is client_id-scoped (one client's approved
-- relationship to one product) rather than tenant-wide, and is
-- production/approval-centric, tied to managed Joint X service/product
-- workflows rather than a generic draft/published/archived catalog
-- state. commerce.products is the tenant-wide commercial/B2C catalog
-- authority; client_products remains the managed/B2B layer. This
-- distinction matters because XOS must integrate with X LAB Account, not
-- unknowingly rebuild it - see commerce.product_links below. XOS 3A's
-- commerce.products is additive, capability-gated, and fully reversible
-- (drop the new functions, the three commerce tables and their schema,
-- and tenant_capabilities - nothing else references them yet).
--
-- commerce.product_links is the identity bridge to the rest of the
-- ecosystem (X LAB Account / client_products, OPPS, future adapters) -
-- it references the existing client_products bridge (which itself
-- already carries xlab_product_id/opps_product_id), it does not
-- duplicate it. Internal integration metadata only, never exposed
-- through get_xos_products_for_host or any client-facing RPC.
--
-- Full detail: docs/XOS_3A_PRODUCTS_FOUNDATION.md, "XOS / X LAB / OPPS
-- Interoperability Contract"

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
-- 4. commerce.product_links - identity bridge to the rest of the
--    ecosystem (X LAB Account / client_products, OPPS, and any future
--    adapter), NOT a second inventory/production ledger. Commerce owns
--    commercial/customer-facing identity only; OPPS remains authoritative
--    for production/inventory/supplier/cost data, and client_products
--    remains the existing managed/B2B/client-approval bridge to X LAB and
--    OPPS product identities (xlab_product_id/opps_product_id) - this
--    table does not duplicate that bridge, it references it.
--    Full contract: docs/XOS_3A_PRODUCTS_FOUNDATION.md, "XOS / X LAB /
--    OPPS Interoperability Contract".
-- =====================================================================

create table commerce.product_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  commerce_product_id uuid not null references commerce.products(id) on delete cascade,
  system_key text not null,
  external_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_product_links_system_key_check
    check (system_key in ('client_product', 'opps_product', 'xlab_product', 'legacy_gsb_product')),
  -- One external identity maps to exactly one commerce product within a
  -- given tenant/system boundary - this single constraint both prevents
  -- duplicate mappings (the same external id linked twice) AND prevents
  -- one external record (e.g. one client_products row) from silently
  -- fanning out to multiple commerce products, since (tenant_id,
  -- system_key, external_id) can only ever point at one row.
  constraint commerce_product_links_identity_unique
    unique (tenant_id, system_key, external_id)
);

create index commerce_product_links_product_idx
  on commerce.product_links (commerce_product_id);
create index commerce_product_links_tenant_system_idx
  on commerce.product_links (tenant_id, system_key);

alter table commerce.product_links enable row level security;
-- Same "RLS enabled, zero policies, SECURITY DEFINER RPCs only" pattern
-- as commerce.products/commerce.product_variants. This is internal
-- integration metadata - no browser ever selects a sync target, and it
-- is deliberately never exposed through get_xos_products_for_host or any
-- other client-facing RPC.

revoke all on commerce.product_links from public;
revoke all on commerce.product_links from anon;
revoke all on commerce.product_links from authenticated;

-- Same tenant-forcing pattern as commerce.sync_variant_tenant_id():
-- tenant_id is derived from the parent commerce product, never trusted
-- from input, so a cross-tenant link is structurally impossible on the
-- commerce side regardless of system_key.
--
-- Per-system_key referential/tenant integrity (all internal integrity
-- exceptions below are deliberately generic - this is never client-facing
-- metadata, so the exact failure reason is not worth exposing):
--
-- client_product (the preferred first ecosystem path - see docs): three
-- tenants must agree - commerce.products.tenant_id, client_products.
-- tenant_id, AND the linked clients.tenant_id. client_products' own
-- client_products_set_tenant_id() trigger only *derives* tenant_id when
-- it is null on insert - it never corrects or rejects a caller-supplied
-- value that disagrees with the client's own tenant, so
-- client_products.tenant_id alone cannot be trusted as a stand-in for
-- "the client actually belongs to this tenant." Both the client_product
-- row and its linked client are independently re-resolved and checked
-- here rather than assumed consistent.
--
-- opps_product: public.products.tenant_id is nullable at the schema
-- level but confirmed tenant-scoped in production data - a null or
-- mismatched tenant is rejected, never silently accepted.
--
-- xlab_product: public.xlab_products has no tenant_id column at all - it
-- represents a reusable/shared X LAB catalog identity, not a
-- tenant-scoped record, so only existence is validated, deliberately no
-- tenant equality check (there is no tenant to check against).
--
-- legacy_gsb_product intentionally remains opaque in this phase - its
-- source system is outside this canonical production schema and needs
-- its own adapter contract later; only the structural tenant_id-forcing
-- above applies to it.
create function commerce.sync_product_link_tenant_id()
returns trigger
language plpgsql
as $function$
declare
  v_product_tenant uuid;
  v_client_product_tenant uuid;
  v_client_product_client_id uuid;
  v_client_tenant uuid;
  v_opps_product_tenant uuid;
  v_external_uuid uuid;
begin
  select tenant_id into v_product_tenant
  from commerce.products
  where id = new.commerce_product_id;

  if v_product_tenant is null then
    raise exception 'commerce.product_links.commerce_product_id must reference an existing product.';
  end if;

  new.tenant_id := v_product_tenant;

  if new.system_key = 'client_product' then
    begin
      v_external_uuid := new.external_id::uuid;
    exception when invalid_text_representation then
      raise exception 'commerce.product_links: invalid client_product identity.';
    end;

    select tenant_id, client_id
    into v_client_product_tenant, v_client_product_client_id
    from public.client_products
    where id = v_external_uuid;

    if v_client_product_tenant is null then
      raise exception 'commerce.product_links: client_product identity not found.';
    end if;

    select tenant_id into v_client_tenant
    from public.clients
    where id = v_client_product_client_id;

    if v_client_tenant is null then
      raise exception 'commerce.product_links: linked client not found.';
    end if;

    if v_client_product_tenant <> v_product_tenant or v_client_tenant <> v_product_tenant then
      raise exception 'commerce.product_links: client_product tenant integrity mismatch.';
    end if;

  elsif new.system_key = 'opps_product' then
    begin
      v_external_uuid := new.external_id::uuid;
    exception when invalid_text_representation then
      raise exception 'commerce.product_links: invalid opps_product identity.';
    end;

    select tenant_id into v_opps_product_tenant
    from public.products
    where id = v_external_uuid;

    if v_opps_product_tenant is null or v_opps_product_tenant <> v_product_tenant then
      raise exception 'commerce.product_links: opps_product tenant integrity mismatch.';
    end if;

  elsif new.system_key = 'xlab_product' then
    begin
      v_external_uuid := new.external_id::uuid;
    exception when invalid_text_representation then
      raise exception 'commerce.product_links: invalid xlab_product identity.';
    end;

    if not exists (select 1 from public.xlab_products where id = v_external_uuid) then
      raise exception 'commerce.product_links: xlab_product identity not found.';
    end if;
  end if;

  return new;
end;
$function$;

create trigger commerce_product_links_sync_tenant
  before insert or update of commerce_product_id, system_key, external_id on commerce.product_links
  for each row execute function commerce.sync_product_link_tenant_id();

create trigger commerce_product_links_set_updated_at
  before update on commerce.product_links
  for each row execute function public.update_updated_at();

-- =====================================================================
-- 5. public.tenant_capabilities
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
-- 6. get_xos_capabilities_for_host(p_hostname) - authenticated only
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
-- 7. get_xos_products_for_host(p_hostname, p_limit) - authenticated only
--    (unchanged by the interoperability amendment - product_links is
--    deliberately never referenced here; see requirement G)
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
-- 8. get_xos_product_summary_for_host(p_hostname) - authenticated only
--    Narrow aggregate-only RPC so Overview can show an accurate total
--    without pulling a capped page of product rows just to count them
--    (get_xos_products_for_host is capped defensively - .length on a
--    capped list silently reads as a total once a tenant exceeds the
--    cap, which this RPC exists specifically to avoid).
-- =====================================================================

create function public.get_xos_product_summary_for_host(p_hostname text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  resolved_tenant_id uuid;
  products_enabled boolean;
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

  if not coalesce(products_enabled, false) then
    raise exception 'Products are not available for this workspace.';
  end if;

  select jsonb_build_object(
    'total', count(*) filter (where status <> 'archived'),
    'published', count(*) filter (where status = 'published'),
    'draft', count(*) filter (where status = 'draft'),
    'unavailable', count(*) filter (where status <> 'archived' and availability = 'unavailable')
  )
  into result
  from commerce.products
  where tenant_id = resolved_tenant_id;

  return result;
end;
$function$;

revoke all on function public.get_xos_product_summary_for_host(text) from public;
revoke all on function public.get_xos_product_summary_for_host(text) from anon;
grant execute on function public.get_xos_product_summary_for_host(text) to authenticated;

-- =====================================================================
-- Post-apply verification (run manually, not part of this script):
--   select has_function_privilege('anon', 'public.get_xos_capabilities_for_host(text)', 'EXECUTE'); -- expect false
--   select has_function_privilege('anon', 'public.get_xos_products_for_host(text,integer)', 'EXECUTE'); -- expect false
--   select has_table_privilege('anon', 'commerce.products', 'SELECT'); -- expect false
--   select has_table_privilege('authenticated', 'commerce.products', 'SELECT'); -- expect false
--   select has_table_privilege('authenticated', 'public.tenant_capabilities', 'SELECT'); -- expect false
--   select has_table_privilege('anon', 'commerce.product_links', 'SELECT'); -- expect false
--   select has_table_privilege('authenticated', 'commerce.product_links', 'SELECT'); -- expect false
--   select has_function_privilege('anon', 'public.get_xos_product_summary_for_host(text)', 'EXECUTE'); -- expect false
-- =====================================================================
