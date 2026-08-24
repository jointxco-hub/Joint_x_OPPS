-- Phase 2B Step 2 — duplicate_garment_variant / duplicate_treatment.
-- RPC + schema only. No Catalog UI, no real SFR variants/treatments, no
-- X LAB, no basket, no size matrix, no PayFast.
--
-- Staff must be able to configure a garment variant or treatment once,
-- duplicate it, and change only what differs (SFR: 220gsm/Black ->
-- 300gsm/Black; White SFR Print -> Orange SFR Print, now also usable on
-- Black garments - no colour->print rule is encoded anywhere).
--
-- Copy semantics (approved):
--   Garment variant duplication: copies variant fields, copies only
--   variant-scoped product_components, copies only ACTIVE treatment
--   mappings, never duplicates treatment records, never touches artwork.
--   Treatment duplication: copies treatment fields, copies only
--   treatment-scoped product_components, never copies artwork, never
--   copies variant mappings (a duplicated print colour does not
--   automatically inherit the source's allowed-garment list - White may
--   be allowed on Black+White while Orange, duplicated from White,
--   should start with an empty, deliberately-chosen allowed set).
--
-- Idempotency (approved, mandatory key, no new ledger table): reuses the
-- most mature existing pattern in this codebase
-- (admin_provision_managed_brand / xos 3b onboarding) -
-- pg_advisory_xact_lock keyed by <operation>:<tenant_id>:<idempotency_
-- key> acquired BEFORE the replay check, so a genuine concurrent replay
-- blocks and then correctly sees the first call's result rather than
-- racing it; a request_fingerprint (source id + target family + the
-- NORMALIZED target name - never mutable source-row contents, so a
-- request replayed after the source has since changed still returns the
-- original result rather than a false conflict) stored alongside the key
-- on the created row itself (no separate ledger table needed - the
-- variant/treatment row IS the natural result to return).
--
-- Source-snapshot consistency (audited, see design return): the source
-- variant/treatment row is re-selected FOR UPDATE immediately before the
-- actual clone work, and both clone INSERT ... SELECT statements append
-- FOR UPDATE to their own source-reading SELECT. This is narrow (row-
-- level only, only the specific source's own rows, no table lock, no
-- unrelated product blocked) but structurally closes both risk classes
-- for the duration of the clone: (a) FOR UPDATE on the source row itself
-- blocks a concurrent edit to the variant/treatment's own fields (an
-- UPDATE needs a conflicting lock on that row); (b) it ALSO blocks any
-- concurrent INSERT of a NEW product_components/client_product_variant_
-- treatments row referencing that source, because Postgres automatically
-- acquires a FOR KEY SHARE lock on a referenced parent row when
-- inserting a referencing child row, and FOR KEY SHARE conflicts with
-- FOR UPDATE. Locking the components/mappings themselves as they're read
-- for cloning closes the remaining gap (a concurrent UPDATE to an
-- EXISTING component/mapping's own fields, which doesn't touch the
-- parent row at all). product_components has no DELETE grant for
-- authenticated at all (confirmed live), so concurrent deletion of a
-- component is not a real code path to guard against. This is not full
-- REPEATABLE READ isolation for the whole transaction - that was
-- evaluated and is incompatible with the mandated step order (actor
-- resolution, a real read, must happen first, and Postgres requires
-- SET TRANSACTION ISOLATION LEVEL before any query in the transaction) -
-- but it is sufficient to guarantee one coherent source configuration is
-- cloned, not a hybrid of two states.

begin;

-- ---------------------------------------------------------------------
-- 1. Idempotency columns + tenant-scoped uniqueness (mirrors
-- inventory_variant_reservations' inline pattern, not a new ledger
-- table - the created variant/treatment row IS the result).
-- ---------------------------------------------------------------------

alter table public.client_product_garment_variants
  add column idempotency_key text,
  add column request_fingerprint text;

create unique index client_product_garment_variants_idempotency_uidx
  on public.client_product_garment_variants (tenant_id, idempotency_key)
  where idempotency_key is not null;

alter table public.client_product_treatments
  add column idempotency_key text,
  add column request_fingerprint text;

create unique index client_product_treatments_idempotency_uidx
  on public.client_product_treatments (tenant_id, idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------
-- 2. Active-name uniqueness, normalized (case/whitespace-insensitive for
-- the active-collision check only; inactive historical duplicates
-- remain allowed), plus a non-blank guard on the raw name itself.
-- ---------------------------------------------------------------------

alter table public.client_product_garment_variants
  add constraint client_product_garment_variants_name_not_blank check (btrim(name) <> '');
create unique index client_product_garment_variants_active_name_uidx
  on public.client_product_garment_variants (client_product_id, lower(btrim(name)))
  where is_active;

alter table public.client_product_treatments
  add constraint client_product_treatments_name_not_blank check (btrim(name) <> '');
create unique index client_product_treatments_active_name_uidx
  on public.client_product_treatments (client_product_id, lower(btrim(name)))
  where is_active;

-- ---------------------------------------------------------------------
-- 3. duplicate_garment_variant
-- ---------------------------------------------------------------------

create or replace function public.duplicate_garment_variant(
  p_source_variant_id uuid,
  p_target_client_product_id uuid,
  p_target_name text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor_uid uuid;
  v_actor_email text;
  v_actor_name text;
  v_source public.client_product_garment_variants;
  v_source_locked public.client_product_garment_variants;
  v_target_family public.client_products;
  v_target_name text;
  v_fingerprint text;
  v_existing public.client_product_garment_variants;
  v_new public.client_product_garment_variants;
  v_component_count integer;
  v_mapping_count integer;
  v_event_id uuid;
begin
  -- ── 1. Resolve actor ────────────────────────────────────────────────
  v_actor_uid := auth.uid();
  select u.user_email, u.full_name into v_actor_email, v_actor_name
  from public.users u
  where u.auth_user_id = v_actor_uid and coalesce(u.is_active, true)
  order by u.created_at asc
  limit 1;
  if v_actor_email is null then
    raise exception 'GARMENT_VARIANT_CLONE_ACTOR_UNRESOLVED: authenticated user does not resolve to a valid OPPS staff identity';
  end if;

  -- ── 2. Validate required key/name ───────────────────────────────────
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'GARMENT_VARIANT_CLONE_IDEMPOTENCY_KEY_REQUIRED: p_idempotency_key is required';
  end if;
  if p_target_name is null or btrim(p_target_name) = '' then
    raise exception 'GARMENT_VARIANT_CLONE_TARGET_NAME_REQUIRED: p_target_name is required';
  end if;
  v_target_name := btrim(p_target_name);

  -- ── 3. Resolve source (unlocked - authorization/idempotency reads only) ──
  select * into v_source from public.client_product_garment_variants where id = p_source_variant_id;
  if not found then
    raise exception 'GARMENT_VARIANT_CLONE_SOURCE_NOT_FOUND: source variant % does not exist', p_source_variant_id;
  end if;

  -- ── 4. Authorize source tenant ──────────────────────────────────────
  if not public.inventory_can_review_tenant(v_source.tenant_id) then
    raise exception 'GARMENT_VARIANT_CLONE_FORBIDDEN: no reviewer access to source tenant';
  end if;

  -- ── 5. Advisory lock: <operation>:<tenant>:<key>, so identical keys in
  -- unrelated tenants never serialize against each other ──────────────
  perform pg_advisory_xact_lock(hashtextextended('duplicate_garment_variant:' || v_source.tenant_id::text || ':' || p_idempotency_key, 0));

  -- ── 6. Idempotent replay / conflict check ───────────────────────────
  -- Fingerprint represents immutable REQUEST intent only (source id,
  -- target family, normalized target name) - never mutable source-row
  -- contents, so replaying the same request after the source has since
  -- changed still returns the original result, not a false conflict.
  v_fingerprint := md5(p_source_variant_id::text || '|' || p_target_client_product_id::text || '|' || v_target_name);

  select * into v_existing
  from public.client_product_garment_variants
  where tenant_id = v_source.tenant_id and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'GARMENT_VARIANT_CLONE_IDEMPOTENCY_CONFLICT: idempotency key already used with a different request';
    end if;
    select count(*) into v_component_count from public.product_components where garment_variant_id = v_existing.id;
    select count(*) into v_mapping_count from public.client_product_variant_treatments where garment_variant_id = v_existing.id;
    return jsonb_build_object(
      'ok', true, 'replayed', true,
      'variant', to_jsonb(v_existing),
      'cloned_component_count', v_component_count,
      'cloned_mapping_count', v_mapping_count
    );
  end if;

  -- ── 7. Resolve/authorize target family ──────────────────────────────
  select * into v_target_family from public.client_products where id = p_target_client_product_id;
  if not found then
    raise exception 'GARMENT_VARIANT_CLONE_TARGET_NOT_FOUND: target client_product % does not exist', p_target_client_product_id;
  end if;
  if v_target_family.tenant_id is null or not public.inventory_can_review_tenant(v_target_family.tenant_id) then
    raise exception 'GARMENT_VARIANT_CLONE_FORBIDDEN: no reviewer access to target tenant';
  end if;

  -- ── 8. Same-tenant / same-family (v1) validation ────────────────────
  if v_source.tenant_id is distinct from v_target_family.tenant_id then
    raise exception 'GARMENT_VARIANT_CLONE_CROSS_TENANT: source and target must belong to the same tenant';
  end if;
  if v_source.client_product_id is distinct from p_target_client_product_id then
    raise exception 'GARMENT_VARIANT_CLONE_CROSS_FAMILY: v1 only supports duplicating within the same client product family';
  end if;

  -- ── 9. Clone, under the source-row lock ─────────────────────────────
  select * into v_source_locked
  from public.client_product_garment_variants
  where id = p_source_variant_id
  for update;

  insert into public.client_product_garment_variants (
    id, tenant_id, client_product_id, name, inventory_product_id, colour_name, colour_code,
    manual_available_sizes, price_override, sort_order, is_active, notes,
    created_by, created_at, updated_at, idempotency_key, request_fingerprint
  ) values (
    gen_random_uuid(), v_target_family.tenant_id, p_target_client_product_id, v_target_name,
    v_source_locked.inventory_product_id, v_source_locked.colour_name, v_source_locked.colour_code,
    v_source_locked.manual_available_sizes, v_source_locked.price_override, v_source_locked.sort_order,
    v_source_locked.is_active, v_source_locked.notes,
    v_actor_uid, now(), now(), p_idempotency_key, v_fingerprint
  )
  returning * into v_new;

  insert into public.product_components (
    id, tenant_id, client_product_id, component_type, production_method,
    placement, production_colour, specification, production_instructions,
    default_sell_price, quantity_per_unit, sort_order, inventory_product_id,
    fixed_inventory_variant_id, label, notes, is_active, created_by,
    created_at, updated_at, billing_mode, garment_variant_id, treatment_id
  )
  select
    gen_random_uuid(), v_target_family.tenant_id, p_target_client_product_id, component_type, production_method,
    placement, production_colour, specification, production_instructions,
    default_sell_price, quantity_per_unit, sort_order, inventory_product_id,
    fixed_inventory_variant_id, label, notes, is_active, v_actor_uid,
    now(), now(), billing_mode, v_new.id, null
  from public.product_components
  where garment_variant_id = p_source_variant_id
  for update of product_components;

  get diagnostics v_component_count = row_count;

  insert into public.client_product_variant_treatments (
    id, tenant_id, client_product_id, garment_variant_id, treatment_id, is_active, created_by, created_at
  )
  select
    gen_random_uuid(), v_target_family.tenant_id, p_target_client_product_id, v_new.id, treatment_id, is_active, v_actor_uid, now()
  from public.client_product_variant_treatments
  where garment_variant_id = p_source_variant_id and is_active
  for update of client_product_variant_treatments;

  get diagnostics v_mapping_count = row_count;

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_target_family.tenant_id, v_actor_email, v_actor_name, 'variant_duplicated', 'client_products', p_target_client_product_id,
    format('%s duplicated garment variant "%s" as "%s"', coalesce(v_actor_name, 'Staff'), v_source_locked.name, v_target_name),
    jsonb_build_object(
      'source_variant_id', p_source_variant_id,
      'new_variant_id', v_new.id,
      'source_client_product_id', v_source_locked.client_product_id,
      'cloned_component_count', v_component_count,
      'cloned_mapping_count', v_mapping_count
    )
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok', true, 'replayed', false,
    'variant', to_jsonb(v_new),
    'cloned_component_count', v_component_count,
    'cloned_mapping_count', v_mapping_count,
    'activity_event_id', v_event_id
  );
end;
$function$;

revoke execute on function public.duplicate_garment_variant(uuid, uuid, text, text) from public, anon;
grant execute on function public.duplicate_garment_variant(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. duplicate_treatment
-- ---------------------------------------------------------------------

create or replace function public.duplicate_treatment(
  p_source_treatment_id uuid,
  p_target_client_product_id uuid,
  p_target_name text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor_uid uuid;
  v_actor_email text;
  v_actor_name text;
  v_source public.client_product_treatments;
  v_source_locked public.client_product_treatments;
  v_target_family public.client_products;
  v_target_name text;
  v_fingerprint text;
  v_existing public.client_product_treatments;
  v_new public.client_product_treatments;
  v_component_count integer;
  v_event_id uuid;
begin
  -- ── 1. Resolve actor ────────────────────────────────────────────────
  v_actor_uid := auth.uid();
  select u.user_email, u.full_name into v_actor_email, v_actor_name
  from public.users u
  where u.auth_user_id = v_actor_uid and coalesce(u.is_active, true)
  order by u.created_at asc
  limit 1;
  if v_actor_email is null then
    raise exception 'TREATMENT_CLONE_ACTOR_UNRESOLVED: authenticated user does not resolve to a valid OPPS staff identity';
  end if;

  -- ── 2. Validate required key/name ───────────────────────────────────
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'TREATMENT_CLONE_IDEMPOTENCY_KEY_REQUIRED: p_idempotency_key is required';
  end if;
  if p_target_name is null or btrim(p_target_name) = '' then
    raise exception 'TREATMENT_CLONE_TARGET_NAME_REQUIRED: p_target_name is required';
  end if;
  v_target_name := btrim(p_target_name);

  -- ── 3. Resolve source ────────────────────────────────────────────────
  select * into v_source from public.client_product_treatments where id = p_source_treatment_id;
  if not found then
    raise exception 'TREATMENT_CLONE_SOURCE_NOT_FOUND: source treatment % does not exist', p_source_treatment_id;
  end if;

  -- ── 4. Authorize source tenant ──────────────────────────────────────
  if not public.inventory_can_review_tenant(v_source.tenant_id) then
    raise exception 'TREATMENT_CLONE_FORBIDDEN: no reviewer access to source tenant';
  end if;

  -- ── 5. Advisory lock ─────────────────────────────────────────────────
  perform pg_advisory_xact_lock(hashtextextended('duplicate_treatment:' || v_source.tenant_id::text || ':' || p_idempotency_key, 0));

  -- ── 6. Idempotent replay / conflict check ───────────────────────────
  v_fingerprint := md5(p_source_treatment_id::text || '|' || p_target_client_product_id::text || '|' || v_target_name);

  select * into v_existing
  from public.client_product_treatments
  where tenant_id = v_source.tenant_id and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'TREATMENT_CLONE_IDEMPOTENCY_CONFLICT: idempotency key already used with a different request';
    end if;
    select count(*) into v_component_count from public.product_components where treatment_id = v_existing.id;
    return jsonb_build_object(
      'ok', true, 'replayed', true,
      'treatment', to_jsonb(v_existing),
      'cloned_component_count', v_component_count,
      'artwork_copied', false,
      'mapping_copied', false
    );
  end if;

  -- ── 7. Resolve/authorize target family ──────────────────────────────
  select * into v_target_family from public.client_products where id = p_target_client_product_id;
  if not found then
    raise exception 'TREATMENT_CLONE_TARGET_NOT_FOUND: target client_product % does not exist', p_target_client_product_id;
  end if;
  if v_target_family.tenant_id is null or not public.inventory_can_review_tenant(v_target_family.tenant_id) then
    raise exception 'TREATMENT_CLONE_FORBIDDEN: no reviewer access to target tenant';
  end if;

  -- ── 8. Same-tenant / same-family (v1) validation ────────────────────
  if v_source.tenant_id is distinct from v_target_family.tenant_id then
    raise exception 'TREATMENT_CLONE_CROSS_TENANT: source and target must belong to the same tenant';
  end if;
  if v_source.client_product_id is distinct from p_target_client_product_id then
    raise exception 'TREATMENT_CLONE_CROSS_FAMILY: v1 only supports duplicating within the same client product family';
  end if;

  -- ── 9. Clone, under the source-row lock ─────────────────────────────
  select * into v_source_locked
  from public.client_product_treatments
  where id = p_source_treatment_id
  for update;

  insert into public.client_product_treatments (
    id, tenant_id, client_product_id, name, print_colour, production_method, primary_placement,
    print_size, surcharge, production_instructions, sort_order, is_active,
    created_by, created_at, updated_at, idempotency_key, request_fingerprint
  ) values (
    gen_random_uuid(), v_target_family.tenant_id, p_target_client_product_id, v_target_name,
    v_source_locked.print_colour, v_source_locked.production_method, v_source_locked.primary_placement,
    v_source_locked.print_size, v_source_locked.surcharge, v_source_locked.production_instructions,
    v_source_locked.sort_order, v_source_locked.is_active,
    v_actor_uid, now(), now(), p_idempotency_key, v_fingerprint
  )
  returning * into v_new;

  -- Never copies client_product_artwork - a new treatment starts with
  -- artwork intentionally pending, staff explicitly links/uploads the
  -- correct treatment-specific file afterward. Never copies variant
  -- mappings either - see the module header for why.
  insert into public.product_components (
    id, tenant_id, client_product_id, component_type, production_method,
    placement, production_colour, specification, production_instructions,
    default_sell_price, quantity_per_unit, sort_order, inventory_product_id,
    fixed_inventory_variant_id, label, notes, is_active, created_by,
    created_at, updated_at, billing_mode, garment_variant_id, treatment_id
  )
  select
    gen_random_uuid(), v_target_family.tenant_id, p_target_client_product_id, component_type, production_method,
    placement, production_colour, specification, production_instructions,
    default_sell_price, quantity_per_unit, sort_order, inventory_product_id,
    fixed_inventory_variant_id, label, notes, is_active, v_actor_uid,
    now(), now(), billing_mode, null, v_new.id
  from public.product_components
  where treatment_id = p_source_treatment_id
  for update of product_components;

  get diagnostics v_component_count = row_count;

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_target_family.tenant_id, v_actor_email, v_actor_name, 'treatment_duplicated', 'client_products', p_target_client_product_id,
    format('%s duplicated treatment "%s" as "%s"', coalesce(v_actor_name, 'Staff'), v_source_locked.name, v_target_name),
    jsonb_build_object(
      'source_treatment_id', p_source_treatment_id,
      'new_treatment_id', v_new.id,
      'source_client_product_id', v_source_locked.client_product_id,
      'cloned_component_count', v_component_count,
      'artwork_copied', false,
      'mapping_copied', false
    )
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok', true, 'replayed', false,
    'treatment', to_jsonb(v_new),
    'cloned_component_count', v_component_count,
    'artwork_copied', false,
    'mapping_copied', false,
    'activity_event_id', v_event_id
  );
end;
$function$;

revoke execute on function public.duplicate_treatment(uuid, uuid, text, text) from public, anon;
grant execute on function public.duplicate_treatment(uuid, uuid, text, text) to authenticated;

commit;
