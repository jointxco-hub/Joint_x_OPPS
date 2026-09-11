-- Public tracker: wire up the (already-existing, staff-toggled)
-- portal_show_files / portal_visible_file_urls fields into a safe files[]
-- projection, plus a companion anon-safe verification RPC an edge function
-- uses to sign a file's URL on demand.
--
-- Root cause: get_public_order_tracking_for_host has, since
-- 202606270001_private_uploads_signed_urls.sql, hardcoded
-- 'portal_show_files' to false, 'portal_visible_file_urls' to an empty
-- array, and 'invoice_files' to an empty array in its jsonb_build_object -
-- regardless of the actual orders.portal_show_files /
-- orders.portal_visible_file_urls values, which are set correctly by
-- OPPS's own PortalTab.jsx toggle and Files tab. That hardcoding was
-- deliberate at the time (these fields held private-upload:// references
-- with no safe resolution path), but it means the toggle has never
-- actually worked publicly, exactly matching the reported symptom on
-- ORD-MTKNJU7S (portal_show_files = true in the DB, but nothing rendered).
-- invoice_files stays hardcoded exactly as before - invoicing is out of
-- scope here.
--
-- Fix follows an already-shipped, security-reviewed precedent for the
-- SAME private `uploads` bucket: verify_customer_visible_file_ref() +
-- the resolve-client-file-url edge function
-- (202608180002_customer_visible_file_enrichment.sql, X LAB repo). That
-- design accepts returning the raw private-upload://bucket/path STRING to
-- an anon caller as safe, because the string alone grants nothing - the
-- `uploads` bucket is private at the storage-policy level (storage.
-- buckets.public = false, confirmed on production) and only a
-- service-role edge function can turn the string into a working URL,
-- after independently re-verifying visibility on every call. This
-- migration adds the exact same shape for the public tracker (host+lookup
-- identity instead of email+order-number): 'files' entries carry a
-- `file_ref` (the raw string) plus a derived display `name` and
-- `file_type` - never a bucket name, a signed URL's internals, a
-- client_asset_id, or any other internal metadata. Toggling
-- portal_show_files off makes 'files' empty on the very next call, same
-- as portal_show_items/items.

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

-- Narrow authorization check the new resolve-public-tracker-file-url edge
-- function calls before signing: does this exact file ref currently
-- appear in this exact order's client-visible list, for this exact
-- host-resolved tenant. Mirrors verify_customer_visible_file_ref exactly
-- (202608180002), just keyed by host+lookup instead of email+order-number.
-- Re-checks visibility fresh on every call - toggling portal_show_files
-- off, or un-ticking a file, takes effect immediately.
create or replace function public.verify_public_tracker_visible_file_ref(
  p_lookup text,
  p_hostname text,
  p_file_ref text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  with input as (
    select upper(trim(coalesce(p_lookup, ''))) as raw_lookup,
           btrim(coalesce(p_file_ref, '')) as clean_ref
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
    and input.clean_ref <> ''
    and coalesce(o.portal_show_files, false)
    and o.portal_visible_file_urls is not null
    and input.clean_ref = any(o.portal_visible_file_urls)
    and (
      upper(coalesce(o.order_number, '')) = input.raw_lookup
      or upper(coalesce(o.tracking_number, '')) = input.raw_lookup
      or upper(o.id::text) = input.raw_lookup
      or exists (
        select 1
        from jsonb_array_elements_text(coalesce(o.invoice_numbers, '[]'::jsonb)) number
        where upper(number) = input.raw_lookup
      )
    );
$fn$;

revoke all on function public.verify_public_tracker_visible_file_ref(text, text, text) from public;
grant execute on function public.verify_public_tracker_visible_file_ref(text, text, text) to anon, authenticated;
