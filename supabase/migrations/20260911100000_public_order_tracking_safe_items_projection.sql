-- Public order tracker (/track) — safe, allowlisted client-facing line
-- items for OPPS-created (and X LAB-synced, once mirrored into
-- public.orders by sync-to-opps) orders, gated by the new
-- orders.portal_show_items flag (20260911090000).
--
-- CREATE OR REPLACE public.get_public_order_tracking_for_host — every
-- existing key, and their exact values, from the live definition
-- (202606270001_private_uploads_signed_urls.sql: portal_show_files is
-- hardcoded false, portal_visible_file_urls / invoice_files are hardcoded
-- empty arrays — the private-uploads signed-URL hardening) is PRESERVED
-- BYTE-FOR-BEHAVIOUR. The only change is one new 'items' key.
--
-- Tenant resolution, hostname normalisation, and order matching
-- (order_number / tracking_number / id / invoice_numbers, scoped to
-- resolved_tenant.tenant_id) are UNCHANGED — refactored into a
-- `matched_order` CTE only so the new items projection can read the one
-- matched row once, never to alter which order is found or which tenant
-- it is scoped to. No cross-tenant fallback; no new grant surface.
--
-- 'items' is a HAND-BUILT ALLOWLIST — never orders.products[] itself:
--   product_name   <- item.name (already the client-facing name staff
--                     entered / the picked client product's name, per
--                     applyClientProductPickToNewRow)
--   quantity       <- item.quantity, numeric-guarded, default 1
--   size / color   <- item.size / item.color, blank -> omitted
--   prints         <- [{ print_option_name }] from selected_print_options
--                     + selected_addons, reading ONLY name/label/title —
--                     never their internal `id` (the catalog print-option
--                     id)
--   image_url      <- item.image_url, ONLY when it is already a genuine
--                     https:// URL. OPPS staff-uploaded artwork/mockups
--                     use the PRIVATE `private-upload://` scheme
--                     (202606270001) and are never surfaced here; a
--                     public https thumbnail (e.g. a catalog stock photo)
--                     is safe and passes through unchanged.
--   line_total     <- item.price * item.quantity when both are numeric
--                     (falls back to price alone, else omitted). Matches
--                     the SAME per-unit-price convention used everywhere
--                     else product pricing is displayed in OPPS
--                     (ProductsEditor's productLineTotal and every
--                     invoice/document renderer) — not changed here.
--
-- Excluded from the allowlist by construction (never selected, so never
-- leaked): supplier name/SKU, internal variant/inventory/component ids
-- (catalog_item_id, inventory_item_id, client_product_id,
-- source_component_id, line_id, duplicated_from_line_id), notes,
-- production_instructions, margin/cost/supplier pricing (orders.products[]
-- carries none of these — they live only in product_components /
-- order_line_component_snapshots, never read here), staff notes,
-- source_metadata, price_reviewed, private artwork paths/signed URLs,
-- and any production-only snapshot metadata.
--
-- A line with line_role = 'breakdown' (reserved, non-billable — the
-- composed-pricing informational-only row; see PR #67's audit of the
-- unmerged P1-P6 lineage) is never included, so a future composed-pricing
-- breakdown row can never render as a purchasable item. No such lines
-- exist in production today (P1-P6 not shipped); this is defensive.
--
-- A line with no name is dropped rather than shown as "undefined". A
-- non-numeric quantity/price never raises — it degrades to a safe
-- default / omission, so one malformed line can never break tracking for
-- the whole order.
--
-- Gated by `case when coalesce(o.portal_show_items, false) then (...) else
-- '[]'::jsonb end`, evaluated fresh on every call — toggling the flag off
-- takes effect on the very next tracker load/refresh, with nothing
-- cached. The flag and this function never write to orders.products[].

create or replace function public.get_public_order_tracking_for_host(
  p_lookup text,
  p_hostname text
)
returns jsonb
language sql
security definer
stable
set search_path = public
as $fn$
  with input as (
    select upper(trim(coalesce(p_lookup, ''))) as raw_lookup
  ),
  resolved_tenant as (
    select domain_row.tenant_id
    from public.tenant_domains domain_row
    join public.tenants tenant on tenant.id = domain_row.tenant_id
    where domain_row.hostname = public.normalize_tenant_hostname(p_hostname)
      and domain_row.surface = 'public_tracking'
      and domain_row.status = 'active'
      and tenant.status = 'active'
    limit 1
  ),
  matched_order as (
    select o.*
    from resolved_tenant
    join public.orders o on o.tenant_id = resolved_tenant.tenant_id
    cross join input
    where input.raw_lookup <> ''
      and (
        upper(coalesce(o.order_number, '')) = input.raw_lookup
        or upper(coalesce(o.tracking_number, '')) = input.raw_lookup
        or upper(o.id::text) = input.raw_lookup
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(o.invoice_numbers, '[]'::jsonb)) number
          where upper(number) = input.raw_lookup
        )
      )
    order by o.updated_at desc
    limit 1
  )
  select jsonb_build_object(
    'id', o.id,
    'client_name', o.client_name,
    'order_number', o.order_number,
    'status', o.status,
    'pipeline_stage', o.pipeline_stage,
    'production_method', o.production_method,
    'production_detail_stage', o.production_detail_stage,
    'production_client_update', o.production_client_update,
    'due_date', o.due_date,
    'courier', o.courier,
    'tracking_number', o.tracking_number,
    'pep_code', o.pep_code,
    'portal_message', o.portal_message,
    'portal_attention_items', o.portal_attention_items,
    'portal_show_files', false,
    'portal_show_balance', o.portal_show_balance,
    'portal_visible_file_urls', jsonb_build_array(),
    'invoice_files', jsonb_build_array(),
    'total_amount', o.total_amount,
    'deposit_paid', o.deposit_paid,
    'items', case when coalesce(o.portal_show_items, false) then (
      select coalesce(jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'product_name', nullif(btrim(coalesce(item ->> 'name', '')), ''),
          'quantity', case
            when (item ->> 'quantity') ~ '^[0-9]+(\.[0-9]+)?$' then (item ->> 'quantity')::numeric
            else 1
          end,
          'size', nullif(btrim(coalesce(item ->> 'size', '')), ''),
          'color', nullif(btrim(coalesce(item ->> 'color', '')), ''),
          'prints', (
            select nullif(jsonb_agg(jsonb_build_object('print_option_name', label)), '[]'::jsonb)
            from (
              select distinct coalesce(opt ->> 'name', opt ->> 'label', opt ->> 'title') as label
              from jsonb_array_elements(
                     coalesce(item -> 'selected_print_options', '[]'::jsonb)
                     || coalesce(item -> 'selected_addons', '[]'::jsonb)
                   ) opt
            ) labels
            where label is not null and btrim(label) <> ''
          ),
          'image_url', case
            when (item ->> 'image_url') ~* '^https://' then item ->> 'image_url'
            else null
          end,
          'line_total', case
            when (item ->> 'price') ~ '^[0-9]+(\.[0-9]+)?$'
             and (item ->> 'quantity') ~ '^[0-9]+(\.[0-9]+)?$'
              then round((item ->> 'price')::numeric * (item ->> 'quantity')::numeric, 2)
            when (item ->> 'price') ~ '^[0-9]+(\.[0-9]+)?$'
              then round((item ->> 'price')::numeric, 2)
            else null
          end
        ))
        order by ord
      ), '[]'::jsonb)
      from jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) with ordinality as t(item, ord)
      where coalesce(item ->> 'line_role', 'product') <> 'breakdown'
        and nullif(btrim(coalesce(item ->> 'name', '')), '') is not null
    ) else '[]'::jsonb end
  )
  from matched_order o;
$fn$;

grant execute on function public.get_public_order_tracking_for_host(text, text) to anon, authenticated;
