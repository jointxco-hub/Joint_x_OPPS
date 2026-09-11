-- Public tracker: catalogue-product image as the second precedence tier,
-- between the client-product mockup and the order line's own image_url.
--
-- Root cause (verified directly against production order ORD-MTKNJU7S, not
-- guessed from screenshots): OPPS's ProductsEditor.jsx line-thumbnail
-- rendering (both the row list and the compact preview, ~line 2001/2019)
-- shows exactly `item.image_url` -- there is no separate catalogue-image
-- lookup at render time. For a line added FROM the catalogue picker,
-- `thumbFor()` (ProductsEditor.jsx:759-761) seeds that same `image_url`
-- field from the picked catalogue item's own image at add-time. Staff can
-- later use "Set/Change thumbnail" (ProductsEditor.jsx:1174-1181) to
-- OVERWRITE that field with a private, per-order reference photo uploaded
-- to the private `uploads` bucket (private-upload://...) -- exactly what
-- happened on both lines of ORD-MTKNJU7S (confirmed: both image_url values
-- are private-upload:// WhatsApp screenshots). OPPS staff can still see
-- these because OPPS resolves private-upload:// via an authenticated
-- signed-URL call (src/lib/privateFiles.js); the anonymous public tracker
-- correctly cannot and must not, so its existing https-only guard already
-- rejects it -- that part was never a bug. The gap: once a line's own
-- image_url is no longer public-safe, the tracker had no fallback to the
-- SAME catalogue item's own image, which is genuinely public-safe (see
-- below) and often still the best available picture for that exact
-- product.
--
-- public.products (the `CatalogItem` entity, src/api/dataClient.js:1758 --
-- NOT commerce.products, a different, unrelated storefront catalog) is
-- confirmed on production: `image_url` is a real https Supabase Storage
-- URL in the PUBLIC `xlab-assets` bucket (storage.buckets.public = true,
-- verified directly), gated by `store_visible` (boolean, default true) and
-- `status` ('active' for a live product). RLS on this table is
-- staff-only (authenticated + is_opps_staff()), so it needs the same
-- SECURITY DEFINER treatment as client_products already got.
--
-- Precedence is now, in order:
--   1. the linked Client Product's primary_mockup_url (unchanged, from
--      20260912090000)
--   2. the linked catalogue product's (products.id = line.catalog_item_id)
--      own image_url, IF store_visible AND status = 'active' AND the
--      product's own tenant_id matches this order's tenant (no
--      "insert-derived-if-null" caveat applies to this table the way it
--      does to client_products - confirmed no such trigger/comment exists
--      for public.products)
--   3. the order line's own raw image_url (existing behaviour, unchanged)
--   4. omitted entirely (frontend renders a clean placeholder)
-- All three URL sources are re-validated https here, exactly as before.
--
-- Identity is NEVER inferred from product name/category text - only from
-- catalog_item_id -> products.id, exactly the same source-identity
-- discipline as client_product_id -> client_products.id.
--
-- Configured-product semantics (explicitly preserved): a line only reaches
-- tier 2 if tier 1 (its own linked client product) produced no safe image.
-- A custom line (source = 'custom', no catalog_item_id, no
-- client_product_id) never matches either lateral join and falls straight
-- through to its own image_url or the placeholder - no unrelated
-- catalogue/client image is ever substituted for a custom line.

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
          'image_url', resolved.image_url,
          'gallery_images', case
            when resolved.image_url is not null
              then jsonb_build_array(jsonb_build_object(
                     'safe_url', resolved.image_url,
                     'label', null::text,
                     'sort_order', 0
                   ))
            else '[]'::jsonb
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
      left join lateral (
        -- Tier 1: linked Client Product mockup. Both client_products.tenant_id
        -- AND the linked clients.tenant_id must independently agree with this
        -- order's own tenant (see 20260912090000 for why client_products.
        -- tenant_id alone cannot be trusted).
        select cp.primary_mockup_url
        from public.client_products cp
        join public.clients cl on cl.id = cp.client_id
        where (item ->> 'client_product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and cp.id = (item ->> 'client_product_id')::uuid
          and cp.tenant_id = o.tenant_id
          and cl.tenant_id = o.tenant_id
        limit 1
      ) cp_match on true
      left join lateral (
        -- Tier 2: linked catalogue product's own image, only when it is
        -- store-visible, active, and owned by this exact order's tenant.
        select p.image_url
        from public.products p
        where (item ->> 'catalog_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and p.id = (item ->> 'catalog_item_id')::uuid
          and p.tenant_id = o.tenant_id
          and p.store_visible = true
          and p.status = 'active'
        limit 1
      ) catalog_match on true
      left join lateral (
        select case
          when cp_match.primary_mockup_url ~* '^https://' then cp_match.primary_mockup_url
          when catalog_match.image_url ~* '^https://' then catalog_match.image_url
          when (item ->> 'image_url') ~* '^https://' then item ->> 'image_url'
          else null
        end as image_url
      ) resolved on true
      where coalesce(item ->> 'line_role', 'product') <> 'breakdown'
        and nullif(btrim(coalesce(item ->> 'name', '')), '') is not null
    ) else '[]'::jsonb end
  )
  from matched_order o;
$fn$;

grant execute on function public.get_public_order_tracking_for_host(text, text) to anon, authenticated;
