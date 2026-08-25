-- Public Storefront Commerce Catalog — Phase 4A foundation.
--
-- Gives any tenant's PUBLIC storefront (no auth.uid(), no membership) a
-- safe, generic, read-only catalog contract backed by
-- commerce.products/commerce.product_variants (XOS 3A/3B) — the same
-- authority get_xos_products_for_host already reads for the AUTHENTICATED
-- XOS admin surface. That RPC cannot be reused directly here: it resolves
-- tenant via resolve_authenticated_tenant_host(), which hard-requires
-- auth.uid() and can_access_tenant() membership - neither exists for a
-- public storefront visitor, and the two contracts must never be
-- conflated (authenticated Products list also legitimately returns
-- non-published state for staff review; the public catalog must not).
--
-- This migration is part of GSB's Commerce authority migration (see
-- local repo docs/GSB_COMMERCE_MIGRATION_PLAN.md) but is deliberately
-- generic - not GSB-specific in any way. No tenant is seeded, activated,
-- or given a storefront domain here. GSB's own workspace/Site Build/
-- Commerce products are untouched by this file.
--
-- =====================================================================
-- Existing pattern reuse (read before writing anything new)
-- =====================================================================
--
-- public.resolve_public_storefront_tenant(p_hostname text) ALREADY
-- EXISTS (202606270008_tenant_storefront_catalog_backend.sql, Phase 5B) -
-- resolves an active public.tenant_domains row with surface='storefront'
-- to (tenant_slug, tenant_name, hostname), already granted to
-- anon/authenticated. It is NOT duplicated or modified here. Its sibling
-- get_storefront_catalog_for_host(...) reads public.products (the OPPS
-- operational table, pre-dating commerce.products entirely) - that is a
-- separate, older storefront pattern (X LAB / demo-xos), untouched here,
-- and explicitly NOT the pattern this migration follows: Commerce
-- product identity, not OPPS operational products, is this contract's
-- authority (see the architectural boundary this whole phase exists to
-- enforce).
--
-- public.resolve_public_tracking_tenant(p_hostname) and
-- public.get_public_order_tracking_for_host(p_lookup, p_hostname)
-- (202606210008_tenant_host_routing.sql / 202606240001_...) establish
-- the exact security shape mirrored below: SECURITY DEFINER, hostname
-- resolved via public.normalize_tenant_hostname + an ACTIVE
-- tenant_domains row of the correct surface + an active tenant, no
-- tenant_id ever accepted as a parameter, granted to anon AND
-- authenticated (a public storefront visitor is not required to be
-- signed in).
--
-- get_xos_products_for_host (20260823111500_xos_3a_products_foundation.sql)
-- establishes the exact safe-field allowlist/variant-lateral-join shape
-- mirrored below, adapted for: (a) status = 'published' only (never
-- draft/archived - the authenticated RPC intentionally allows staff to
-- see non-published state, the public one never may), (b) deterministic
-- name-based ordering with an id tie-breaker instead of created_at desc
-- (a public storefront listing should be alphabetically stable, and
-- get_xos_products_for_host's own created_at-only order is not a unique
-- tie-breaker either - not repeated here).
--
-- =====================================================================
-- Part A — internal tenant resolution for the Commerce catalog
-- =====================================================================
--
-- A new, INTERNAL-only helper - not a second public hostname resolver.
-- It calls the EXISTING resolve_public_storefront_tenant (above) rather
-- than re-deriving its WHERE-clause predicate a second time, then maps
-- the returned tenant_slug back to a tenant_id (slugs are unique
-- tenant-wide throughout this codebase - relied on the same way
-- elsewhere, e.g. Managed Clients' GSB lookups). This is the only place
-- in this migration a real tenant UUID is ever produced from a
-- browser-supplied hostname, and it is never itself exposed to anon/
-- authenticated - only called from within the SECURITY DEFINER catalog
-- RPCs below, which already run as the function owner and so may invoke
-- it regardless of the caller's own grants (the same pattern already
-- proven throughout Phase 2/3's internal `_`-prefixed helpers).
create function public._resolve_public_commerce_tenant(p_hostname text)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select t.id
  from public.resolve_public_storefront_tenant(p_hostname) resolved
  join public.tenants t on t.slug = resolved.tenant_slug
  limit 1;
$$;

revoke all on function public._resolve_public_commerce_tenant(text) from public;
revoke all on function public._resolve_public_commerce_tenant(text) from anon;
revoke all on function public._resolve_public_commerce_tenant(text) from authenticated;

-- =====================================================================
-- Part B/C — shared safe projection (list AND detail call this, so the
-- two can never drift - the exact lesson Phase 3's
-- _compute_managed_site_build_snapshot already established for this
-- codebase). p_slug non-null -> single-product detail lookup (limit 1,
-- ignores p_limit). p_slug null -> list, clamped 1..100.
-- =====================================================================
create function public._public_storefront_products_projection(
  p_tenant_id uuid,
  p_slug text default null,
  p_limit integer default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
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
      'variants', coalesce(v.variants, '[]'::jsonb)
    )
    order by p.name asc, p.id asc
  ), '[]'::jsonb)
  from (
    select *
    from commerce.products
    where tenant_id = p_tenant_id
      and status = 'published'
      and (p_slug is null or slug = p_slug)
    order by name asc, id asc
    limit case
      when p_slug is not null then 1
      else greatest(1, least(coalesce(p_limit, 50), 100))
    end
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
      order by pv.sort_order nulls last, pv.id asc
    ) as variants
    from commerce.product_variants pv
    where pv.product_id = p.id
  ) v on true;
$$;

revoke all on function public._public_storefront_products_projection(uuid, text, integer) from public;
revoke all on function public._public_storefront_products_projection(uuid, text, integer) from anon;
revoke all on function public._public_storefront_products_projection(uuid, text, integer) from authenticated;

-- =====================================================================
-- Public catalog list RPC.
-- =====================================================================
create function public.get_public_storefront_products_for_host(
  p_hostname text,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_tenant_id uuid;
  v_products_enabled boolean;
begin
  v_tenant_id := public._resolve_public_commerce_tenant(p_hostname);
  if v_tenant_id is null then
    -- Generic on purpose - never distinguishes "unknown hostname" from
    -- "hostname exists but is pending/disabled/wrong surface" from
    -- "tenant itself is inactive". Matches the established convention
    -- (get_xos_products_for_host's "XOS access denied.").
    raise exception 'Storefront not found.';
  end if;

  select coalesce(enabled, false)
  into v_products_enabled
  from public.tenant_capabilities
  where tenant_id = v_tenant_id
    and capability_key = 'products';

  -- Same generic-message principle as get_xos_products_for_host: whether
  -- the capability is explicitly disabled or was never configured, the
  -- caller sees the same message, and nothing about any OTHER tenant's
  -- capability state is ever revealed.
  if not coalesce(v_products_enabled, false) then
    raise exception 'Storefront catalog is not available.';
  end if;

  return public._public_storefront_products_projection(v_tenant_id, null, p_limit);
end;
$$;

revoke all on function public.get_public_storefront_products_for_host(text, integer) from public;
revoke all on function public.get_public_storefront_products_for_host(text, integer) from anon;
revoke all on function public.get_public_storefront_products_for_host(text, integer) from authenticated;
grant execute on function public.get_public_storefront_products_for_host(text, integer) to anon;
grant execute on function public.get_public_storefront_products_for_host(text, integer) to authenticated;

-- =====================================================================
-- Public product detail RPC - same hostname resolution, same capability
-- check, same published-only/safe-field projection as the list RPC
-- above (both call the identical shared helper), so a product reachable
-- from the list is guaranteed reachable by slug here too, and never the
-- reverse.
-- =====================================================================
create function public.get_public_storefront_product_for_host(
  p_hostname text,
  p_slug text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_tenant_id uuid;
  v_products_enabled boolean;
  v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
  v_result jsonb;
begin
  if v_slug is null then
    raise exception 'A product slug is required.';
  end if;

  v_tenant_id := public._resolve_public_commerce_tenant(p_hostname);
  if v_tenant_id is null then
    raise exception 'Storefront not found.';
  end if;

  select coalesce(enabled, false)
  into v_products_enabled
  from public.tenant_capabilities
  where tenant_id = v_tenant_id
    and capability_key = 'products';

  if not coalesce(v_products_enabled, false) then
    raise exception 'Storefront catalog is not available.';
  end if;

  v_result := public._public_storefront_products_projection(v_tenant_id, v_slug, null);

  return case when jsonb_array_length(v_result) > 0 then v_result -> 0 else null end;
end;
$$;

revoke all on function public.get_public_storefront_product_for_host(text, text) from public;
revoke all on function public.get_public_storefront_product_for_host(text, text) from anon;
revoke all on function public.get_public_storefront_product_for_host(text, text) from authenticated;
grant execute on function public.get_public_storefront_product_for_host(text, text) to anon;
grant execute on function public.get_public_storefront_product_for_host(text, text) to authenticated;

-- =====================================================================
-- No table grant changes. commerce.products/commerce.product_variants
-- already have RLS enabled with zero policies and are already revoked
-- from anon/authenticated/public (XOS 3A) - this migration adds no
-- direct table access of any kind, only the two SECURITY DEFINER RPCs
-- and their two internal helpers above. No existing object is altered.
-- =====================================================================
