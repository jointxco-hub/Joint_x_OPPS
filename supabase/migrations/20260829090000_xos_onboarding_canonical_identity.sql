-- XOS 3B onboarding amendment — optional canonical Commerce identity for
-- a brand NEW commerce product.
--
-- GSB's reviewed Commerce migration manifest (local repo
-- docs/GSB_COMMERCE_MIGRATION_MANIFEST.json) requires the imported
-- Commerce product to preserve slug/source_system/source_ref exactly as
-- planned:
--   slug           = the original local catalog.js slug
--   source_system  = 'gsb_local_catalog'
--   source_ref     = the same original slug
--
-- The live admin_onboard_client_commerce_product (20260823120000) does
-- not support that for a NEW product: it always derives the slug from
-- p_product.name (numeric-suffixing on collision) and always stamps
-- source_system = 'xos_onboarding', source_ref = the idempotency key.
-- Neither is GSB-specific behavior to change - it is the RPC's only
-- identity model today. This migration makes both OPTIONAL, caller-
-- supplied overrides, generic for any future importer, while leaving
-- every existing caller's behavior byte-for-byte identical when it
-- omits them.
--
-- Scope, precisely: this amendment only changes the NEW-commerce-product
-- branch (Path 2's product-creation path). The EXISTING/already-linked
-- commerce product branch (a mapping-only or field-update onboarding
-- call) already never touches slug/source_system/source_ref at all - see
-- that branch's own UPDATE statement below, unchanged - so "do not
-- casually rewrite source identity of an already-linked product" was
-- already true; this migration does not need to add anything there, only
-- confirm and test it stays true.
--
-- CREATE OR REPLACE only - the historical 20260823120000 migration file
-- is not edited, matching this repo's immutable-migration-history
-- convention (see Managed Clients Phase 3's own "CREATE OR REPLACE, not
-- edit the original file" precedent for public.get_storefront_catalog_
-- for_host). Every other object in 20260823120000 (commerce.
-- onboarding_operations, commerce.product_links' three constraints,
-- commerce.ensure_product_link, admin_get_client_commerce_products,
-- admin_get_client_commerce_onboarding_options) is untouched by this file.

create or replace function public.admin_onboard_client_commerce_product(
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
  -- Post-review amendment: optional canonical-identity overrides for a
  -- NEW commerce product only. Never read/used on the existing-product
  -- update branch.
  v_supplied_slug text;
  v_supplied_source_system text;
  v_supplied_source_ref text;
  v_final_source_system text;
  v_final_source_ref text;
  -- Post-review amendment (race classification fix): which unique
  -- constraint/index a concurrent-race unique_violation actually
  -- reports, so the two collision types are never conflated.
  v_constraint_name text;
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

  -- Post-review amendment: canonical-identity overrides, read once here
  -- (blank/whitespace-only treated identically to absent, matching every
  -- other optional p_product field in this function). Unchanged
  -- fingerprint below already covers these - they are ordinary keys
  -- inside p_product, not new parameters.
  v_supplied_slug := nullif(btrim(coalesce(p_product ->> 'slug', '')), '');
  v_supplied_source_system := nullif(btrim(coalesce(p_product ->> 'source_system', '')), '');
  v_supplied_source_ref := nullif(btrim(coalesce(p_product ->> 'source_ref', '')), '');

  -- Fingerprint every input that changes the outcome, but not the
  -- idempotency key itself (it identifies the operation, it is not part
  -- of its payload). UNCHANGED from the original migration - p_product's
  -- full JSON text already includes any slug/source_system/source_ref
  -- keys a caller supplies, so no fingerprint change was needed for this
  -- amendment.
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
    --
    -- Post-review amendment (unchanged, verified, tested): this branch
    -- still never references slug/source_system/source_ref at all, even
    -- if a caller supplies those keys in p_product for an
    -- already-linked product - canonical provenance of an existing
    -- commerce product is never casually rewritten by an onboarding
    -- call, only set once at creation.
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

    -- ---- Slug: supplied (canonical) vs. generated (unchanged) --------
    if v_supplied_slug is not null then
      -- Post-review amendment: a caller (e.g. a migration importer) may
      -- supply an exact canonical slug for a NEW commerce product. Used
      -- exactly as supplied - trimmed above, never silently renamed or
      -- numeric-suffixed - and independently validated against the same
      -- format commerce.products' own CHECK constraint enforces, so a
      -- bad value fails with a clear onboarding-specific error instead
      -- of a raw constraint violation surfacing from the INSERT below.
      if v_supplied_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
        raise exception using errcode = 'P0001', message =
          format('ONBOARD_SLUG_INVALID: supplied slug "%s" does not match the required format (lowercase alphanumeric segments separated by single hyphens)', v_supplied_slug);
      end if;
      if exists (select 1 from commerce.products where tenant_id = v_tenant_id and slug = v_supplied_slug) then
        raise exception using errcode = 'P0001', message =
          format('ONBOARD_SLUG_COLLISION: slug "%s" is already used by another commerce product for this tenant - not auto-suffixed for a caller-supplied slug', v_supplied_slug);
      end if;
      v_slug := v_supplied_slug;
    else
      -- Unchanged from the original migration - every existing caller
      -- that omits slug keeps getting a name-derived slug with a
      -- numeric suffix on collision, exactly as before.
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
    end if;

    -- ---- source_system / source_ref: supplied vs. default (unchanged) ----
    -- Post-review amendment: a caller may independently supply either or
    -- both. Omitting either preserves the exact original default for
    -- that one field - a caller that supplies neither (every existing
    -- XOS onboarding consumer) gets source_system = 'xos_onboarding',
    -- source_ref = the idempotency key, byte-for-byte as before.
    v_final_source_system := coalesce(v_supplied_source_system, 'xos_onboarding');
    v_final_source_ref := coalesce(v_supplied_source_ref, p_idempotency_key);

    -- Pre-check for a clear error (the common case); the INSERT below is
    -- additionally wrapped for the rare concurrent-claim race, since
    -- pg_advisory_xact_lock above only serializes calls sharing the SAME
    -- idempotency key, not two different keys racing for the same
    -- caller-supplied slug/source identity.
    if exists (
      select 1 from commerce.products
      where tenant_id = v_tenant_id
        and source_system = v_final_source_system
        and source_ref = v_final_source_ref
    ) then
      raise exception using errcode = 'P0001', message =
        format('ONBOARD_SOURCE_IDENTITY_COLLISION: source identity (%s, %s) is already used by another commerce product for this tenant - not silently reused or overwritten', v_final_source_system, v_final_source_ref);
    end if;

    begin
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
        v_final_source_system, v_final_source_ref
      )
      returning id into v_commerce_product_id;
    exception when unique_violation then
      -- Post-review amendment (race classification fix): the pre-checks
      -- above already distinguish ONBOARD_SLUG_COLLISION from
      -- ONBOARD_SOURCE_IDENTITY_COLLISION for the common case; this
      -- handler only fires for the rare concurrent race where a second
      -- request claims the same slug or source identity between the
      -- pre-check and this INSERT (pg_advisory_xact_lock only serializes
      -- calls sharing the SAME idempotency key, not two different keys
      -- racing for the same caller-supplied identity). GET STACKED
      -- DIAGNOSTICS reports the actual violated index/constraint name -
      -- for a unique_violation this is populated from the underlying
      -- index regardless of whether it was declared as an inline table
      -- CONSTRAINT (commerce_products_tenant_slug_unique) or a standalone
      -- CREATE UNIQUE INDEX (commerce_products_tenant_source_ref_unique)
      -- - so the two race outcomes are classified exactly as precisely
      -- as the pre-checks are, never conflated into one message. Any
      -- OTHER unique_violation (a constraint this function does not
      -- know about) is neither silently swallowed nor mislabeled as
      -- slug/source-identity - it gets its own generic, non-leaking code.
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'commerce_products_tenant_source_ref_unique' then
        raise exception using errcode = 'P0001', message =
          format('ONBOARD_SOURCE_IDENTITY_COLLISION: source identity (%s, %s) was claimed by a concurrent request', v_final_source_system, v_final_source_ref);
      elsif v_constraint_name = 'commerce_products_tenant_slug_unique' then
        raise exception using errcode = 'P0001', message =
          format('ONBOARD_SLUG_COLLISION: slug "%s" was claimed by a concurrent request', v_slug);
      else
        raise exception using errcode = 'P0001', message = 'ONBOARD_UNIQUE_COLLISION: a concurrent request claimed a conflicting identity';
      end if;
    end;
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

-- Grants unchanged from the original migration - restated explicitly so
-- this migration's own intent is self-contained and auditable.
revoke all on function public.admin_onboard_client_commerce_product(uuid, jsonb, jsonb, uuid, uuid, uuid, text) from public;
revoke all on function public.admin_onboard_client_commerce_product(uuid, jsonb, jsonb, uuid, uuid, uuid, text) from anon;
grant execute on function public.admin_onboard_client_commerce_product(uuid, jsonb, jsonb, uuid, uuid, uuid, text) to authenticated;
