-- MULTI-PICTURE PRODUCT ITEM LINE — surface a real multi-image gallery
-- on the public tracker instead of the always-0-or-1-entry placeholder.
--
-- Audit finding (see PR description): gallery_images[] has been a
-- documented, forward-compatible key in the tracker's safe-item shape
-- since before this feature, but the RPC has only ever populated it
-- with a single derived entry mirroring image_url. X LAB's own
-- OrderItemGallery.jsx lightbox is already built generically for N
-- images and needs no frontend change to start rendering more than one.
--
-- Source of truth for the gallery: the order line's own FROZEN
-- 'image_gallery' key (written once, at line-creation time, by X LAB
-- migration 20260917090000's xos_add_composed_client_product_to_order -
-- never re-derived live from the Client Product here). A line created
-- before this feature existed has no 'image_gallery' key at all, so it
-- falls through to the exact same single-entry derivation this function
-- already used - zero behaviour change for every pre-existing order.
--
-- Visibility: role='reference' entries are filtered out before they
-- ever reach an anonymous tracker caller - internal/reference pictures
-- stay staff-only by default, exactly as the task's suggested policy.
--
-- Security: a gallery entry's opaque private-upload ref is exposed only
-- as a thumbnail_ref (never resolved server-side here), the same
-- pattern already used for the line's own primary image. To let the
-- existing resolve-public-tracker-file-url edge function authorize
-- these too, verify_public_tracker_visible_thumbnail_ref gains one
-- additional OR-clause checking the ref against the line's own
-- image_gallery array (role <> 'reference'), rather than only its
-- singular image_url - same function, same trust boundary, no new
-- resolution mechanism invented.
--
-- Does NOT touch: client_product_artwork, order_line_component_snapshots,
-- Phase 2 production readiness, PayFast, invoice-payment logic,
-- approval-on-behalf.
--
-- Rollback: re-apply the prior definitions from
-- 20260914090000_public_tracking_line_thumbnail_precedence.sql (verbatim
-- create-or-replace of both functions) to revert.
--
-- STAGING ONLY in this phase - not applied to production.

begin;

create or replace function public.get_public_order_tracking_for_host(p_lookup text, p_hostname text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
          'line_id', case when resolved.thumbnail_ref is not null or gallery.has_private_entries then item ->> 'line_id' else null end,
          'gallery_images', coalesce(gallery.gallery_images, case
            when resolved.image_url is not null
              then jsonb_build_array(jsonb_build_object(
                     'safe_url', resolved.image_url,
                     'thumbnail_ref', resolved.thumbnail_ref,
                     'role', 'primary',
                     'label', null::text,
                     'sort_order', 0
                   ))
            else '[]'::jsonb
          end),
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
      -- MULTI-PICTURE: the line's own frozen image_gallery, customer-
      -- visible roles only. Absent/empty for every line created before
      -- this feature (or for a non-composed line that never had one) -
      -- those fall through to the single-entry 'resolved' shape above,
      -- unchanged.
      left join lateral (
        select
          jsonb_agg(jsonb_build_object(
            'safe_url', case when (g ->> 'image_ref') ~* '^https://' then g ->> 'image_ref' else null end,
            'thumbnail_ref', case when (g ->> 'image_ref') ~* '^private-upload://uploads/' then g ->> 'image_ref' else null end,
            'role', g ->> 'role',
            'label', nullif(btrim(coalesce(g ->> 'caption', '')), ''),
            'sort_order', coalesce((g ->> 'sort_order')::int, 0)
          ) order by coalesce((g ->> 'sort_order')::int, 0)) as gallery_images,
          bool_or((g ->> 'image_ref') ~* '^private-upload://uploads/') as has_private_entries
        from jsonb_array_elements(coalesce(item -> 'image_gallery', '[]'::jsonb)) g
        where coalesce(g ->> 'role', '') <> 'reference'
      ) gallery on true
      where coalesce(item ->> 'line_role', 'product') <> 'breakdown'
        and nullif(btrim(coalesce(item ->> 'name', '')), '') is not null
    ) else '[]'::jsonb end
  )
  from matched_order o;
$function$;

create or replace function public.verify_public_tracker_visible_thumbnail_ref(p_lookup text, p_hostname text, p_line_id text, p_thumbnail_ref text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
        and coalesce(item ->> 'line_role', 'product') <> 'breakdown'
        and (
          item ->> 'image_url' = input.clean_ref
          or exists (
            select 1
            from jsonb_array_elements(coalesce(item -> 'image_gallery', '[]'::jsonb)) g
            where g ->> 'image_ref' = input.clean_ref
              and coalesce(g ->> 'role', '') <> 'reference'
          )
        )
    );
$function$;

commit;
