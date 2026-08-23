-- XOS 3B — Product Onboarding & Ecosystem Reconciliation.
--
-- Internal, staff-only workflow that lets OPPS staff establish a Commerce
-- product once and connect it across Commerce, the managed client-account
-- layer (public.client_products), OPPS (public.products), and the shared
-- X LAB catalog (public.xlab_products) - through the existing identity
-- bridge (commerce.product_links) rather than a bespoke sync mechanism.
-- XOS itself remains read-only for Products; nothing here is reachable by
-- normal authenticated tenant/client users - see admin_onboard_client_
-- commerce_product's internal is_opps_staff() gate.
--
-- Reuses, rather than duplicates:
--   - public.is_opps_staff() for internal actor authority (the same
--     pattern already used by find_or_create_client_product_artwork_
--     from_asset). NOTE (post-review correction): earlier revisions of
--     this migration additionally gated on public.can_access_tenant(),
--     which requires the CALLER to hold a tenant_memberships row in the
--     target tenant. That is correct for tenant-owned staff surfaces, but
--     wrong here - production verification showed active Joint X OPPS
--     staff hold NO tenant_memberships row in GSB (a real, active managed
--     client tenant) at all, so that gate would have denied every real
--     onboarding call. public.clients' own RLS already treats
--     is_opps_staff() alone as sufficient internal authority (staff can
--     see every client), so these RPCs now match that existing contract:
--     is_opps_staff() is the actor gate; the tenant itself is always
--     resolved server-side from public.clients, never taken from caller
--     input, and every supplied OPPS/client-product/X LAB identity is
--     still independently verified against that resolved tenant. This
--     does not touch or weaken any XOS client-facing RPC - a normal
--     authenticated tenant owner still fails is_opps_staff() and is
--     denied exactly as before.
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
-- 2. commerce.product_links cardinality correction (post-review, twice).
--
-- The original XOS 3A constraint - UNIQUE (tenant_id, system_key,
-- external_id) - assumed every system_key was a one-to-one identity
-- mapping. Two rounds of production reconciliation disproved that for two
-- different system_keys, for two different reasons:
--
--   xlab_product: X LAB templates (JET tees, hoodies, caps, etc.) are
--   reusable CATALOG identities - many Commerce products in the same
--   tenant legitimately reference the same template (GSB Product A ->
--   JET 240g, GSB Product B -> JET 240g must both be representable).
--
--   opps_product: live production data proves public.products is a
--   tenant-scoped, reusable OPERATIONAL/BASE-PRODUCT identity, not a
--   one-commerce-product identity either - one existing OPPS product
--   ("JET T-Shirt") is already referenced by TWO public.client_products
--   ("JET T-Shirt" and "SFR T-Shirt"). Several Commerce/client-specific
--   products (different branding/retail identity, different retail price)
--   legitimately share one underlying OPPS base product - forcing a new
--   OPPS product per Commerce product would fragment inventory instead of
--   sharing it, which is precisely the wrong direction for future
--   inventory integration.
--
--   client_product remains the one true identity mapping here: one
--   managed client-account relationship belongs to exactly one Commerce
--   product tenant-wide - that is what "managed" means.
--
-- Three narrower, explicit constraints:
--
--   A. exact duplicate protection (any system_key) - the same commerce
--      product can never carry two rows for the same (system_key,
--      external_id) pair.
--   B. external identity uniqueness, identity systems only - a given
--      client_product/legacy_gsb_product external id maps to exactly one
--      commerce product tenant-wide. Deliberately excludes opps_product
--      AND xlab_product - both are reusable, for the two separate reasons
--      above.
--   C. one mapping of a given integration type per commerce product - a
--      single commerce product can never ambiguously carry two different
--      client_product/opps_product/xlab_product mappings (i.e. at most
--      one OPPS base product, at most one X LAB template, per Commerce
--      product - reuse is about the external identity fanning OUT to
--      several Commerce products, never a Commerce product fanning IN to
--      several external identities of the same type). This is also what
--      makes admin_get_client_commerce_products' per-system_key joins
--      structurally safe (at most one matching row each), not just
--      empirically safe.
--
-- Confirmed against production (read-only): commerce.product_links has 0
-- rows - this swap is compatible with live data as-is, nothing to
-- reconcile before eventual cutover.
-- =====================================================================

alter table commerce.product_links
  drop constraint commerce_product_links_identity_unique;

create unique index commerce_product_links_product_system_external_unique
  on commerce.product_links (commerce_product_id, system_key, external_id);

create unique index commerce_product_links_identity_unique
  on commerce.product_links (tenant_id, system_key, external_id)
  where system_key in ('client_product', 'legacy_gsb_product');

create unique index commerce_product_links_one_mapping_per_type_unique
  on commerce.product_links (commerce_product_id, system_key)
  where system_key in ('client_product', 'opps_product', 'xlab_product');

-- =====================================================================
-- 3. commerce.ensure_product_link - shared, deterministic ensure-link
--    helper (post-review). Replaces the earlier "exception when
--    unique_violation then null" pattern, which could silently succeed
--    even when an external identity was already mapped to a DIFFERENT
--    commerce product, and could report linked=true without a real row
--    ever existing for the resolved commerce product. Runs as the
--    caller's security context (no SECURITY DEFINER of its own - it is
--    only ever invoked from within admin_onboard_client_commerce_product,
--    whose SECURITY DEFINER privilege already applies for the duration of
--    the whole call, including nested invoker-mode calls like this one).
--    p_identity_unique controls whether the (tenant_id, system_key,
--    external_id) uniqueness check (constraint B, identity systems only)
--    applies - true only for client_product/legacy_gsb_product; false for
--    xlab_product AND opps_product (both are reusable external identities,
--    per section 2's cardinality note above). Either way, constraint C
--    (enforced structurally by the table, not by this function) still
--    caps THIS commerce product at one mapping of a given type - the
--    "already linked to a different X" branch below is what surfaces that
--    as ONBOARD_LINK_CONFLICT rather than a bare constraint-violation error.
-- =====================================================================

create function commerce.ensure_product_link(
  p_commerce_product_id uuid,
  p_tenant_id uuid,
  p_system_key text,
  p_external_id text,
  p_identity_unique boolean
)
returns void
language plpgsql
set search_path to 'pg_catalog', 'commerce'
as $$
declare
  v_current_external_id text;
  v_identity_owner uuid;
begin
  select external_id into v_current_external_id
  from commerce.product_links
  where commerce_product_id = p_commerce_product_id and system_key = p_system_key;

  if found then
    if v_current_external_id = p_external_id then
      return;
    end if;
    raise exception using errcode = 'P0001', message =
      format('ONBOARD_LINK_CONFLICT: commerce product is already linked to a different %s', p_system_key);
  end if;

  if p_identity_unique then
    select commerce_product_id into v_identity_owner
    from commerce.product_links
    where tenant_id = p_tenant_id and system_key = p_system_key and external_id = p_external_id;

    if v_identity_owner is not null and v_identity_owner <> p_commerce_product_id then
      raise exception using errcode = 'P0001', message =
        format('ONBOARD_LINK_CONFLICT: %s identity is already linked to a different commerce product', p_system_key);
    end if;
  end if;

  insert into commerce.product_links (commerce_product_id, system_key, external_id)
  values (p_commerce_product_id, p_system_key, p_external_id);
end;
$$;

revoke all on function commerce.ensure_product_link(uuid, uuid, text, text, boolean) from public;

-- =====================================================================
-- 4. admin_onboard_client_commerce_product - the atomic onboarding RPC.
--
-- p_idempotency_key carries `default null` only so it can follow the
-- optional p_existing_* parameters without violating Postgres' "defaults
-- must trail" rule; it is validated as required at runtime (line one of
-- the body) rather than treated as genuinely optional.
--
-- p_product expected keys (all optional except name, and name itself is
-- only required when this call creates a NEW client_products shell or a
-- NEW commerce product - see below): name, description, price,
-- sale_price, currency, primary_image_url, availability, status,
-- client_price, requires_quote, visible_in_account, reorder_enabled. The
-- first eight are Commerce-facing (retail); the last four are managed
-- client-account fields and are only ever applied when this call creates
-- a brand new client_products shell (Path 2) - an existing client_product
-- (Path 1) is linked, never overwritten, matching the authority contract:
-- Commerce retail price and client_products.client_price are different
-- concepts and neither silently overwrites the other.
--
-- Non-destructive update semantics (post-review): when this call resolves
-- an ALREADY-linked commerce product (e.g. a staff member re-running
-- onboarding purely to add a missing OPPS/X LAB mapping), only a
-- Commerce-facing key that is EXPLICITLY PRESENT in p_product overwrites
-- its column; an absent key preserves the product's current value. An
-- explicit JSON null for a nullable field (description, price,
-- sale_price, primary_image_url) is a deliberate clear. A brand new
-- commerce product (first time this managed product/client_product is
-- onboarded) still requires name and gets every other field from
-- p_product with the original create-time defaults for absent keys.
--
-- p_variants: jsonb array of {title, size, color, sku, price_override,
-- availability, sort_order}, or NULL. For an existing/located commerce
-- product: NULL preserves the current variant set untouched (a
-- mapping-only call), an empty array [] deliberately clears it, and a
-- non-empty array atomically replaces the full set. For a brand new
-- commerce product, NULL behaves like [] (nothing to preserve yet).
--
-- Existing managed product (Path 1) mapping conflicts (post-review): if
-- p_existing_client_product_id's row already has a non-null
-- opps_product_id/xlab_product_id AND the caller also supplies a
-- DIFFERENT non-null p_existing_opps_product_id/p_existing_xlab_product_id,
-- this raises ONBOARD_EXISTING_MAPPING_CONFLICT before any write - a
-- caller-supplied id that disagrees with an already-established mapping
-- is never silently dropped in favor of the old value (which is what a
-- bare coalesce() would otherwise do). Passing NULL keeps the existing
-- mapping; passing the SAME id is a no-op continue; an existing NULL
-- field may still be filled by the supplied id, subject to the same
-- tenant/existence checks as always. Changing an already-established
-- operational mapping is a separate, deliberate reconciliation action,
-- not a side effect of onboarding.
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
  v_tenant_status text;
  v_actor text;
  v_fingerprint text;
  v_existing_op commerce.onboarding_operations;
  v_name text;
  v_final_name text;
  v_client_price numeric;
  v_requires_quote boolean;
  v_visible_in_account boolean;
  v_reorder_enabled boolean;
  v_client_product public.client_products;
  v_effective_opps_id uuid;
  v_effective_xlab_id uuid;
  v_opps_tenant uuid;
  v_commerce_product_id uuid;
  v_commerce_product_is_new boolean;
  v_slug text;
  v_slug_base text;
  v_slug_suffix int;
  v_result jsonb;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception using errcode = 'P0001', message = 'ONBOARD_IDEMPOTENCY_KEY_REQUIRED: p_idempotency_key is required';
  end if;

  select c.tenant_id, t.status into v_tenant_id, v_tenant_status
  from public.clients c
  join public.tenants t on t.id = c.tenant_id
  where c.id = p_client_id;
  if v_tenant_id is null then
    raise exception using errcode = 'P0001', message = 'ONBOARD_CLIENT_NOT_FOUND: client does not exist or has no tenant';
  end if;

  -- Actor authority only - see header note. Tenant is always the one
  -- resolved above from public.clients, never trusted from caller input.
  if not public.is_opps_staff() then
    raise exception using errcode = 'P0001', message = 'ONBOARD_FORBIDDEN: staff access required';
  end if;
  if v_tenant_status is distinct from 'active' then
    raise exception using errcode = 'P0001', message = 'ONBOARD_CLIENT_TENANT_INACTIVE: client tenant is not active';
  end if;

  v_name := nullif(btrim(coalesce(p_product ->> 'name', '')), '');
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
    -- the row's own field is null. But a caller-supplied id that actively
    -- DISAGREES with an already-established mapping must never be
    -- silently dropped in favor of the old value (post-review: this was
    -- previously exactly what coalesce() did - staff selecting a
    -- different OPPS/X LAB product in the UI would appear to succeed
    -- while the stored mapping quietly stayed unchanged). Reject that
    -- explicitly instead; changing an established operational mapping is
    -- a separate, deliberate reconciliation action, not a side effect of
    -- onboarding.
    if v_client_product.opps_product_id is not null
       and p_existing_opps_product_id is not null
       and v_client_product.opps_product_id <> p_existing_opps_product_id then
      raise exception using errcode = 'P0001', message = 'ONBOARD_EXISTING_MAPPING_CONFLICT: existing managed product already has a different OPPS mapping';
    end if;
    if v_client_product.xlab_product_id is not null
       and p_existing_xlab_product_id is not null
       and v_client_product.xlab_product_id <> p_existing_xlab_product_id then
      raise exception using errcode = 'P0001', message = 'ONBOARD_EXISTING_MAPPING_CONFLICT: existing managed product already has a different X LAB mapping';
    end if;

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
    if v_name is null then
      raise exception using errcode = 'P0001', message = 'ONBOARD_PRODUCT_NAME_REQUIRED: product name is required to create a new managed product';
    end if;

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

  v_commerce_product_is_new := (v_commerce_product_id is null);

  if not v_commerce_product_is_new then
    -- Existing commerce product: only touch a field whose JSON key is
    -- explicitly present in p_product; an absent key preserves the
    -- current value. This is what makes a mapping-only onboarding call
    -- (e.g. adding an OPPS link to an already-onboarded product) safe.
    update commerce.products
    set name = case when p_product ? 'name' then coalesce(nullif(btrim(p_product ->> 'name'), ''), name) else name end,
        description = case when p_product ? 'description' then nullif(p_product ->> 'description', '') else description end,
        price = case when p_product ? 'price' then nullif(p_product ->> 'price', '')::numeric else price end,
        sale_price = case when p_product ? 'sale_price' then nullif(p_product ->> 'sale_price', '')::numeric else sale_price end,
        currency = case when p_product ? 'currency' then coalesce(nullif(p_product ->> 'currency', ''), currency) else currency end,
        primary_image_url = case when p_product ? 'primary_image_url' then nullif(p_product ->> 'primary_image_url', '') else primary_image_url end,
        availability = case when p_product ? 'availability' then coalesce(nullif(p_product ->> 'availability', ''), availability) else availability end,
        status = case when p_product ? 'status' then coalesce(nullif(p_product ->> 'status', ''), status) else status end
    where id = v_commerce_product_id;
  else
    if v_name is null then
      raise exception using errcode = 'P0001', message = 'ONBOARD_PRODUCT_NAME_REQUIRED: product name is required to create a new commerce product';
    end if;

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
      v_tenant_id, v_slug, v_name,
      nullif(p_product ->> 'description', ''),
      nullif(p_product ->> 'price', '')::numeric,
      nullif(p_product ->> 'sale_price', '')::numeric,
      coalesce(nullif(p_product ->> 'currency', ''), 'ZAR'),
      nullif(p_product ->> 'primary_image_url', ''),
      coalesce(nullif(p_product ->> 'availability', ''), 'available'),
      coalesce(nullif(p_product ->> 'status', ''), 'draft'),
      'xos_onboarding', p_idempotency_key
    )
    returning id into v_commerce_product_id;
  end if;

  -- ---- Variants: NULL preserves, [] clears, [...] replaces -----------
  -- (a brand new commerce product always establishes its variants fresh;
  -- NULL there is equivalent to [] since there is nothing to preserve)
  if v_commerce_product_is_new or p_variants is not null then
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
  end if;

  -- ---- Ensure identity links (deterministic - see commerce.ensure_product_link) ----
  perform commerce.ensure_product_link(v_commerce_product_id, v_tenant_id, 'client_product', v_client_product.id::text, true);

  if v_effective_opps_id is not null then
    -- opps_product is deliberately NOT identity-unique - live production
    -- data proves public.products is a tenant-scoped, reusable
    -- operational/base-product identity (one real OPPS product, "JET
    -- T-Shirt", already backs two different client_products, "JET
    -- T-Shirt" and "SFR T-Shirt"); several Commerce products in this
    -- tenant may legitimately reference the same OPPS base product. Tenant
    -- safety (v_opps_tenant = v_tenant_id) was already enforced above,
    -- independent of this call - that check is about WHICH tenant may
    -- link the product at all, not how many Commerce products may.
    perform commerce.ensure_product_link(v_commerce_product_id, v_tenant_id, 'opps_product', v_effective_opps_id::text, false);
  end if;

  if v_effective_xlab_id is not null then
    -- xlab_product is deliberately NOT identity-unique - the same X LAB
    -- template may already be linked to other commerce products in this
    -- tenant (that is expected reuse, not a conflict).
    perform commerce.ensure_product_link(v_commerce_product_id, v_tenant_id, 'xlab_product', v_effective_xlab_id::text, false);
  end if;

  -- commerce.ensure_product_link only ever returns successfully when a
  -- product_links row genuinely exists for v_commerce_product_id, or
  -- raises (aborting the whole transaction) - so by this point
  -- opps_linked/xlab_linked being true is never aspirational.
  select name into v_final_name from commerce.products where id = v_commerce_product_id;

  -- ---- Audit -----------------------------------------------------------
  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_tenant_id, v_actor, v_actor, 'xos_commerce_product_onboarded', 'commerce_product', v_commerce_product_id,
    'Onboarded commerce product "' || v_final_name || '" for client ' || p_client_id::text,
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
-- 5. admin_get_client_commerce_products - staff-safe integration health
--    read. Internal OPPS data - never merged into get_xos_products_for_host
--    or any client-facing RPC. opps_link/xlab_link are LATERAL-with-LIMIT-1
--    (post-review): commerce_product_links_one_mapping_per_type_unique
--    already makes at most one row match, but the LATERAL form keeps this
--    query structurally safe against row multiplication even if that
--    constraint were ever bypassed, rather than only empirically safe.
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
  v_tenant_status text;
  v_result jsonb;
begin
  select c.tenant_id, t.status into v_tenant_id, v_tenant_status
  from public.clients c
  join public.tenants t on t.id = c.tenant_id
  where c.id = p_client_id;
  if v_tenant_id is null then
    raise exception using errcode = 'P0001', message = 'ONBOARD_CLIENT_NOT_FOUND: client does not exist or has no tenant';
  end if;

  if not public.is_opps_staff() then
    raise exception using errcode = 'P0001', message = 'ONBOARD_FORBIDDEN: staff access required';
  end if;
  if v_tenant_status is distinct from 'active' then
    raise exception using errcode = 'P0001', message = 'ONBOARD_CLIENT_TENANT_INACTIVE: client tenant is not active';
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
  left join lateral (
    select external_id from commerce.product_links
    where commerce_product_id = cp.id and system_key = 'opps_product'
    limit 1
  ) opps_link on true
  left join lateral (
    select external_id from commerce.product_links
    where commerce_product_id = cp.id and system_key = 'xlab_product'
    limit 1
  ) xlab_link on true
  where clientprod.client_id = p_client_id
    and link.tenant_id = v_tenant_id;

  return v_result;
end;
$$;

revoke all on function public.admin_get_client_commerce_products(uuid) from public;
revoke all on function public.admin_get_client_commerce_products(uuid) from anon;
grant execute on function public.admin_get_client_commerce_products(uuid) to authenticated;

-- =====================================================================
-- 6. admin_get_client_commerce_onboarding_options - ONE narrow staff-only
--    read backing the onboarding form's three pickers, so staff never
--    have to paste UUIDs and the browser never gets unrestricted table
--    access to client_products/products/xlab_products:
--      - client_products: this client's managed products, with a
--        `linked` flag (already has a commerce_product_id via
--        product_links) so the UI can default to showing unlinked
--        candidates for the "link existing managed product" path, and
--        (post-review) its own opps_product_id/xlab_product_id plus
--        human-readable names where set, so the UI can prefill and lock
--        those pickers instead of letting a staff selection silently
--        conflict with an already-established mapping (see
--        ONBOARD_EXISTING_MAPPING_CONFLICT above).
--      - opps_products: this client's tenant's OPPS products.
--      - xlab_templates: active, tenant-agnostic shared X LAB templates.
-- =====================================================================

create function public.admin_get_client_commerce_onboarding_options(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_tenant_id uuid;
  v_tenant_status text;
  v_result jsonb;
begin
  select c.tenant_id, t.status into v_tenant_id, v_tenant_status
  from public.clients c
  join public.tenants t on t.id = c.tenant_id
  where c.id = p_client_id;
  if v_tenant_id is null then
    raise exception using errcode = 'P0001', message = 'ONBOARD_CLIENT_NOT_FOUND: client does not exist or has no tenant';
  end if;

  if not public.is_opps_staff() then
    raise exception using errcode = 'P0001', message = 'ONBOARD_FORBIDDEN: staff access required';
  end if;
  if v_tenant_status is distinct from 'active' then
    raise exception using errcode = 'P0001', message = 'ONBOARD_CLIENT_TENANT_INACTIVE: client tenant is not active';
  end if;

  select jsonb_build_object(
    'client_products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', cp.id,
          'client_facing_name', cp.client_facing_name,
          'status', cp.status,
          'linked', exists (
            select 1 from commerce.product_links pl
            where pl.system_key = 'client_product' and pl.external_id = cp.id::text
          ),
          'opps_product_id', cp.opps_product_id,
          'opps_product_name', opps.name,
          'xlab_product_id', cp.xlab_product_id,
          'xlab_product_name', xlab.name
        )
        order by cp.client_facing_name
      )
      from public.client_products cp
      left join public.products opps on opps.id = cp.opps_product_id
      left join public.xlab_products xlab on xlab.id = cp.xlab_product_id
      where cp.client_id = p_client_id
    ), '[]'::jsonb),
    'opps_products', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name)
      from public.products p
      where p.tenant_id = v_tenant_id and coalesce(p.is_archived, false) = false
    ), '[]'::jsonb),
    'xlab_templates', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'category', x.category) order by x.name)
      from public.xlab_products x
      where coalesce(x.is_active, true)
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_get_client_commerce_onboarding_options(uuid) from public;
revoke all on function public.admin_get_client_commerce_onboarding_options(uuid) from anon;
grant execute on function public.admin_get_client_commerce_onboarding_options(uuid) to authenticated;

-- =====================================================================
-- Post-apply verification (run manually, not part of this script):
--   select has_function_privilege('anon', 'public.admin_onboard_client_commerce_product(uuid,jsonb,jsonb,uuid,uuid,uuid,text)', 'EXECUTE'); -- expect false
--   select has_function_privilege('anon', 'public.admin_get_client_commerce_products(uuid)', 'EXECUTE'); -- expect false
--   select has_function_privilege('anon', 'public.admin_get_client_commerce_onboarding_options(uuid)', 'EXECUTE'); -- expect false
--   select has_function_privilege('authenticated', 'commerce.ensure_product_link(uuid,uuid,text,text,boolean)', 'EXECUTE'); -- expect false
--   select has_table_privilege('authenticated', 'commerce.onboarding_operations', 'SELECT'); -- expect false
-- =====================================================================
