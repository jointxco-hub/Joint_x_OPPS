-- Phase 1B.2A: order-scoped product line identity backfill.
--
-- Every element of orders.products[] needs a durable line_id uuid - the
-- identity of THAT SPECIFIC LINE INSIDE THAT ORDER, never the catalog
-- product itself (the same catalog_item_id legitimately recurs on several
-- lines of one order - e.g. JET / XS / Black and JET / XL / White). New
-- writes already get line_id from src/lib/orderProductIdentity.js
-- (ProductsEditor.jsx, NewOrderDrawer.jsx, the dataClient.js write
-- boundary, src/api/supabase/orders.ts); this migration only backfills
-- historical rows that predate that.
--
-- This migration modifies ONLY orders.products[].line_id. It never touches
-- opps_invoices, opps_invoice_items, or any other product field (name,
-- size, color, quantity, price, options, addons, notes, catalog/inventory
-- ids). Read the preflight section before touching this file - it exists
-- because a same-order fallback-id collision (two lines sharing one
-- catalog_item_id) or an ambiguous historical invoice mapping must ABORT
-- the whole migration rather than guess, per instructions.
--
-- NOT applied anywhere by this session - file only.
--
-- Rollback: no schema object is created by this migration (see "scratch
-- objects" note below - the one helper this file creates is dropped again
-- before commit). Restoring products to their pre-backfill shape would
-- require a point-in-time restore of the orders table; there is nothing
-- here to "drop".

begin;

-- ═══════════════════════════════════════════════════════════════════
-- 0. Snapshot (used only for the post-backfill invariant checks below -
--    not part of the persisted schema; dropped before commit).
-- ═══════════════════════════════════════════════════════════════════
create temporary table _line_id_backfill_snapshot on commit drop as
select
  id,
  products,
  jsonb_array_length(coalesce(products, '[]'::jsonb)) as product_count
from public.orders;

do $$
declare
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  v_order record;
  v_invoice_item record;
  v_elem jsonb;
  v_idx int;
  v_line_id text;
  v_fallback text;
  v_match_count int;
  v_new_products jsonb;

  v_orders_before int;
  v_orders_after int;
  v_invoices_before int;
  v_invoice_items_before int;
  v_invoices_after int;
  v_invoice_items_after int;
begin
  -- ═════════════════════════════════════════════════════════════════
  -- PREFLIGHT - abort BEFORE updating anything if any condition below
  -- is found. Do not guess ambiguous matches; do not match by name or
  -- position; do not rewrite invoice identity.
  -- ═════════════════════════════════════════════════════════════════

  -- (A) any existing non-empty line_id is not a valid UUID.
  if exists (
    select 1
    from public.orders o,
         jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) elem
    where jsonb_typeof(elem) = 'object'
      and nullif(elem ->> 'line_id', '') is not null
      and (elem ->> 'line_id') !~* v_uuid_re
  ) then
    raise exception using errcode = 'P0001',
      message = 'ORDER_PRODUCT_LINE_ID_BACKFILL_INVALID_EXISTING_LINE_ID';
  end if;

  -- (B) duplicate line_id within the same order. Recurrence of the same
  -- UUID ACROSS different orders is expected (legacy compatibility) and
  -- is intentionally not checked here.
  if exists (
    select 1
    from public.orders o,
         jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) elem
    where jsonb_typeof(elem) = 'object'
      and (elem ->> 'line_id') ~* v_uuid_re
    group by o.id, elem ->> 'line_id'
    having count(*) > 1
  ) then
    raise exception using errcode = 'P0001',
      message = 'ORDER_PRODUCT_LINE_ID_BACKFILL_DUPLICATE_LINE_ID';
  end if;

  -- (C)/(D) every invoice item with a source_order_item_id must map to
  -- EXACTLY ONE current product line inside its source order - via the
  -- same fallback priority orderProductKey() used historically before
  -- line_id existed: product.id, then catalog_item_id, then
  -- inventory_item_id (line_id itself is handled by the "already
  -- satisfied" skip below). Zero matches = unmatched historical source
  -- (D); more than one = ambiguous (C). Neither is guessed - both abort.
  for v_invoice_item in
    select ii.source_order_item_id as source_id, inv.source_order_id as order_id
    from public.opps_invoice_items ii
    join public.opps_invoices inv on inv.id = ii.invoice_id
    where ii.source_order_item_id is not null
      and inv.source_order_id is not null
  loop
    -- Already satisfied: some product line in that order already carries
    -- this exact id as its real line_id (e.g. a previous partial backfill,
    -- or a line manually edited since). Nothing left to reconcile.
    if exists (
      select 1
      from public.orders o,
           jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) elem
      where o.id = v_invoice_item.order_id
        and jsonb_typeof(elem) = 'object'
        and (elem ->> 'line_id') = v_invoice_item.source_id::text
    ) then
      continue;
    end if;

    select count(*) into v_match_count
    from public.orders o,
         jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) elem
    where o.id = v_invoice_item.order_id
      and jsonb_typeof(elem) = 'object'
      and coalesce(
            nullif(elem ->> 'id', ''),
            nullif(elem ->> 'catalog_item_id', ''),
            nullif(elem ->> 'inventory_item_id', '')
          ) = v_invoice_item.source_id::text;

    if v_match_count = 0 then
      raise exception using errcode = 'P0001',
        message = format(
          'ORDER_PRODUCT_LINE_ID_BACKFILL_UNMATCHED_INVOICE_SOURCE: order %s source_order_item_id %s',
          v_invoice_item.order_id, v_invoice_item.source_id
        );
    elsif v_match_count > 1 then
      raise exception using errcode = 'P0001',
        message = format(
          'ORDER_PRODUCT_LINE_ID_BACKFILL_AMBIGUOUS_INVOICE_MAPPING: order %s source_order_item_id %s',
          v_invoice_item.order_id, v_invoice_item.source_id
        );
    end if;

    -- The uniquely-matched product line must not already carry a
    -- DIFFERENT valid line_id - that would mean this invoice's historical
    -- identity can no longer be honoured without silently rewriting it.
    if exists (
      select 1
      from public.orders o,
           jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) elem
      where o.id = v_invoice_item.order_id
        and jsonb_typeof(elem) = 'object'
        and coalesce(
              nullif(elem ->> 'id', ''),
              nullif(elem ->> 'catalog_item_id', ''),
              nullif(elem ->> 'inventory_item_id', '')
            ) = v_invoice_item.source_id::text
        and nullif(elem ->> 'line_id', '') is not null
        and (elem ->> 'line_id') <> v_invoice_item.source_id::text
    ) then
      raise exception using errcode = 'P0001',
        message = format(
          'ORDER_PRODUCT_LINE_ID_BACKFILL_INVOICE_LINKAGE_WOULD_BREAK: order %s source_order_item_id %s',
          v_invoice_item.order_id, v_invoice_item.source_id
        );
    end if;
  end loop;

  -- ═════════════════════════════════════════════════════════════════
  -- BACKFILL
  -- ═════════════════════════════════════════════════════════════════
  select count(*) into v_orders_before from public.orders;
  select count(*) into v_invoices_before from public.opps_invoices;
  select count(*) into v_invoice_items_before from public.opps_invoice_items;

  for v_order in
    select id, products
    from public.orders
    where jsonb_typeof(coalesce(products, '[]'::jsonb)) = 'array'
      and jsonb_array_length(coalesce(products, '[]'::jsonb)) > 0
  loop
    v_new_products := '[]'::jsonb;

    for v_idx in 0 .. jsonb_array_length(v_order.products) - 1 loop
      v_elem := v_order.products -> v_idx;

      -- Non-object entries (malformed legacy data) are left byte-for-byte
      -- untouched - there is no product object here to assign identity to.
      if jsonb_typeof(v_elem) <> 'object' then
        v_new_products := v_new_products || jsonb_build_array(v_elem);
        continue;
      end if;

      v_line_id := nullif(v_elem ->> 'line_id', '');

      if v_line_id is not null and v_line_id ~* v_uuid_re then
        -- Already valid - preserve exactly, no key touched at all.
        v_new_products := v_new_products || jsonb_build_array(v_elem);
        continue;
      end if;

      -- Missing (preflight already guaranteed no invalid non-empty value
      -- reaches this point). Historical-compatibility check: if this
      -- line's old fallback identity is exactly the source_order_item_id
      -- an existing invoice item already relies on for THIS order, reuse
      -- it as line_id so that invoice linkage keeps resolving - the
      -- preflight above already proved this mapping is unique and safe.
      v_fallback := coalesce(
        nullif(v_elem ->> 'id', ''),
        nullif(v_elem ->> 'catalog_item_id', ''),
        nullif(v_elem ->> 'inventory_item_id', '')
      );

      if v_fallback is not null and exists (
        select 1
        from public.opps_invoice_items ii
        join public.opps_invoices inv on inv.id = ii.invoice_id
        where inv.source_order_id = v_order.id
          and ii.source_order_item_id::text = v_fallback
      ) then
        v_line_id := v_fallback;
      else
        v_line_id := gen_random_uuid()::text;
      end if;

      v_new_products := v_new_products || jsonb_build_array(v_elem || jsonb_build_object('line_id', v_line_id));
    end loop;

    update public.orders set products = v_new_products where id = v_order.id;
  end loop;

  -- ═════════════════════════════════════════════════════════════════
  -- POST-BACKFILL INVARIANTS - any failure rolls back the whole migration.
  -- ═════════════════════════════════════════════════════════════════

  -- Every object product row now has a line_id.
  if exists (
    select 1
    from public.orders o,
         jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) elem
    where jsonb_typeof(elem) = 'object'
      and nullif(elem ->> 'line_id', '') is null
  ) then
    raise exception using errcode = 'P0001',
      message = 'ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_MISSING_LINE_ID';
  end if;

  -- Every line_id is UUID-shaped.
  if exists (
    select 1
    from public.orders o,
         jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) elem
    where jsonb_typeof(elem) = 'object'
      and (elem ->> 'line_id') !~* v_uuid_re
  ) then
    raise exception using errcode = 'P0001',
      message = 'ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_INVALID_LINE_ID';
  end if;

  -- No duplicate line_id within any order.
  if exists (
    select 1
    from public.orders o,
         jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) elem
    where jsonb_typeof(elem) = 'object'
    group by o.id, elem ->> 'line_id'
    having count(*) > 1
  ) then
    raise exception using errcode = 'P0001',
      message = 'ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_DUPLICATE_LINE_ID';
  end if;

  -- Every line_id that existed and was valid BEFORE the backfill is
  -- preserved exactly - never regenerated, never dropped.
  if exists (
    select 1
    from _line_id_backfill_snapshot s,
         jsonb_array_elements(coalesce(s.products, '[]'::jsonb)) with ordinality as old_elem(elem, ord)
    where jsonb_typeof(old_elem.elem) = 'object'
      and (old_elem.elem ->> 'line_id') ~* v_uuid_re
      and not exists (
        select 1
        from public.orders o,
             jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) new_elem
        where o.id = s.id
          and jsonb_typeof(new_elem) = 'object'
          and (new_elem ->> 'line_id') = (old_elem.elem ->> 'line_id')
      )
  ) then
    raise exception using errcode = 'P0001',
      message = 'ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_LINE_ID_NOT_PRESERVED';
  end if;

  -- No product business field changed - only the line_id key may differ
  -- between the pre-backfill snapshot and the current state.
  if exists (
    select 1
    from _line_id_backfill_snapshot s
    join public.orders o on o.id = s.id
    where (
      select coalesce(jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'line_id' else e end), '[]'::jsonb)
      from jsonb_array_elements(coalesce(s.products, '[]'::jsonb)) e
    ) is distinct from (
      select coalesce(jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'line_id' else e end), '[]'::jsonb)
      from jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) e
    )
  ) then
    raise exception using errcode = 'P0001',
      message = 'ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_BUSINESS_FIELD_CHANGED';
  end if;

  -- Every currently sourced invoice relationship still resolves to a
  -- product line_id in its source order.
  if exists (
    select 1
    from public.opps_invoice_items ii
    join public.opps_invoices inv on inv.id = ii.invoice_id
    where ii.source_order_item_id is not null
      and inv.source_order_id is not null
      and not exists (
        select 1
        from public.orders o,
             jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) elem
        where o.id = inv.source_order_id
          and jsonb_typeof(elem) = 'object'
          and (elem ->> 'line_id') = ii.source_order_item_id::text
      )
  ) then
    raise exception using errcode = 'P0001',
      message = 'ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_INVOICE_LINKAGE_BROKEN';
  end if;

  -- Product count per order, and order count, unchanged.
  if exists (
    select 1
    from _line_id_backfill_snapshot s
    join public.orders o on o.id = s.id
    where jsonb_array_length(coalesce(o.products, '[]'::jsonb)) <> s.product_count
  ) then
    raise exception using errcode = 'P0001',
      message = 'ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_PRODUCT_COUNT_CHANGED';
  end if;

  select count(*) into v_orders_after from public.orders;
  if v_orders_after <> v_orders_before then
    raise exception using errcode = 'P0001',
      message = 'ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_ORDER_COUNT_CHANGED';
  end if;

  -- Invoice rows themselves were never touched by this migration.
  select count(*) into v_invoices_after from public.opps_invoices;
  select count(*) into v_invoice_items_after from public.opps_invoice_items;
  if v_invoices_after <> v_invoices_before or v_invoice_items_after <> v_invoice_items_before then
    raise exception using errcode = 'P0001',
      message = 'ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_INVOICE_ROWS_CHANGED';
  end if;
end $$;

commit;
