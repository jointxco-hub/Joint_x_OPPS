-- Public tracker: staff-set order-line thumbnail becomes the primary
-- client-facing image for that exact line, ahead of both the linked
-- Client Product's mockup and the catalogue product's image.
--
-- Root cause (verified directly against production order ORD-MTKNJU7S,
-- not guessed): OPPS's "Set/Change thumbnail" (ProductsEditor.jsx:1174-
-- 1181) writes the chosen file straight into the SAME orders.products[]
-- .image_url field that a line is seeded with at add-time (from the
-- catalogue item's own image via thumbFor(), ProductsEditor.jsx:759-761,
-- or from the Client Product's primary_mockup_url via
-- applyClientProductPickToNewRow(), clientProductPicker.js:107, itself
-- fed by clientProductToPickerItem()'s `image_url: cp.primary_mockup_url
-- || cp.thumbnail_url`, clientProductPicker.js:74). There is no separate
-- "thumbnail" or "primary_image_url" field, no asset id on the line - one
-- field serves as both the inherited default AND the staff override.
-- Confirmed on production: both ORD-MTKNJU7S lines have image_url
-- rewritten to a private-upload:// WhatsApp screenshot staff explicitly
-- attached via Set/Change thumbnail. The previous migration
-- (20260913090000) correctly rejected that private reference as
-- unsafe-to-expose-raw, but then fell through past it entirely to the
-- catalogue image - discarding the deliberate per-order choice staff
-- had just made, exactly the reported regression.
--
-- Fix: a line's own image_url - whenever non-empty, however it got there
-- - is now the FIRST-priority visual for that line, ahead of the Client
-- Product mockup and the catalogue image, which become the fallback
-- chain (used only when the line's own value is empty, or - for a
-- private reference - if it turns out to be unresolvable). Because
-- add-time seeding always copies the current mockup/catalogue image
-- into the line's own image_url (see above), an UNTOUCHED line's own
-- value already equals its fallback tier's value - this reorder changes
-- nothing visible for a never-touched line, and only changes behaviour
-- exactly when staff have deliberately set something different.
--
-- The line's own value reaches the public tracker one of two ways:
--   - already `https://` -> used directly as `image_url`, same as before.
--   - a `private-upload://uploads/...` reference (the only bucket the
--     resolver signs, exactly matching resolve-public-tracker-file-url's
--     existing SIGNABLE_BUCKETS allowlist) -> exposed ONLY as an opaque
--     `thumbnail_ref` string (never resolved server-side into a URL
--     here), alongside the line's own `line_id` so the frontend can ask
--     the (now extended) resolve-public-tracker-file-url edge function to
--     verify + sign it - re-using the exact security model already
--     proven safe for tracker files: the string alone is non-actionable
--     (the `uploads` bucket is private at the storage-policy level;
--     confirmed empirically for the file feature that anon gets an
--     identical "not_found" for a real vs. a nonexistent object), and a
--     fresh companion RPC (verify_public_tracker_visible_thumbnail_ref)
--     re-checks host->tenant, portal_show_items, and that the reference
--     EXACTLY matches THIS line's CURRENT image_url on every single
--     resolve call - so changing the thumbnail in OPPS invalidates the
--     old reference immediately, with nothing cached.
--   - any other scheme, or empty -> no thumbnail_ref, falls through to
--     the fallback chain below.
--
-- `image_url` always also carries the FALLBACK-safe result (Client
-- Product mockup -> catalogue image, unchanged relative order from
-- 20260913090000) whenever the line's own value is NOT already a
-- directly-usable https URL - so the tracker always has an immediately
-- renderable image while (or if) the explicit thumbnail_ref is being
-- resolved client-side, and never regresses to a placeholder just
-- because resolution hasn't completed yet. `gallery_images` mirrors
-- that same immediately-safe `image_url`, exactly as before - the
-- resolved thumbnail (once fetched client-side) is spliced in by the
-- frontend, not by this projection; a real server-side multi-image
-- gallery remains explicitly out of scope (client_product_artwork is
-- still not joined anywhere in this function).

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
    'portal_show_files', coalesce(o.portal_show_files, false),
    'portal_show_balance', o.portal_show_balance,
    'portal_visible_file_urls', jsonb_build_array(),
    'files', case when coalesce(o.portal_show_files, false) then (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'name', coalesce(
            nullif(regexp_replace(regexp_replace(url, '^.*/', ''), '^[0-9]+-[a-zA-Z0-9]+-', ''), ''),
            regexp_replace(url, '^.*/', '')
          ),
          'file_ref', url,
          'file_type', case when url ~ '\.[a-zA-Z0-9]{2,5}$' then lower(regexp_replace(url, '^.*\.', '')) else null end
        )
        order by ord
      ), '[]'::jsonb)
      from unnest(o.portal_visible_file_urls) with ordinality as t(url, ord)
      where url is not null and btrim(url) <> ''
    ) else '[]'::jsonb end,
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
          'thumbnail_ref', resolved.thumbnail_ref,
          'line_id', case when resolved.thumbnail_ref is not null then item ->> 'line_id' else null end,
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
        -- The fallback chain, used whenever the line's own image isn't
        -- already a directly-usable https URL: Client Product mockup,
        -- then the catalogue product's image. Unchanged relative order
        -- from 20260913090000 - only its PRIORITY versus the line's own
        -- image has moved, not its own internal order.
        select case
          when cp_match.primary_mockup_url ~* '^https://' then cp_match.primary_mockup_url
          when catalog_match.image_url ~* '^https://' then catalog_match.image_url
          else null
        end as fallback_image_url
      ) fallback on true
      left join lateral (
        select
          case
            when (item ->> 'image_url') ~* '^https://' then item ->> 'image_url'
            else fallback.fallback_image_url
          end as image_url,
          case
            when (item ->> 'image_url') ~* '^private-upload://uploads/' then item ->> 'image_url'
            else null
          end as thumbnail_ref
      ) resolved on true
      where coalesce(item ->> 'line_role', 'product') <> 'breakdown'
        and nullif(btrim(coalesce(item ->> 'name', '')), '') is not null
    ) else '[]'::jsonb end
  )
  from matched_order o;
$fn$;

grant execute on function public.get_public_order_tracking_for_host(text, text) to anon, authenticated;

-- Narrow authorization check the extended resolve-public-tracker-file-url
-- edge function calls before signing an explicit order-line thumbnail:
-- does this exact reference currently match THIS exact line's CURRENT
-- image_url, for this exact host-resolved tenant, with portal_show_items
-- on. Mirrors verify_public_tracker_visible_file_ref's discipline exactly
-- (re-read fresh on every call, no caching) - changing a line's thumbnail
-- in OPPS invalidates the old reference for future resolves immediately.
create or replace function public.verify_public_tracker_visible_thumbnail_ref(
  p_lookup text,
  p_hostname text,
  p_line_id text,
  p_thumbnail_ref text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  with input as (
    select upper(trim(coalesce(p_lookup, ''))) as raw_lookup,
           btrim(coalesce(p_line_id, '')) as clean_line_id,
           btrim(coalesce(p_thumbnail_ref, '')) as clean_ref
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
  )
  select coalesce(bool_or(true), false)
  from resolved_tenant
  join public.orders o on o.tenant_id = resolved_tenant.tenant_id
  cross join input
  where input.raw_lookup <> ''
    and input.clean_line_id <> ''
    and input.clean_ref <> ''
    and coalesce(o.portal_show_items, false)
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
    and exists (
      select 1
      from jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) item
      where item ->> 'line_id' = input.clean_line_id
        and item ->> 'image_url' = input.clean_ref
        and coalesce(item ->> 'line_role', 'product') <> 'breakdown'
    );
$fn$;

revoke all on function public.verify_public_tracker_visible_thumbnail_ref(text, text, text, text) from public;
grant execute on function public.verify_public_tracker_visible_thumbnail_ref(text, text, text, text) to anon, authenticated;
