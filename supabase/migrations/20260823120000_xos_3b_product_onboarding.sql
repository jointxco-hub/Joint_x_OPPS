-- XOS 3B — Product Onboarding & Ecosystem Reconciliation.
--
-- Internal, staff-only workflow that lets OPPS staff establish a Commerce
-- product once and connect it across Commerce, the managed client-account
-- layer (public.client_products), OPPS (public.products), and the shared
-- X LAB catalog (public.xlab_products) - through the existing identity
-- bridge (commerce.product_links) rather than a bespoke sync mechanism.
-- XOS itself remains read-only for Products; nothing here is reachable by
-- normal authenticated tenant/client users - see admin_onboard_client_
-- commerce_product's internal is_opps_staff()/can_access_tenant() gate.
--
-- Reuses, rather than duplicates:
--   - public.is_opps_staff() + public.can_access_tenant(uuid) for staff/
--     tenant authority (the same pattern already used by
--     find_or_create_client_product_artwork_from_asset and client_products'
--     own "Staff manage client products" RLS policy).
--   - public.opps_activity_events for the durable audit trail (already the
--     generic event log written by apply_invoice_order_sync etc.).
--   - commerce.products' existing (tenant_id, source_system, source_ref)
--     identity contract as one layer of duplicate-insert protection,
--     stamping source_system = 'xos_onboarding', source_ref = the
--     idempotency key, on newly created commerce products.
--
-- Adds narrowly, because no existing mechanism covers it: a dedicated
-- idempotency ledger (commerce.onboarding_operations). An onboarding call
-- is one jsonb payload behind one client-supplied key; a Postgres advisory
-- lock keyed on that string serializes concurrent replays so two racing
-- calls with the same key can never both create rows, and the ledger
-- itself makes a settled key return its original result forever after,
-- rejecting a replay whose payload has materially changed.
--
-- No OPPS product-creation RPC exists anywhere in this repo today (only a
-- one-off demo-data seed insert) - this migration deliberately does not
-- add one. admin_onboard_client_commerce_product may LINK an existing
-- public.products row; it never inserts one. Absence of a link is exposed
-- as integration_status = 'needs_opps_mapping', not silently created.

-- =====================================================================
-- 1. commerce.onboarding_operations - idempotency ledger.
-- =====================================================================

create table commerce.onboarding_operations (
  idempotency_key text primary key,
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id),
  actor_email text not null,
  request_fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index commerce_onboarding_operations_tenant_idx
  on commerce.onboarding_operations (tenant_id);

alter table commerce.onboarding_operations enable row level security;
-- Same "RLS enabled, zero policies, SECURITY DEFINER RPCs only" pattern as
-- the rest of the commerce schema (see 20260823111500) - this is an
-- internal idempotency ledger, never read or written directly by any
-- client.

revoke all on commerce.onboarding_operations from public;
revoke all on commerce.onboarding_operations from anon;
revoke all on commerce.onboarding_operations from authenticated;

-- =====================================================================
-- 2. admin_onboard_client_commerce_product - the atomic onboarding RPC.
--
-- p_idempotency_key carries `default null` only so it can follow the
-- optional p_existing_* parameters without violating Postgres' "defaults
-- must trail" rule; it is validated as required at runtime (line one of
-- the body) rather than treated as genuinely optional.
--
-- p_product expected keys (all optional except name): name, description,
-- price, sale_price, currency, primary_image_url, availability, status,
-- client_price, requires_quote, visible_in_account, reorder_enabled. The
-- first eight are Commerce-facing (retail); the last four are managed
-- client-account fields and are only ever applied when this call creates
-- a brand new client_products shell (Path 2) - an existing client_product
-- (Path 1) is linked, never overwritten, matching the authority contract:
-- Commerce retail price and client_products.client_price are different
-- concepts and neither silently overwrites the other.
--
-- p_variants: jsonb array of {title, size, color, sku, price_override,
-- availability, sort_order}. Every call atomically replaces the full
-- variant set for the resolved commerce product - this is establishing
-- the current commercial variant list, not accumulating history.
-- =====================================================================

create function public.admin_onboard_client_commerce_product(
  p_client_id uuid,
  p_product jsonb,
  p_variants jsonb,
  p_existing_client_product_id uuid default null,
  p_existing_opps_product_id uuid default null,
  p_existing_xlab_product_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_tenant_id uuid;
  v_actor text;
  v_fingerprint text;
  v_existing_op commerce.onboarding_operations;
  v_name text;
  v_description text;
  v_price numeric;
  v_sale_price numeric;
  v_currency text;
  v_primary_image_url text;
  v_availability text;
  v_status text;
  v_client_price numeric;
  v_requires_quote boolean;
  v_visible_in_account boolean;
  v_reorder_enabled boolean;
  v_client_product public.client_products;
  v_effective_opps_id uuid;
  v_effective_xlab_id uuid;
  v_opps_tenant uuid;
  v_commerce_product_id uuid;
  v_slug text;
  v_slug_base text;
  v_slug_suffix int;
  v_result jsonb;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception using errcode = 'P0001', message = 'ONBOARD_IDEMPOTENCY_KEY_REQUIRED: p_idempotency_key is required';
  end if;

  select tenant_id into v_tenant_id from public.clients where id = p_client_id;
  if v_tenant_id is null then
    raise exception using errcode = 'P0001', message = 'ONBOARD_CLIENT_NOT_FOUND: client does not exist or has no tenant';
  end if;

  if not public.is_opps_staff() then
    raise exception using errcode = 'P0001', message = 'ONBOARD_FORBIDDEN: staff access required';
  end if;
  if not public.can_access_tenant(v_tenant_id) then
    raise exception using errcode = 'P0001', message = 'ONBOARD_FORBIDDEN: tenant access denied';
  end if;

  v_name := nullif(btrim(coalesce(p_product ->> 'name', '')), '');
  if v_name is null then
    raise exception using errcode = 'P0001', message = 'ONBOARD_PRODUCT_NAME_REQUIRED: product name is required';
  end if;

  v_actor := auth.email();

  -- Fingerprint every input that changes the outcome, but not the
  -- idempotency key itself (it identifies the operation, it is not part
  -- of its payload).
  v_fingerprint := md5(
    coalesce(p_client_id::text, '') || '|' ||
    coalesce(p_product::text, '') || '|' ||
    coalesce(p_variants::text, '') || '|' ||
    coalesce(p_existing_client_product_id::text, '') || '|' ||
    coalesce(p_existing_opps_product_id::text, '') || '|' ||
    coalesce(p_existing_xlab_product_id::text, '')
  );

  -- Serialize concurrent calls sharing this key so two racing replays can
  -- never both pass the "not yet recorded" check below and duplicate
  -- work; released automatically at transaction end.
  perform pg_advisory_xact_lock(hashtextextended('xos_3b_onboard:' || p_idempotency_key, 0));

  select * into v_existing_op from commerce.onboarding_operations where idempotency_key = p_idempotency_key;
  if found then
    if v_existing_op.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'ONBOARD_IDEMPOTENCY_CONFLICT: idempotency key already used with a different payload';
    end if;
    return v_existing_op.result;
  end if;

  -- ---- Path 1 (existing managed product) vs Path 2 (new shell) -------
  if p_existing_client_product_id is not null then
    select * into v_client_product from public.client_products where id = p_existing_client_product_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'ONBOARD_CLIENT_PRODUCT_NOT_FOUND: existing client_product not found';
    end if;
    if v_client_product.client_id is distinct from p_client_id then
      raise exception using errcode = 'P0001', message = 'ONBOARD_CLIENT_PRODUCT_CLIENT_MISMATCH: does not belong to the selected client';
    end if;
    if v_client_product.tenant_id is distinct from v_tenant_id then
      raise exception using errcode = 'P0001', message = 'ONBOARD_CLIENT_PRODUCT_TENANT_MISMATCH: tenant integrity violation';
    end if;

    -- Ensure-mapping semantics: prefer whatever is already established on
    -- the row so a replay/edit call can never silently override a
    -- different existing mapping; only fall back to the passed param when
    -- the row's own field is null.
    v_effective_opps_id := coalesce(v_client_product.opps_product_id, p_existing_opps_product_id);
    v_effective_xlab_id := coalesce(v_client_product.xlab_product_id, p_existing_xlab_product_id);
  else
    v_effective_opps_id := p_existing_opps_product_id;
    v_effective_xlab_id := p_existing_xlab_product_id;
  end if;

  -- ---- Validate optional OPPS / X LAB identities before any write ----
  if v_effective_opps_id is not null then
    select tenant_id into v_opps_tenant from public.products where id = v_effective_opps_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'ONBOARD_OPPS_PRODUCT_NOT_FOUND: opps product does not exist';
    end if;
    if v_opps_tenant is distinct from v_tenant_id then
      raise exception using errcode = 'P0001', message = 'ONBOARD_OPPS_PRODUCT_TENANT_MISMATCH: opps product belongs to a different tenant';
    end if;
  end if;

  if v_effective_xlab_id is not null then
    if not exists (select 1 from public.xlab_products where id = v_effective_xlab_id) then
      raise exception using errcode = 'P0001', message = 'ONBOARD_XLAB_PRODUCT_NOT_FOUND: xlab product does not exist';
    end if;
  end if;

  -- ---- Create the client_products shell (Path 2) or ensure mapping ---
  if p_existing_client_product_id is null then
    v_client_price := nullif(p_product ->> 'client_price', '')::numeric;
    v_requires_quote := coalesce((p_product ->> 'requires_quote')::boolean, false);
    v_visible_in_account := coalesce((p_product ->> 'visible_in_account')::boolean, false);
    v_reorder_enabled := coalesce((p_product ->> 'reorder_enabled')::boolean, true);

    insert into public.client_products (
      tenant_id, client_id, client_facing_name, status,
      client_price, requires_quote, currency,
      visible_in_account, reorder_enabled,
      opps_product_id, xlab_product_id
    ) values (
      v_tenant_id, p_client_id, v_name, 'draft',
      v_client_price, v_requires_quote, coalesce(nullif(p_product ->> 'currency', ''), 'ZAR'),
      v_visible_in_account, v_reorder_enabled,
      v_effective_opps_id, v_effective_xlab_id
    )
    returning * into v_client_product;
  elsif (v_client_product.opps_product_id is null and v_effective_opps_id is not null)
     or (v_client_product.xlab_product_id is null and v_effective_xlab_id is not null) then
    update public.client_products
    set opps_product_id = coalesce(opps_product_id, v_effective_opps_id),
        xlab_product_id = coalesce(xlab_product_id, v_effective_xlab_id)
    where id = v_client_product.id
    returning * into v_client_product;
  end if;

  -- ---- Locate an already-linked Commerce product, or create one ------
  select pl.commerce_product_id into v_commerce_product_id
  from commerce.product_links pl
  where pl.tenant_id = v_tenant_id
    and pl.system_key = 'client_product'
    and pl.external_id = v_client_product.id::text
  limit 1;

  v_description := nullif(p_product ->> 'description', '');
  v_price := nullif(p_product ->> 'price', '')::numeric;
  v_sale_price := nullif(p_product ->> 'sale_price', '')::numeric;
  v_currency := coalesce(nullif(p_product ->> 'currency', ''), 'ZAR');
  v_primary_image_url := nullif(p_product ->> 'primary_image_url', '');
  v_availability := coalesce(nullif(p_product ->> 'availability', ''), 'available');
  v_status := coalesce(nullif(p_product ->> 'status', ''), 'draft');

  if v_commerce_product_id is not null then
    update commerce.products
    set name = v_name,
        description = v_description,
        price = v_price,
        sale_price = v_sale_price,
        currency = v_currency,
        primary_image_url = coalesce(v_primary_image_url, primary_image_url),
        availability = v_availability,
        status = v_status
    where id = v_commerce_product_id;
  else
    v_slug_base := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug_base := regexp_replace(v_slug_base, '(^-+|-+$)', '', 'g');
    if v_slug_base is null or v_slug_base = '' then
      v_slug_base := 'product';
    end if;
    v_slug := v_slug_base;
    v_slug_suffix := 1;
    while exists (select 1 from commerce.products where tenant_id = v_tenant_id and slug = v_slug) loop
      v_slug_suffix := v_slug_suffix + 1;
      v_slug := v_slug_base || '-' || v_slug_suffix;
    end loop;

    insert into commerce.products (
      tenant_id, slug, name, description, price, sale_price, currency,
      primary_image_url, availability, status, source_system, source_ref
    ) values (
      v_tenant_id, v_slug, v_name, v_description, v_price, v_sale_price, v_currency,
      v_primary_image_url, v_availability, v_status, 'xos_onboarding', p_idempotency_key
    )
    returning id into v_commerce_product_id;
  end if;

  -- ---- Variants: atomic replace-all for this call -------------------
  delete from commerce.product_variants where product_id = v_commerce_product_id;

  insert into commerce.product_variants (
    product_id, sku, title, size, color, price_override, availability, sort_order
  )
  select
    v_commerce_product_id,
    nullif(elem ->> 'sku', ''),
    nullif(elem ->> 'title', ''),
    nullif(elem ->> 'size', ''),
    nullif(elem ->> 'color', ''),
    nullif(elem ->> 'price_override', '')::numeric,
    coalesce(nullif(elem ->> 'availability', ''), 'available'),
    coalesce((elem ->> 'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb)) as elem;

  -- ---- Ensure identity links (idempotent: unique_violation = already linked) ----
  begin
    insert into commerce.product_links (commerce_product_id, system_key, external_id)
    values (v_commerce_product_id, 'client_product', v_client_product.id::text);
  exception when unique_violation then
    null;
  end;

  if v_effective_opps_id is not null then
    begin
      insert into commerce.product_links (commerce_product_id, system_key, external_id)
      values (v_commerce_product_id, 'opps_product', v_effective_opps_id::text);
    exception when unique_violation then
      null;
    end;
  end if;

  if v_effective_xlab_id is not null then
    begin
      insert into commerce.product_links (commerce_product_id, system_key, external_id)
      values (v_commerce_product_id, 'xlab_product', v_effective_xlab_id::text);
    exception when unique_violation then
      null;
    end;
  end if;

  -- ---- Audit -----------------------------------------------------------
  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_tenant_id, v_actor, v_actor, 'xos_commerce_product_onboarded', 'commerce_product', v_commerce_product_id,
    'Onboarded commerce product "' || v_name || '" for client ' || p_client_id::text,
    jsonb_build_object(
      'client_id', p_client_id,
      'client_product_id', v_client_product.id,
      'idempotency_key', p_idempotency_key,
      'opps_linked', (v_effective_opps_id is not null),
      'xlab_linked', (v_effective_xlab_id is not null)
    )
  );

  select jsonb_build_object(
    'commerce_product_id', v_commerce_product_id,
    'slug', slug,
    'client_product_id', v_client_product.id,
    'client_product_created', (p_existing_client_product_id is null),
    'xlab_linked', (v_effective_xlab_id is not null),
    'opps_linked', (v_effective_opps_id is not null),
    'integration_status', case when v_effective_opps_id is not null then 'complete' else 'needs_opps_mapping' end
  )
  into v_result
  from commerce.products where id = v_commerce_product_id;

  begin
    insert into commerce.onboarding_operations (
      idempotency_key, tenant_id, client_id, actor_email, request_fingerprint, result
    ) values (
      p_idempotency_key, v_tenant_id, p_client_id, v_actor, v_fingerprint, v_result
    );
  exception when unique_violation then
    select * into v_existing_op from commerce.onboarding_operations where idempotency_key = p_idempotency_key;
    if v_existing_op.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'ONBOARD_IDEMPOTENCY_CONFLICT: idempotency key already used with a different payload';
    end if;
    return v_existing_op.result;
  end;

  return v_result;
end;
$$;

revoke all on function public.admin_onboard_client_commerce_product(uuid, jsonb, jsonb, uuid, uuid, uuid, text) from public;
revoke all on function public.admin_onboard_client_commerce_product(uuid, jsonb, jsonb, uuid, uuid, uuid, text) from anon;
grant execute on function public.admin_onboard_client_commerce_product(uuid, jsonb, jsonb, uuid, uuid, uuid, text) to authenticated;

-- =====================================================================
-- 3. admin_get_client_commerce_products - staff-safe integration health
--    read. Internal OPPS data - never merged into get_xos_products_for_host
--    or any client-facing RPC.
-- =====================================================================

create function public.admin_get_client_commerce_products(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_tenant_id uuid;
  v_result jsonb;
begin
  select tenant_id into v_tenant_id from public.clients where id = p_client_id;
  if v_tenant_id is null then
    raise exception using errcode = 'P0001', message = 'ONBOARD_CLIENT_NOT_FOUND: client does not exist or has no tenant';
  end if;

  if not public.is_opps_staff() then
    raise exception using errcode = 'P0001', message = 'ONBOARD_FORBIDDEN: staff access required';
  end if;
  if not public.can_access_tenant(v_tenant_id) then
    raise exception using errcode = 'P0001', message = 'ONBOARD_FORBIDDEN: tenant access denied';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'commerce_product', jsonb_build_object(
        'id', cp.id,
        'slug', cp.slug,
        'name', cp.name,
        'description', cp.description,
        'price', cp.price,
        'sale_price', cp.sale_price,
        'currency', cp.currency,
        'primary_image_url', cp.primary_image_url,
        'availability', cp.availability,
        'status', cp.status,
        'variants', coalesce(v.variants, '[]'::jsonb)
      ),
      'client_product', jsonb_build_object('linked', true, 'id', clientprod.id),
      'xlab', jsonb_build_object('linked', xlab_link.external_id is not null, 'id', xlab_link.external_id),
      'opps', jsonb_build_object('linked', opps_link.external_id is not null, 'id', opps_link.external_id),
      'integration_status', case when opps_link.external_id is not null then 'complete' else 'needs_opps_mapping' end
    )
    order by cp.created_at desc
  ), '[]'::jsonb)
  into v_result
  from commerce.product_links link
  join public.client_products clientprod
    on clientprod.id::text = link.external_id and link.system_key = 'client_product'
  join commerce.products cp on cp.id = link.commerce_product_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', pv.id, 'sku', pv.sku, 'title', pv.title, 'size', pv.size, 'color', pv.color,
        'price_override', pv.price_override, 'availability', pv.availability, 'sort_order', pv.sort_order
      )
      order by pv.sort_order, pv.created_at
    ) as variants
    from commerce.product_variants pv
    where pv.product_id = cp.id
  ) v on true
  left join commerce.product_links opps_link
    on opps_link.commerce_product_id = cp.id and opps_link.system_key = 'opps_product'
  left join commerce.product_links xlab_link
    on xlab_link.commerce_product_id = cp.id and xlab_link.system_key = 'xlab_product'
  where clientprod.client_id = p_client_id
    and link.tenant_id = v_tenant_id;

  return v_result;
end;
$$;

revoke all on function public.admin_get_client_commerce_products(uuid) from public;
revoke all on function public.admin_get_client_commerce_products(uuid) from anon;
grant execute on function public.admin_get_client_commerce_products(uuid) to authenticated;

-- =====================================================================
-- Post-apply verification (run manually, not part of this script):
--   select has_function_privilege('anon', 'public.admin_onboard_client_commerce_product(uuid,jsonb,jsonb,uuid,uuid,uuid,text)', 'EXECUTE'); -- expect false
--   select has_function_privilege('anon', 'public.admin_get_client_commerce_products(uuid)', 'EXECUTE'); -- expect false
--   select has_table_privilege('authenticated', 'commerce.onboarding_operations', 'SELECT'); -- expect false
-- =====================================================================
