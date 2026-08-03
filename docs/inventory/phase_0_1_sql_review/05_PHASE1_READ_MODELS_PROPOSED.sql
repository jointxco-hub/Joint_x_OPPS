-- PROPOSED ONLY - DO NOT RUN WITHOUT THE REVIEW/AUTHORIZATION CHECKLIST.
-- Internal Phase 1 read/search models. None is granted to anon or called by a
-- public storefront RPC. public.inventory is not renamed or replaced.
-- Requires PostgreSQL support for security_invoker views; confirm with 01.

begin;

create view public.inventory_identity_v
with (security_invoker = true)
as
select
  p.tenant_id,
  p.id as inventory_product_id,
  p.internal_code,
  p.internal_short_name,
  p.internal_name,
  p.category,
  p.garment_type,
  p.weight_gsm,
  p.fit,
  p.material,
  p.version as product_version,
  p.is_active as product_is_active,
  v.id as inventory_variant_id,
  v.internal_sku,
  v.colour_code,
  v.colour_name,
  v.size_code,
  v.size_name,
  v.version as variant_version,
  v.is_active as variant_is_active,
  count(sv.id) filter (where sv.is_active) as active_supplier_variant_count,
  count(sv.id) filter (
    where sv.is_active and sp.compatibility_status in ('exact', 'approved_substitute')
  ) as approved_supplier_variant_count
from public.inventory_products p
left join public.inventory_variants v
  on v.tenant_id = p.tenant_id
 and v.inventory_product_id = p.id
left join public.inventory_supplier_variants sv
  on sv.tenant_id = v.tenant_id
 and sv.inventory_variant_id = v.id
left join public.inventory_supplier_products sp
  on sp.tenant_id = sv.tenant_id
 and sp.id = sv.inventory_supplier_product_id
group by p.tenant_id, p.id, v.id;

comment on view public.inventory_identity_v is
  'Internal hierarchy only. Counts exact supplier identities but contains no physical balance.';

create view public.inventory_supplier_mapping_v
with (security_invoker = true)
as
select
  sp.tenant_id,
  p.id as inventory_product_id,
  p.internal_code,
  p.internal_name,
  v.id as inventory_variant_id,
  v.internal_sku,
  v.colour_name as internal_colour_name,
  v.size_name as internal_size_name,
  sp.id as inventory_supplier_product_id,
  sp.supplier_id,
  coalesce(to_jsonb(s)->>'name', to_jsonb(s)->>'vendor') as supplier_name,
  sp.official_product_code,
  sp.official_product_name,
  sp.compatibility_status,
  sp.compatibility_notes,
  sp.is_default,
  sv.id as inventory_supplier_variant_id,
  sv.supplier_sku,
  sv.official_colour_name,
  sv.official_size_name,
  sv.supplier_barcode,
  sv.unit_cost,
  sv.currency_code,
  sv.is_active as supplier_variant_is_active
from public.inventory_supplier_products sp
join public.inventory_products p
  on p.tenant_id = sp.tenant_id and p.id = sp.inventory_product_id
join public.suppliers s
  on s.tenant_id = sp.tenant_id and s.id = sp.supplier_id
left join public.inventory_supplier_variants sv
  on sv.tenant_id = sp.tenant_id and sv.inventory_supplier_product_id = sp.id
left join public.inventory_variants v
  on v.tenant_id = sv.tenant_id and v.id = sv.inventory_variant_id;

comment on view public.inventory_supplier_mapping_v is
  'Internal supplier drill-down. Never grant this view to anon or public storefront functions.';

create view public.inventory_legacy_mapping_review_v
with (security_invoker = true)
as
select
  m.*,
  p.internal_code as proposed_internal_code,
  p.internal_name as proposed_internal_name,
  v.internal_sku as proposed_internal_sku,
  v.colour_name as proposed_internal_colour,
  v.size_name as proposed_internal_size,
  sp.official_product_name as proposed_supplier_product_name,
  sp.official_product_code as proposed_supplier_product_code,
  sv.supplier_sku as proposed_supplier_sku,
  sv.official_colour_name as proposed_supplier_colour,
  sv.official_size_name as proposed_supplier_size,
  exists (
    select 1
    from public.orders o
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.products) = 'array' then o.products else '[]'::jsonb end
    ) line(value)
    where o.tenant_id = m.tenant_id
      and not coalesce(o.is_archived, false)
      and line.value->>'inventory_item_id' = m.legacy_inventory_id::text
  ) as referenced_by_active_order,
  exists (
    select 1
    from public.purchase_orders po
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end
    ) line(value)
    where po.tenant_id = m.tenant_id
      and not coalesce(po.is_archived, false)
      and line.value->>'inventory_item_id' = m.legacy_inventory_id::text
  ) as referenced_by_active_purchase_order
from public.inventory_legacy_mappings m
left join public.inventory_products p
  on p.tenant_id = m.tenant_id and p.id = m.proposed_inventory_product_id
left join public.inventory_variants v
  on v.tenant_id = m.tenant_id and v.id = m.proposed_inventory_variant_id
left join public.inventory_supplier_products sp
  on sp.tenant_id = m.tenant_id and sp.id = m.proposed_supplier_product_id
left join public.inventory_supplier_variants sv
  on sv.tenant_id = m.tenant_id and sv.id = m.proposed_supplier_variant_id;

create view public.inventory_legacy_compat_v
with (security_invoker = true)
as
select
  i.id,
  i.tenant_id,
  i.name,
  i.sku,
  i.category,
  i.current_stock,
  i.unit,
  i.reorder_point,
  i.reorder_quantity,
  i.last_reorder_date,
  i.sizes_available,
  i.colors_available,
  i.cost_price,
  i.selling_price,
  i.preferred_supplier_id,
  i.location,
  i.is_archived,
  i.archived_at,
  i.created_at,
  i.updated_at,
  approved.id as approved_mapping_id,
  approved.mapping_version,
  approved.proposed_inventory_product_id,
  approved.proposed_inventory_variant_id,
  approved.proposed_supplier_product_id,
  approved.proposed_supplier_variant_id,
  p.internal_code,
  p.internal_name,
  v.internal_sku,
  sp.official_product_name as supplier_product_name,
  sv.supplier_sku,
  case when approved.id is null then 'unmapped' else 'approved' end as mapping_state
from public.inventory i
left join lateral (
  select m.*
  from public.inventory_legacy_mappings m
  where m.tenant_id = i.tenant_id
    and m.legacy_inventory_id = i.id
    and m.review_status = 'approved'
  order by m.mapping_version desc
  limit 1
) approved on true
left join public.inventory_products p
  on p.tenant_id = approved.tenant_id and p.id = approved.proposed_inventory_product_id
left join public.inventory_variants v
  on v.tenant_id = approved.tenant_id and v.id = approved.proposed_inventory_variant_id
left join public.inventory_supplier_products sp
  on sp.tenant_id = approved.tenant_id and sp.id = approved.proposed_supplier_product_id
left join public.inventory_supplier_variants sv
  on sv.tenant_id = approved.tenant_id and sv.id = approved.proposed_supplier_variant_id;

comment on view public.inventory_legacy_compat_v is
  'Read-only comparison projection. It does not replace public.inventory and current_stock remains sourced from that legacy table.';

-- Search returns one result per matched field, so callers can state exactly why
-- JET, Daniel Slaves, GSM, colour, size, internal SKU, or supplier SKU matched.
create or replace function public.search_inventory_phase1(
  p_tenant_id uuid,
  p_query text,
  p_limit integer default 100
)
returns table (
  entity_type text,
  entity_id uuid,
  inventory_product_id uuid,
  inventory_variant_id uuid,
  inventory_supplier_product_id uuid,
  inventory_supplier_variant_id uuid,
  primary_label text,
  secondary_label text,
  matched_field text,
  matched_value text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with input as (
    select nullif(btrim(p_query), '') as q,
           least(greatest(coalesce(p_limit, 100), 1), 200) as result_limit
  ), candidates as (
    select 'internal_product'::text, p.id, p.id, null::uuid, null::uuid, null::uuid,
           p.internal_code || ' - ' || p.internal_name, null::text,
           match.field_name, match.field_value
    from public.inventory_products p
    cross join lateral (values
      ('internal_code', p.internal_code),
      ('internal_name', p.internal_name),
      ('internal_short_name', p.internal_short_name),
      ('gsm', case when p.weight_gsm is null then null else trim(to_char(p.weight_gsm, 'FM999999990D99')) || 'gsm' end),
      ('material', p.material)
    ) match(field_name, field_value)
    cross join input
    where p.tenant_id = p_tenant_id and input.q is not null and match.field_value ilike '%' || input.q || '%'

    union all
    select 'internal_variant', v.id, p.id, v.id, null::uuid, null::uuid,
           p.internal_code || ' - ' || v.colour_name || ' / ' || v.size_name,
           v.internal_sku, match.field_name, match.field_value
    from public.inventory_variants v
    join public.inventory_products p on p.tenant_id = v.tenant_id and p.id = v.inventory_product_id
    cross join lateral (values
      ('internal_sku', v.internal_sku), ('colour', v.colour_name), ('size', v.size_name)
    ) match(field_name, field_value)
    cross join input
    where v.tenant_id = p_tenant_id and input.q is not null and match.field_value ilike '%' || input.q || '%'

    union all
    select 'supplier_product', sp.id, p.id, null::uuid, sp.id, null::uuid,
           sp.official_product_name, p.internal_code,
           match.field_name, match.field_value
    from public.inventory_supplier_products sp
    join public.inventory_products p on p.tenant_id = sp.tenant_id and p.id = sp.inventory_product_id
    join public.suppliers s on s.tenant_id = sp.tenant_id and s.id = sp.supplier_id
    cross join lateral (values
      ('supplier_name', coalesce(to_jsonb(s)->>'name', to_jsonb(s)->>'vendor')),
      ('supplier_product_name', sp.official_product_name),
      ('supplier_product_code', sp.official_product_code),
      ('supplier_product_description', sp.official_description)
    ) match(field_name, field_value)
    cross join input
    where sp.tenant_id = p_tenant_id and input.q is not null and match.field_value ilike '%' || input.q || '%'

    union all
    select 'supplier_variant', sv.id, p.id, v.id, sp.id, sv.id,
           sp.official_product_name || ' - ' || sv.official_colour_name || ' / ' || sv.official_size_name,
           p.internal_code || ' - ' || v.colour_name || ' / ' || v.size_name,
           match.field_name, match.field_value
    from public.inventory_supplier_variants sv
    join public.inventory_supplier_products sp on sp.tenant_id = sv.tenant_id and sp.id = sv.inventory_supplier_product_id
    join public.inventory_products p on p.tenant_id = sp.tenant_id and p.id = sp.inventory_product_id
    join public.inventory_variants v on v.tenant_id = sv.tenant_id and v.id = sv.inventory_variant_id
    cross join lateral (values
      ('supplier_sku', sv.supplier_sku),
      ('supplier_colour', sv.official_colour_name),
      ('supplier_size', sv.official_size_name)
    ) match(field_name, field_value)
    cross join input
    where sv.tenant_id = p_tenant_id and input.q is not null and match.field_value ilike '%' || input.q || '%'
  )
  select * from candidates
  order by primary_label, entity_type, matched_field
  limit (select result_limit from input);
$$;

revoke all on function public.search_inventory_phase1(uuid, text, integer) from public, anon;

revoke all on table public.inventory_identity_v from public, anon, authenticated;
revoke all on table public.inventory_supplier_mapping_v from public, anon, authenticated;
revoke all on table public.inventory_legacy_mapping_review_v from public, anon, authenticated;
revoke all on table public.inventory_legacy_compat_v from public, anon, authenticated;

commit;
