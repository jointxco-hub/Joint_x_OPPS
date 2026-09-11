-- Public tracker: safe image precedence + forward-compatible gallery
-- contract for client-facing order line items.
--
-- Root cause this fixes: the public tracker's items[].image_url was
-- sourced ONLY from the order line's own raw image_url field
-- (orders.products[].image_url -- whatever staff happened to paste onto
-- that specific line in the OPPS Products editor). It never looked at
-- the configured Client Product's own primary_mockup_url, which is a
-- SEPARATE, already-customer-safe field (selected directly by the
-- customer-facing RPC get_my_client_products, see
-- 202608300001_client_product_customer_isolation_rpcs.sql:99,130) that
-- staff set once when configuring the product. So an order line linked
-- to a fully-configured Client Product with a mockup could still show
-- no image on the public tracker, simply because nobody separately
-- copied that same URL onto the order line itself. Two sources of
-- truth for "this product's picture," only one of which the tracker
-- ever read.
--
-- Fix: resolve each item's image with an explicit precedence,
-- evaluated fresh on every call (no caching, no snapshot):
--   1. the linked Client Product's primary_mockup_url, if the line
--      carries a client_product_id that resolves to a client product
--      in THIS order's own tenant (checked two ways -- see below -- this
--      table's tenant_id is documented as insert-derived-if-null and
--      never re-validated against a caller-supplied value, so it alone
--      cannot be trusted; see 20260823111500:227-245's own warning)
--   2. the order line's own raw image_url (existing behaviour,
--      preserved verbatim as the fallback)
--   3. omitted entirely (frontend renders a clean placeholder)
-- Both sources are re-validated against https here -- neither column
-- has a schema-level CHECK constraint enforcing that, so this function
-- cannot assume either is already safe.
--
-- Explicitly NOT attempted in this migration (deferred -- see the
-- companion X LAB gallery/lightbox report):
--   Per-order-line APPROVED ARTWORK (client_product_artwork, matched
--   via order_line_component_snapshots.artwork_revision_ids) is NOT
--   joined in here, even though it is the most specific possible
--   image. Two independent blockers, both security-relevant, not
--   solvable as a drive-by part of a UI task:
--     a) client_product_artwork.file_path is a storage REFERENCE, not
--        a servable URL (customer resolution today requires an
--        authenticated per-request signing call -- there is no public
--        anon-safe signed-URL issuance path for this table);
--     b) the authenticated customer RPC that reads this table
--        (get_my_client_product_artwork, 20260831150000) was changed
--        to select on is_current = true alone, WITHOUT the
--        status = approved guard the original version had
--        (202608300001) -- i.e. a pending or rejected revision can
--        currently reach an authenticated customer. Joining this table
--        into an ANONYMOUS public RPC without first re-auditing and
--        fixing that would risk exposing unapproved artwork publicly,
--        which is strictly worse. That fix, plus building a genuine
--        anon-safe image-serving path, is separate follow-up work.
--
-- gallery_images is added now as a forward-compatible contract shape
-- -- an array of safe_url / label / sort_order objects -- populated
-- today with a single derived entry from whichever image wins the
-- precedence above (or empty if none). This lets the X LAB lightbox be
-- built as a true multi-image gallery viewer NOW, against the real
-- shape it will use later, without a second frontend change once
-- client_product_artwork gets a safe public resolution path and this
-- array can be filled with real Front/Back/Detail entries.

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
        -- Both client_products.tenant_id AND the linked clients.tenant_id
        -- must independently agree with this order's own tenant before its
        -- primary_mockup_url is trusted -- client_products.tenant_id alone
        -- is insert-derived-if-null and never re-validated against a
        -- caller-supplied value (20260823111500_xos_3a_products_foundation
        -- .sql:227-245), so it cannot be the only check on a public,
        -- anonymous endpoint. A mismatch here silently yields NULL, never
        -- another tenant's image.
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
        select case
          when cp_match.primary_mockup_url ~* '^https://' then cp_match.primary_mockup_url
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
