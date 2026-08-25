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
-- operational table, pre-dating commerce.products entirely) - a
-- separate, older storefront pattern (X LAB / demo-xos), and explicitly
-- NOT the pattern this migration follows for Commerce identity. It IS
-- amended further below (Part D) - post-review, not in this original
-- pass - so it can no longer serve a tenant that has opted into
-- Commerce, closing a dual-public-catalog-authority gap; its existing
-- output shape and behavior for every legacy_opps/missing-source tenant
-- is otherwise preserved exactly. See Part D for the full rationale.
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
-- Post-review amendment (dual-authority containment) — Part A.5.
--
-- Review found that public.get_storefront_catalog_for_host (Phase 5B,
-- already anon-granted, reads public.products - the OPPS operational
-- table) resolves ANY active storefront-surface tenant_domains row,
-- with no awareness this migration's Commerce-backed RPCs exist. Once a
-- tenant has an active storefront domain, both the old OPPS-backed
-- catalog and this migration's new Commerce-backed catalog would be
-- simultaneously reachable for it - two public commercial authorities
-- for the same tenant, which is architecturally unacceptable. Commerce
-- must be the ONLY public commercial authority once a tenant has
-- migrated to it.
--
-- public.tenant_capabilities.config (already exists, XOS 3A - generic,
-- capability-scoped jsonb, no schema change needed) gets one new,
-- documented key: storefront_catalog_source, values 'legacy_opps' |
-- 'commerce'. Missing entirely (no tenant_capabilities row, or a row
-- with no such key in config) means 'legacy_opps' - existing Joint X/
-- demo-xos/X LAB storefront behavior must not change merely because
-- this migration is applied. An explicit value outside the two known
-- ones fails closed ('invalid'), never silently falls back to either
-- catalog. "Products capability enabled" (tenant_capabilities.enabled)
-- remains a SEPARATE concern - this helper never reads `enabled`, only
-- `config`, so the two checks can never be conflated by a future caller.
--
-- Both the legacy OPPS RPC and the new Commerce RPCs call this SAME
-- helper, so they cannot interpret source mode differently - the exact
-- drift-prevention lesson already applied to the list/detail projection
-- above. Internal only - revoked from public/anon/authenticated,
-- exactly like _resolve_public_commerce_tenant.
-- =====================================================================
create function public._public_storefront_catalog_source(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select case coalesce(
      (
        select config ->> 'storefront_catalog_source'
        from public.tenant_capabilities
        where tenant_id = p_tenant_id
          and capability_key = 'products'
      ),
      'legacy_opps'
    )
    when 'legacy_opps' then 'legacy_opps'
    when 'commerce' then 'commerce'
    else 'invalid'
  end;
$$;

revoke all on function public._public_storefront_catalog_source(uuid) from public;
revoke all on function public._public_storefront_catalog_source(uuid) from anon;
revoke all on function public._public_storefront_catalog_source(uuid) from authenticated;

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

  -- Post-review (dual-authority containment): serving this tenant's
  -- Commerce catalog requires BOTH the products capability enabled AND
  -- an explicit storefront_catalog_source = 'commerce' opt-in - a
  -- tenant still on legacy_opps (the default), or with an invalid
  -- explicit source value, must never receive Commerce-backed data,
  -- even if Products happens to be enabled for other (e.g. XOS admin)
  -- purposes. Same generic-message principle as get_xos_products_for_host
  -- either way: whether denial is due to capability, source mode, or
  -- both, the caller sees the identical message - source mode is never
  -- revealed publicly.
  if not coalesce(v_products_enabled, false)
     or public._public_storefront_catalog_source(v_tenant_id) <> 'commerce'
  then
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

  -- Same dual-requirement/generic-message rule as the list RPC above -
  -- both call the identical _public_storefront_catalog_source helper.
  if not coalesce(v_products_enabled, false)
     or public._public_storefront_catalog_source(v_tenant_id) <> 'commerce'
  then
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
-- Post-review amendment — Part D: OLD OPPS RPC containment.
--
-- public.get_storefront_catalog_for_host(text, integer) (Phase 5B,
-- 202606270008_tenant_storefront_catalog_backend.sql) already resolves
-- ANY active storefront-surface tenant_domains row and reads
-- public.products (OPPS), already granted to anon. Left unmodified, it
-- would remain reachable for a tenant that has since opted into
-- Commerce as its catalog source - two public commercial authorities
-- simultaneously serving the same tenant. This CREATE OR REPLACE closes
-- that gap. It does NOT touch the original migration file
-- (202606270008_...) - production migration history stays immutable;
-- this later migration is what actually changes the live function
-- definition, the normal way a Postgres function is amended.
--
-- Preserved EXACTLY, byte-for-byte, for every legacy_opps/missing-source
-- tenant (this covers demo.xlab.jointx.co.za and xlab.jointx.co.za today
-- - read-only production preflight confirmed both are the only active
-- storefront-domain tenants and neither has opted into Commerce):
--   - the tenant resolution predicate (same WHERE clause, unchanged)
--   - an unresolved hostname returns '[]'::jsonb (never an exception -
--     matches the original plain-SQL function's behavior exactly, since
--     an unmatched CTE join naturally aggregates to zero rows)
--   - the entire product/jsonb-shape query for public.products, field
--     for field, condition for condition, ordering for ordering -
--     nothing about the legacy payload shape changes in this amendment
--   - the p_limit clamping (least(greatest(coalesce(p_limit, 100), 1), 100))
--
-- New behavior, gated by the SAME _public_storefront_catalog_source
-- helper the new Commerce RPCs use (so old and new can never interpret
-- source mode differently): once a tenant's source resolves to anything
-- other than 'legacy_opps' (i.e. 'commerce', or 'invalid' from an
-- unrecognized explicit value), this function now REFUSES to serve
-- public.products for it - a generic exception, the exact same message
-- string the new Commerce RPCs use for their own denial, so neither
-- system's error ever reveals which catalog boundary was actually hit
-- or what source mode a tenant is on. Language changed from `sql` to
-- `plpgsql` (required for the conditional raise) - the query itself is
-- otherwise identical.
-- =====================================================================
create or replace function public.get_storefront_catalog_for_host(
  p_hostname text,
  p_limit int default 100
)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_tenant_id uuid;
  v_source text;
  v_result jsonb;
begin
  select tenant.id
  into v_tenant_id
  from public.tenant_domains domain_row
  join public.tenants tenant on tenant.id = domain_row.tenant_id
  where domain_row.hostname = public.normalize_tenant_hostname(p_hostname)
    and domain_row.surface = 'storefront'
    and domain_row.status = 'active'
    and tenant.status = 'active'
  limit 1;

  if v_tenant_id is null then
    return '[]'::jsonb;
  end if;

  v_source := public._public_storefront_catalog_source(v_tenant_id);
  if v_source <> 'legacy_opps' then
    raise exception 'Storefront catalog is not available.';
  end if;

  with limit_input as (
    select least(greatest(coalesce(p_limit, 100), 1), 100) as row_limit
  ),
  storefront_products as (
    select p.*
    from public.products p
    where p.tenant_id = v_tenant_id
      and coalesce(p.is_archived, false) = false
      and coalesce(p.store_visible, true) = true
      and lower(coalesce(p.status, 'active')) in ('active', 'published')
    order by coalesce(p.display_order, 2147483647), lower(p.name), p.created_at desc
    limit (select row_limit from limit_input)
  )
  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', product_row.id,
      'name', product_row.name,
      'description', product_row.description,
      'category', product_row.category,
      'price', product_row.price,
      'image_url',
        case
          when product_row.image_url ilike 'private-upload://%' then null
          when product_row.image_url ilike '%/storage/v1/object/sign/uploads/%' then null
          else product_row.image_url
        end,
      'images',
        coalesce((
          select jsonb_agg(image_item.value)
          from jsonb_array_elements(coalesce(product_row.images, '[]'::jsonb)) as image_item(value)
          where image_item.value::text not ilike '%private-upload://%'
            and image_item.value::text not ilike '%/storage/v1/object/sign/uploads/%'
        ), '[]'::jsonb),
      'code', product_row.code,
      'gsm', product_row.gsm,
      'material', product_row.material,
      'videos', coalesce(product_row.videos, '[]'::jsonb),
      'addons',
        coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'name', addon_item.value->>'name',
            'price',
              case
                when (addon_item.value->>'price') ~ '^-?[0-9]+(\.[0-9]+)?$'
                  then (addon_item.value->>'price')::numeric
                else null
              end
          )))
          from jsonb_array_elements(coalesce(product_row.addons, '[]'::jsonb)) as addon_item(value)
          where addon_item.value ? 'name'
        ), '[]'::jsonb),
      'print_options',
        coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'name', print_item.value->>'name',
            'type', print_item.value->>'type',
            'price',
              case
                when (print_item.value->>'price') ~ '^-?[0-9]+(\.[0-9]+)?$'
                  then (print_item.value->>'price')::numeric
                else null
              end,
            'locations', coalesce(print_item.value->'locations', '[]'::jsonb)
          )))
          from jsonb_array_elements(coalesce(product_row.print_options, '[]'::jsonb)) as print_item(value)
          where print_item.value ? 'name'
        ), '[]'::jsonb),
      'display_order', product_row.display_order
    ))
  ), '[]'::jsonb)
  into v_result
  from storefront_products product_row;

  return v_result;
end;
$$;

-- Grants unchanged from the original migration - still anon +
-- authenticated, still the same function identity (text, int). Restated
-- explicitly (not merely inherited) so this migration's own grant intent
-- is self-contained and auditable without needing to cross-reference
-- 202606270008_....
revoke all on function public.get_storefront_catalog_for_host(text, int) from public;
grant execute on function public.get_storefront_catalog_for_host(text, int) to anon, authenticated;

-- =====================================================================
-- No table grant changes. commerce.products/commerce.product_variants
-- already have RLS enabled with zero policies and are already revoked
-- from anon/authenticated/public (XOS 3A) - this migration adds no
-- direct table access of any kind, only the two SECURITY DEFINER RPCs
-- and their two internal helpers above. No existing object is altered.
-- =====================================================================
