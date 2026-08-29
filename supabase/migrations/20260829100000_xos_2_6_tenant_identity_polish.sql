-- XOS 2.6 — tenant identity and client experience polish.
-- Additive migration:
--   * New tenant-aware storefront order-number overload.
--   * GSB uses GSB-YYYY-NNNNNN for NEW Commerce storefront orders.
--   * Existing no-arg generator remains intact for legacy/X LAB compatibility.
--   * Commerce checkout switches only to the tenant-aware overload.
--   * XOS product summary reports actual available/out-of-stock counts.
--   * XOS order detail backfills item thumbnails/prices from Commerce projection.
--
-- Historical order numbers are never rewritten.

update public.tenants
set settings = jsonb_set(
      coalesce(settings, '{}'::jsonb),
      '{order_prefix}',
      to_jsonb('GSB'::text),
      true
    ),
    updated_at = now()
where slug = 'gsb'
  and status = 'active'
  and coalesce(settings->>'order_prefix', '') <> 'GSB';

create or replace function public._generate_storefront_order_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_prefix text := 'XL';
  v_candidate text;
  v_attempt integer := 0;
begin
  select upper(trim(coalesce(t.settings->>'order_prefix', '')))
  into v_prefix
  from public.tenants t
  where t.id = p_tenant_id
    and t.status = 'active'
  limit 1;

  if v_prefix is null or v_prefix !~ '^[A-Z0-9]{2,8}$' then
    v_prefix := 'XL';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_candidate := v_prefix || '-' || to_char(now(), 'YYYY') || '-' ||
      lpad((floor(random() * 1000000))::integer::text, 6, '0');

    exit when not exists (
      select 1 from public.xlab_orders xo where xo.order_number = v_candidate
    ) and not exists (
      select 1 from public.orders o where o.order_number = v_candidate
    );

    if v_attempt >= 20 then
      raise exception 'Unable to generate a unique storefront order number.';
    end if;
  end loop;

  return v_candidate;
end;
$function$;

revoke all on function public._generate_storefront_order_number(uuid) from public;
revoke all on function public._generate_storefront_order_number(uuid) from anon;
grant execute on function public._generate_storefront_order_number(uuid)
  to authenticated, service_role, postgres;

create or replace function public.create_commerce_checkout_order(
  p_storefront_host text,
  p_items jsonb,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text default null::text,
  p_shipping_address jsonb default '{}'::jsonb,
  p_shipping_method text default 'standard'::text,
  p_order_notes text default null::text,
  p_marketing_consent boolean default false,
  p_idempotency_key text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_host text;
  v_tenant_id uuid;
  v_client_id uuid;
  v_client_name text;
  v_order_id uuid;
  v_order_number text;
  v_xlab_order_id uuid;
  v_payment_id uuid;
  v_subtotal numeric := 0;
  v_shipping_fee numeric := 0;
  v_total numeric := 0;
  v_shipping_method text;
  v_fulfillment_type text;
  v_products jsonb := '[]'::jsonb;
  v_item jsonb;
  v_line jsonb;
  v_variant_id uuid;
  v_product_id uuid;
  v_client_product_id uuid;
  v_product_name text;
  v_variant_title text;
  v_size text;
  v_color text;
  v_sku text;
  v_unit_price numeric;
  v_quantity integer;
  v_line_total numeric;
  v_existing public.orders;
  v_mirrored public.xlab_orders;
  v_line_client_id uuid;
begin
  v_host := lower(trim(coalesce(p_storefront_host, '')));
  v_host := regexp_replace(v_host, '^https?://', '');
  v_host := split_part(v_host, '/', 1);
  v_host := regexp_replace(v_host, ':[0-9]+$', '');

  if v_host = '' then
    raise exception using errcode = '22023', message = 'Storefront host is required.';
  end if;

  select td.tenant_id into v_tenant_id
  from public.tenant_domains td
  where lower(td.hostname) = v_host
    and td.surface = 'storefront'
    and td.status = 'active'
    and td.verified_at is not null
  order by td.is_primary desc, td.created_at asc
  limit 1;

  if v_tenant_id is null then
    raise exception using errcode = '22023', message = 'Storefront is not active.';
  end if;

  if not exists (
    select 1 from public.tenant_capabilities tc
    where tc.tenant_id = v_tenant_id
      and tc.capability_key = 'products'
      and tc.enabled = true
      and coalesce(tc.config->>'storefront_catalog_source', '') = 'commerce'
  ) then
    raise exception using errcode = '22023', message = 'Commerce checkout is not enabled for this storefront.';
  end if;

  if length(trim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception using errcode = '22023', message = 'Checkout idempotency key is required.';
  end if;

  if length(trim(coalesce(p_customer_name, ''))) < 2 then
    raise exception using errcode = '22023', message = 'Customer name is required.';
  end if;

  if position('@' in trim(coalesce(p_customer_email, ''))) < 2 then
    raise exception using errcode = '22023', message = 'A valid customer email is required.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 25 then
    raise exception using errcode = '22023', message = 'Checkout must contain between 1 and 25 items.';
  end if;

  select * into v_existing
  from public.orders
  where tenant_id = v_tenant_id
    and checkout_idempotency_key = trim(p_idempotency_key)
  limit 1;

  if v_existing.id is not null then
    select xo.id into v_xlab_order_id
    from public.xlab_orders xo
    where xo.opps_order_id = v_existing.id::text
       or xo.opps_order_number = v_existing.order_number
    limit 1;

    select xp.id into v_payment_id
    from public.xlab_payments xp
    where xp.order_id = v_xlab_order_id
    order by xp.created_at asc
    limit 1;

    return jsonb_build_object(
      'ok', true,
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'xlab_order_id', v_xlab_order_id,
      'payment_id', v_payment_id,
      'subtotal', v_existing.total_amount - coalesce(v_existing.shipping_fee, 0),
      'shipping_fee', coalesce(v_existing.shipping_fee, 0),
      'total_amount', v_existing.total_amount,
      'payment_status', v_existing.payment_status,
      'replayed', true
    );
  end if;

  v_shipping_method := lower(trim(coalesce(p_shipping_method, 'standard')));

  if v_shipping_method = 'standard' then
    v_shipping_fee := 100;
    v_fulfillment_type := 'courier';
    if p_shipping_address is null
       or jsonb_typeof(p_shipping_address) is distinct from 'object'
       or p_shipping_address = '{}'::jsonb then
      raise exception using errcode = '22023', message = 'Delivery address is required for standard delivery.';
    end if;
  elsif v_shipping_method = 'collection' then
    v_shipping_fee := 0;
    v_fulfillment_type := 'collection';
  else
    raise exception using errcode = '22023', message = 'Unsupported shipping method.';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_variant_id := (v_item->>'variant_id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'Each cart item must contain a valid Commerce variant ID.';
    end;

    begin
      v_quantity := coalesce(nullif(v_item->>'quantity', '')::integer, 0);
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'Each cart item quantity must be a whole number.';
    end;

    if v_quantity <= 0 or v_quantity > 50 then
      raise exception using errcode = '22023', message = 'Each cart item quantity must be between 1 and 50.';
    end if;

    select
      v.product_id,
      v.sku,
      coalesce(v.title, v.size, 'One Size'),
      v.size,
      v.color,
      coalesce(v.price_override, p.sale_price, p.price),
      p.name,
      cp.id,
      cp.client_id,
      c.name
    into
      v_product_id,
      v_sku,
      v_variant_title,
      v_size,
      v_color,
      v_unit_price,
      v_product_name,
      v_client_product_id,
      v_line_client_id,
      v_client_name
    from commerce.product_variants v
    join commerce.products p on p.id = v.product_id
    join commerce.product_links pl
      on pl.commerce_product_id = p.id
     and pl.tenant_id = v_tenant_id
     and pl.system_key = 'client_product'
    join public.client_products cp
      on cp.id::text = pl.external_id
     and cp.tenant_id = v_tenant_id
    left join public.clients c on c.id = cp.client_id
    where v.id = v_variant_id
      and v.tenant_id = v_tenant_id
      and p.tenant_id = v_tenant_id
      and p.status = 'published'
      and p.availability = 'available'
      and v.availability = 'available'
    order by pl.created_at asc
    limit 1;

    if v_product_id is null or v_client_product_id is null or v_unit_price is null then
      raise exception using errcode = '22023', message = 'One or more cart items is no longer available in this storefront.';
    end if;

    if v_client_id is null then
      v_client_id := v_line_client_id;
    elsif v_client_id is distinct from v_line_client_id then
      raise exception using errcode = '22023', message = 'Checkout items belong to different client accounts.';
    end if;

    if exists (
      select 1 from jsonb_array_elements(v_products) existing_item
      where existing_item->>'commerce_variant_id' = v_variant_id::text
    ) then
      raise exception using errcode = '22023', message = 'The same product variant cannot appear twice in checkout.';
    end if;

    v_line_total := round(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;

    v_line := jsonb_strip_nulls(jsonb_build_object(
      'line_id', gen_random_uuid()::text,
      'commerce_product_id', v_product_id,
      'commerce_variant_id', v_variant_id,
      'client_product_id', v_client_product_id,
      'sku', v_sku,
      'name', v_product_name,
      'variant', v_variant_title,
      'size', v_size,
      'color', v_color,
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'line_total', v_line_total
    ));

    v_products := v_products || jsonb_build_array(v_line);
  end loop;

  if v_client_id is null then
    raise exception using errcode = '22023', message = 'Could not resolve the storefront client.';
  end if;

  v_total := round(v_subtotal + v_shipping_fee, 2);
  v_order_number := public._generate_storefront_order_number(v_tenant_id);

  insert into public.orders (
    client_name, client_email, client_phone, client_id, order_number,
    status, priority, products, total_amount, deposit_paid,
    special_instructions, notes, file_urls, assigned_team, source,
    pipeline_stage, tenant_id, display_name, fulfillment_type,
    apply_shipping_fee, shipping_fee, delivery_note,
    products_locked_at, products_locked_by,
    payment_status, payment_method, storefront_host, checkout_idempotency_key,
    shipping_address, shipping_method, marketing_consent, consent_recorded_at,
    source_metadata
  ) values (
    trim(p_customer_name),
    lower(trim(p_customer_email)),
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    v_client_id,
    v_order_number,
    'confirmed',
    'normal',
    v_products,
    v_total,
    0,
    nullif(trim(coalesce(p_order_notes, '')), ''),
    'Commerce storefront checkout — authoritative OPPS order created before PayFast.',
    '{}'::text[],
    '{}'::text[],
    'xlab',
    'received',
    v_tenant_id,
    coalesce(v_client_name, trim(p_customer_name)),
    v_fulfillment_type,
    v_shipping_fee > 0,
    v_shipping_fee,
    p_shipping_address->>'delivery_note',
    now(),
    'commerce_checkout',
    'pending',
    'payfast',
    v_host,
    trim(p_idempotency_key),
    p_shipping_address,
    v_shipping_method,
    coalesce(p_marketing_consent, false),
    case when coalesce(p_marketing_consent, false) then now() else null end,
    jsonb_build_object(
      'storefront_host', v_host,
      'catalog_source', 'commerce',
      'shipping_fee', v_shipping_fee,
      'shipping_method', v_shipping_method,
      'checkout_idempotency_key', trim(p_idempotency_key)
    )
  )
  returning id into v_order_id;

  select xo.* into v_mirrored
  from public.xlab_orders xo
  where xo.opps_order_id = v_order_id::text
     or xo.opps_order_number = v_order_number
  order by xo.created_at asc
  limit 1;

  if v_mirrored.id is null then
    raise exception 'OPPS order mirror could not be created.';
  end if;

  v_xlab_order_id := v_mirrored.id;

  insert into public.xlab_payments (
    order_id, order_number, amount, method, status, reconciliation_status
  ) values (
    v_xlab_order_id, v_order_number, v_total, 'payfast', 'pending', 'not_required'
  )
  returning id into v_payment_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'xlab_order_id', v_xlab_order_id,
    'payment_id', v_payment_id,
    'subtotal', v_subtotal,
    'shipping_fee', v_shipping_fee,
    'total_amount', v_total,
    'payment_status', 'pending',
    'replayed', false
  );
end;
$function$;

revoke all on function public.create_commerce_checkout_order(
  text, jsonb, text, text, text, jsonb, text, text, boolean, text
) from public;
grant execute on function public.create_commerce_checkout_order(
  text, jsonb, text, text, text, jsonb, text, text, boolean, text
) to anon, authenticated, service_role, postgres;

create or replace function public.get_xos_product_summary_for_host(p_hostname text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  resolved_tenant_id uuid;
  products_enabled boolean;
  result jsonb;
begin
  select tenant_id
  into resolved_tenant_id
  from public.resolve_authenticated_tenant_host(p_hostname, 'xos_admin')
  limit 1;

  if resolved_tenant_id is null then
    raise exception 'XOS access denied.';
  end if;

  -- Preserved from the prior definition of this function - dropping it
  -- would let a tenant without the products capability enabled still pull
  -- a valid summary instead of the existing clean rejection.
  select coalesce(tc.enabled, false)
  into products_enabled
  from public.tenant_capabilities tc
  where tc.tenant_id = resolved_tenant_id
    and tc.capability_key = 'products';

  if not coalesce(products_enabled, false) then
    raise exception 'Products are not available for this workspace.';
  end if;

  select jsonb_build_object(
    'total', count(*)::int,
    'published', count(*) filter (
      where lower(coalesce(product.status, '')) = 'published'
    )::int,
    'draft', count(*) filter (
      where lower(coalesce(product.status, '')) <> 'published'
    )::int,
    'available', count(*) filter (
      where lower(coalesce(product.status, '')) = 'published'
        and lower(coalesce(product.availability, '')) = 'available'
    )::int,
    'out_of_stock', count(*) filter (
      where lower(coalesce(product.status, '')) = 'published'
        and lower(coalesce(product.availability, '')) = 'out_of_stock'
    )::int,
    -- Backward-compatible alias for any older frontend still reading this key.
    'unavailable', count(*) filter (
      where lower(coalesce(product.status, '')) = 'published'
        and lower(coalesce(product.availability, '')) = 'out_of_stock'
    )::int
  )
  into result
  from commerce.products product
  where product.tenant_id = resolved_tenant_id
    and lower(coalesce(product.status, '')) <> 'archived';

  return result;
end;
$function$;

revoke all on function public.get_xos_product_summary_for_host(text) from public;
revoke all on function public.get_xos_product_summary_for_host(text) from anon;
grant execute on function public.get_xos_product_summary_for_host(text)
  to authenticated, service_role, postgres;

create or replace function public.get_xos_order_detail_for_host(
  p_hostname text,
  p_order_number text
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  resolved_tenant_id uuid;
  clean_order_number text := left(trim(coalesce(p_order_number, '')), 80);
  order_row public.orders%rowtype;
  items jsonb;
  result jsonb;
begin
  select tenant_id
  into resolved_tenant_id
  from public.resolve_authenticated_tenant_host(p_hostname, 'xos_admin')
  limit 1;

  if resolved_tenant_id is null then
    raise exception 'XOS access denied.';
  end if;

  if clean_order_number = '' then
    raise exception 'Order number is required.';
  end if;

  select *
  into order_row
  from public.orders o
  where o.order_number = clean_order_number
    and o.tenant_id = resolved_tenant_id
    and coalesce(o.is_archived, false) = false
  limit 1;

  if order_row.order_number is null then
    raise exception 'Order not found.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', left(coalesce(item->>'name', 'Item'), 160),
      'size', nullif(left(coalesce(item->>'size', ''), 40), ''),
      'color', nullif(left(coalesce(item->>'color', ''), 40), ''),
      'quantity', nullif(item->>'quantity', '')::numeric,
      'image_url', coalesce(
        nullif(item->>'image_url', ''),
        (
          select nullif(product.primary_image_url, '')
          from commerce.products product
          where product.id::text = nullif(item->>'commerce_product_id', '')
            and product.tenant_id = resolved_tenant_id
          limit 1
        )
      ),
      'price', coalesce(
        nullif(item->>'price', ''),
        nullif(item->>'unit_price', '')
      )::numeric
    )
    order by ord
  ), '[]'::jsonb)
  into items
  from jsonb_array_elements(
    coalesce(order_row.products, '[]'::jsonb)
  ) with ordinality as t(item, ord);

  result := jsonb_build_object(
    'order_number', order_row.order_number,
    'client_name', left(coalesce(order_row.client_name, 'Client'), 160),
    'status', coalesce(order_row.status, 'confirmed'),
    'stage', left(coalesce(
      order_row.production_detail_stage,
      order_row.pipeline_stage,
      order_row.status,
      'confirmed'
    ), 80),
    'created_at', order_row.created_at,
    'due_date', order_row.due_date,
    'total_amount', order_row.total_amount,
    'tracking_reference',
      nullif(left(coalesce(order_row.tracking_number, ''), 80), ''),
    'items', items
  );

  return result;
end;
$function$;

revoke all on function public.get_xos_order_detail_for_host(text, text) from public;
revoke all on function public.get_xos_order_detail_for_host(text, text) from anon;
grant execute on function public.get_xos_order_detail_for_host(text, text)
  to authenticated, service_role, postgres;
