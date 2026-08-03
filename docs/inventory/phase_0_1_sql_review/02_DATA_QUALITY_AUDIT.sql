-- OPPS Inventory Phase 0/1: legacy data-quality audit (READ ONLY).
-- Run manually only after authorization. This script does not repair data.
-- It assumes the tenant migration has added tenant_id to inventory/suppliers/POs.

begin;
set transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

-- 1. Row counts and recorded quantity totals per tenant.
select i.tenant_id,
       t.slug as tenant_slug,
       count(*) as inventory_rows,
       count(*) filter (where coalesce(i.is_archived, false)) as archived_rows,
       sum(coalesce(i.current_stock, 0)) as current_stock_total,
       sum(coalesce(i.current_stock, 0)) filter (where not coalesce(i.is_archived, false)) as active_current_stock_total
from public.inventory i
left join public.tenants t on t.id = i.tenant_id
group by i.tenant_id, t.slug
order by t.slug nulls first;

-- 2. Null tenants and tenant IDs that do not resolve.
select i.*
from public.inventory i
left join public.tenants t on t.id = i.tenant_id
where i.tenant_id is null or t.id is null
order by i.created_at, i.id;

-- 3. Negative stock and null stock.
select tenant_id, id, name, sku, current_stock, unit, is_archived
from public.inventory
where current_stock < 0 or current_stock is null
order by tenant_id, current_stock nulls first, name;

-- 4. Exact and case-insensitive SKU collisions. The checked-in schema currently
-- has global uniqueness, so this report also exposes cross-tenant blocking.
select sku, count(*) as row_count, array_agg(id order by id) as inventory_ids,
       array_agg(distinct tenant_id) as tenant_ids
from public.inventory
where nullif(btrim(sku), '') is not null
group by sku
having count(*) > 1
order by count(*) desc, sku;

select lower(btrim(sku)) as normalized_sku,
       count(*) as row_count,
       array_agg(sku order by sku) as observed_skus,
       array_agg(id order by id) as inventory_ids,
       array_agg(distinct tenant_id) as tenant_ids
from public.inventory
where nullif(btrim(sku), '') is not null
group by lower(btrim(sku))
having count(*) > 1
order by count(*) desc, normalized_sku;

-- 5. Exact normalized-name duplicates per tenant.
select tenant_id,
       lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) as normalized_name,
       count(*) as row_count,
       array_agg(id order by id) as inventory_ids,
       array_agg(name order by name) as observed_names
from public.inventory
group by tenant_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
having count(*) > 1
order by row_count desc, tenant_id, normalized_name;

-- 6. Near-duplicate candidates. This deliberately strips common garment tokens
-- only to propose review groups; it is not safe evidence for an automatic merge.
with normalized as (
  select i.*,
         btrim(regexp_replace(
           lower(i.name),
           '\m(black|white|navy|red|blue|green|grey|gray|small|medium|large|xl|xxl|xxxl|[0-9]{2,3}\s*gsm|[0-9]{2,3}gms)\M',
           ' ', 'g'
         )) as comparison_name
  from public.inventory i
), collapsed as (
  select *, regexp_replace(comparison_name, '[^a-z0-9]+', ' ', 'g') as comparison_key
  from normalized
)
select tenant_id, comparison_key, count(*) as candidate_count,
       array_agg(id order by id) as inventory_ids,
       array_agg(name order by name) as observed_names
from collapsed
where nullif(btrim(comparison_key), '') is not null
group by tenant_id, comparison_key
having count(*) > 1
order by candidate_count desc, tenant_id, comparison_key;

-- 7. Missing suppliers and cross-tenant supplier references. to_jsonb avoids
-- assuming supplier display columns beyond id and tenant_id.
select i.tenant_id as inventory_tenant_id,
       i.id as inventory_id,
       i.name as inventory_name,
       i.preferred_supplier_id,
       s.tenant_id as supplier_tenant_id,
       coalesce(to_jsonb(s)->>'name', to_jsonb(s)->>'vendor') as supplier_name,
       case
         when i.preferred_supplier_id is null then 'missing_reference'
         when s.id is null then 'orphan_reference'
         when s.tenant_id is distinct from i.tenant_id then 'cross_tenant_reference'
       end as issue
from public.inventory i
left join public.suppliers s on s.id = i.preferred_supplier_id
where i.preferred_supplier_id is null
   or s.id is null
   or s.tenant_id is distinct from i.tenant_id
order by i.tenant_id, i.name;

-- 8. Missing/blank locations and missing costs.
select tenant_id, id, name, sku, location, current_stock
from public.inventory
where nullif(btrim(location), '') is null
order by tenant_id, name;

select tenant_id, id, name, sku, cost_price, current_stock
from public.inventory
where cost_price is null
order by tenant_id, name;

-- 9. Reorder-point distribution, including the UI's historical default of 10.
select tenant_id,
       reorder_point,
       count(*) as row_count,
       count(*) filter (where current_stock <= reorder_point) as currently_flagged_low
from public.inventory
group by tenant_id, reorder_point
order by tenant_id, reorder_point nulls first;

select tenant_id, count(*) as rows_using_default_10
from public.inventory
where reorder_point = 10
group by tenant_id
order by tenant_id;

-- 10. Malformed/non-array order and PO line collections.
select 'orders' as source_table, tenant_id, id, 'products' as json_column,
       jsonb_typeof(coalesce(products, 'null'::jsonb)) as observed_type
from public.orders
where products is null or jsonb_typeof(products) <> 'array'
union all
select 'purchase_orders', tenant_id, id, 'items',
       jsonb_typeof(coalesce(items, 'null'::jsonb))
from public.purchase_orders
where items is null or jsonb_typeof(items) <> 'array'
order by source_table, tenant_id, id;

-- 11. Blank optional inventory references are reported separately from malformed
-- nonblank UUIDs. A blank legacy key means "not linked", not malformed data.
with blank_refs as (
  select 'orders'::text as source_table, o.tenant_id
  from public.orders o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o.products) = 'array' then o.products else '[]'::jsonb end
  ) line(value)
  where line.value ? 'inventory_item_id'
    and nullif(btrim(line.value->>'inventory_item_id'), '') is null
  union all
  select 'purchase_orders', po.tenant_id
  from public.purchase_orders po
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end
  ) line(value)
  where line.value ? 'inventory_item_id'
    and nullif(btrim(line.value->>'inventory_item_id'), '') is null
)
select source_table, tenant_id, count(*) as blank_optional_reference_count
from blank_refs
group by source_table, tenant_id
order by source_table, tenant_id;

-- 12. Order JSON inventory references: malformed nonblank UUIDs, missing rows,
-- archived rows, and cross-tenant links. Text is validated before casting.
with order_lines as (
  select o.id as order_id, o.tenant_id, o.order_number, line.ordinality as line_number,
         line.value as line_json, line.value->>'inventory_item_id' as inventory_id_text
  from public.orders o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o.products) = 'array' then o.products else '[]'::jsonb end
  ) with ordinality line(value, ordinality)
  where line.value ? 'inventory_item_id'
    and nullif(btrim(line.value->>'inventory_item_id'), '') is not null
), checked as (
  select *, inventory_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' as uuid_shape
  from order_lines
)
select c.tenant_id as order_tenant_id, c.order_id, c.order_number, c.line_number,
       c.inventory_id_text, i.id as resolved_inventory_id, i.tenant_id as inventory_tenant_id,
       i.is_archived,
       case
         when not c.uuid_shape then 'malformed_uuid'
         when i.id is null then 'missing_inventory'
         when i.tenant_id is distinct from c.tenant_id then 'cross_tenant_reference'
         when coalesce(i.is_archived, false) then 'archived_inventory'
       end as issue
from checked c
left join public.inventory i
  on i.id = case when c.uuid_shape then c.inventory_id_text::uuid else null end
where not c.uuid_shape or i.id is null or i.tenant_id is distinct from c.tenant_id or coalesce(i.is_archived, false)
order by c.tenant_id, c.order_id, c.line_number;

-- 13. Purchase-order JSON inventory references, using the same protections.
with po_lines as (
  select po.id as purchase_order_id, po.tenant_id, po.po_number,
         line.ordinality as line_number, line.value as line_json,
         line.value->>'inventory_item_id' as inventory_id_text
  from public.purchase_orders po
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end
  ) with ordinality line(value, ordinality)
  where line.value ? 'inventory_item_id'
    and nullif(btrim(line.value->>'inventory_item_id'), '') is not null
), checked as (
  select *, inventory_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' as uuid_shape
  from po_lines
)
select c.tenant_id as po_tenant_id, c.purchase_order_id, c.po_number, c.line_number,
       c.inventory_id_text, i.id as resolved_inventory_id, i.tenant_id as inventory_tenant_id,
       i.is_archived,
       case
         when not c.uuid_shape then 'malformed_uuid'
         when i.id is null then 'missing_inventory'
         when i.tenant_id is distinct from c.tenant_id then 'cross_tenant_reference'
         when coalesce(i.is_archived, false) then 'archived_inventory'
       end as issue
from checked c
left join public.inventory i
  on i.id = case when c.uuid_shape then c.inventory_id_text::uuid else null end
where not c.uuid_shape or i.id is null or i.tenant_id is distinct from c.tenant_id or coalesce(i.is_archived, false)
order by c.tenant_id, c.purchase_order_id, c.line_number;

-- 14. Supplier, GSM, colour, and size tokens embedded in legacy names.
select tenant_id, id, name, sku,
       (regexp_match(name, '(?i)\m([0-9]{2,3})\s*(gsm|gms)\M'))[1] as gsm_token,
       (regexp_match(name, '(?i)\m(black|white|navy|red|blue|green|grey|gray|stone|natural|cream)\M'))[1] as colour_token,
       (regexp_match(name, '(?i)\m(xxxl|xxl|xl|xs|small|medium|large|[sml])\M'))[1] as size_token,
       case when name ~* '\m(daniel\s+slaves|supplier|apparel|clothing|blank[s]?)\M' then true else false end as likely_supplier_token
from public.inventory
where name ~* '\m([0-9]{2,3}\s*(gsm|gms)|black|white|navy|red|blue|green|grey|gray|xxxl|xxl|xl|xs|small|medium|large|daniel\s+slaves|supplier|apparel|clothing|blank[s]?)\M'
order by tenant_id, name;

commit;
