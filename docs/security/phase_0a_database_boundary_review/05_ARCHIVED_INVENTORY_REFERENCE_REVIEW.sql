-- EXECUTED READ-ONLY ON 2026-07-26; redacted conclusion is in file 13.
-- PHASE 0A READ-ONLY REVIEW - DO NOT EXECUTE AGAIN WITHOUT SEPARATE AUTHORIZATION.
-- Returns aliases and field-presence booleans only. It does not expose order
-- numbers, names, SKUs, UUIDs, prices, quantities, or customer details.

begin;
set transaction read only;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

-- A. The affected archived-inventory reference and historical-line evidence.
with order_lines as (
  select o.id as order_id,
         o.tenant_id,
         o.status,
         o.is_archived as order_is_archived,
         o.created_at as order_created_at,
         line.ordinality as line_number,
         line.value as line_json,
         line.value->>'inventory_item_id' as inventory_id_text
  from public.orders o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o.products) = 'array' then o.products else '[]'::jsonb end
  ) with ordinality line(value, ordinality)
  where line.value ? 'inventory_item_id'
    and nullif(btrim(line.value->>'inventory_item_id'), '') is not null
    and (line.value->>'inventory_item_id')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), affected as (
  select ol.*, i.id as inventory_id, i.is_archived as inventory_is_archived,
         i.archived_at as inventory_archived_at
  from order_lines ol
  join public.inventory i on i.id = ol.inventory_id_text::uuid
  where coalesce(i.is_archived, false)
    and i.tenant_id is not distinct from ol.tenant_id
), aliased as (
  select affected.*,
         dense_rank() over (order by order_id) as order_alias_number,
         dense_rank() over (order by inventory_id) as inventory_alias_number
  from affected
)
select 'order_' || order_alias_number as order_alias,
       'inventory_' || inventory_alias_number as inventory_alias,
       line_number,
       case
         when inventory_archived_at is null then 'archive_time_not_recorded'
         when inventory_archived_at <= order_created_at then 'archived_before_order_creation'
         else 'archived_after_order_creation'
       end as archive_timing,
       (not coalesce(order_is_archived, false)
        and lower(coalesce(status, '')) not in ('cancelled', 'delivered'))
         as remains_operationally_active,
       nullif(btrim(coalesce(line_json->>'name', line_json->>'product_name',
                            line_json->>'item_name', '')), '') is not null
         as historical_name_present,
       nullif(btrim(coalesce(line_json->>'size', line_json->>'size_name', '')), '') is not null
         as historical_size_present,
       nullif(btrim(coalesce(line_json->>'colour', line_json->>'color',
                            line_json->>'colour_name', line_json->>'color_name', '')), '') is not null
         as historical_colour_present,
       nullif(btrim(coalesce(line_json->>'quantity', line_json->>'qty', '')), '') is not null
         as historical_quantity_present,
       lower(coalesce(line_json->>'archived_inventory_exception', '')) in ('true', '1', 'yes')
         or nullif(btrim(line_json->>'inventory_exception_reason'), '') is not null
         as explicit_exception_marker_present
from aliased
order by order_alias_number, line_number;

-- B. Keep blank, malformed nonblank, and valid UUID-shaped references separate.
with refs as (
  select 'orders'::text as source_table, line.value->>'inventory_item_id' as reference_text
  from public.orders o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o.products) = 'array' then o.products else '[]'::jsonb end
  ) line(value)
  where line.value ? 'inventory_item_id'
  union all
  select 'purchase_orders', line.value->>'inventory_item_id'
  from public.purchase_orders po
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end
  ) line(value)
  where line.value ? 'inventory_item_id'
)
select source_table,
       case
         when nullif(btrim(reference_text), '') is null then 'blank_optional'
         when reference_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then 'valid_uuid_shape'
         else 'malformed_nonblank'
       end as reference_shape,
       count(*) as line_count
from refs
group by source_table, reference_shape
order by source_table, reference_shape;

commit;

-- Decision guidance:
-- * Preserve an archived item as a valid historical reference when the line
--   snapshot is complete; archiving should block new selection, not erase history.
-- * If the order is still operational and its snapshot is incomplete, require a
--   separately designed exception marker. Do not unarchive or silently relink it.
