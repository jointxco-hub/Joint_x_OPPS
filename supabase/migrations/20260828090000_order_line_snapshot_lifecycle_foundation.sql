-- Order Line Coherence Phase 1C/D — Snapshot Lifecycle Foundation.
-- Combined backend foundation: revision identity/schema, the current-row
-- constraint/index, the revision RPC, and the atomic line-duplication RPC.
-- No customer-facing change, no XOS/PayFast intersection.
--
-- Revision-lineage identity (audited before writing this migration - see
-- design return): source_product_component_id is nullable and its FK is
-- ON DELETE SET NULL, so it cannot safely anchor "one current row per
-- logical component" - two independently-orphaned components would both
-- go NULL and never collide under ordinary UNIQUE semantics. A live audit
-- confirmed 0 of 18 existing snapshots currently have a null source (every
-- write path always resolves/creates a real product_components row first),
-- but the column remains genuinely nullable by design (its ON DELETE SET
-- NULL exists specifically so a snapshot survives its source component
-- being deleted later), so relying on it for uniqueness would silently
-- stop working the day that first happens. component_revision_key is a
-- fresh, independent uuid instead: every revision of one logical component
-- shares it; a duplicated line's cloned snapshots each get a BRAND NEW key
-- (never copied from the source), since a duplicate starts its own history,
-- not revision N of the source line's.
--
-- Revision model (append/supersede, matches the existing
-- client_product_artwork is_current+revision pattern exactly - not a new
-- convention): a correction never UPDATEs the frozen row. It locks the
-- current row, inserts a new row sharing the same component_revision_key
-- with revision+1, flips the old row's is_current to false and
-- superseded_by to the new row's id. authenticated still has no UPDATE/
-- DELETE grant on this table at all - immutability is enforced at the
-- grant level, and stays that way; only this SECURITY DEFINER RPC can
-- perform the controlled flip.
--
-- Duplication idempotency (audited before writing - see design return): a
-- separate ledger table isn't needed. The client generates p_new_line_id
-- once (crypto.randomUUID(), the same lazy-initializer pattern already
-- used for every duplicate-modal idempotency key this session) and it
-- doubles as both the target line id AND the idempotency key - "does
-- orders.products already contain this line_id" is itself the replay
-- check. Existence alone is not enough proof of a legitimate replay
-- (a reused target id against a different source is unsafe), so every
-- duplicated line is stamped with duplicated_from_line_id - a replay is
-- only accepted when that provenance field matches the incoming source id
-- exactly; any other mismatch raises an explicit conflict rather than
-- silently treating it as done.

begin;

-- ---------------------------------------------------------------------
-- 1. Revision columns + current-row index
-- ---------------------------------------------------------------------

alter table public.order_line_component_snapshots
  add column is_current boolean not null default true,
  add column revision integer not null default 1,
  add column superseded_by uuid references public.order_line_component_snapshots(id) on delete set null,
  add column component_revision_key uuid not null default gen_random_uuid();

-- Constant defaults (is_current/revision/superseded_by) are metadata-only;
-- gen_random_uuid() is volatile so Postgres rewrites the table to give
-- each of the (currently 18) existing rows its own fresh, independent
-- lineage-root key - correct, since every existing row is a first-ever
-- revision with nothing to link to. Non-destructive: no existing value is
-- lost or altered.

alter table public.order_line_component_snapshots
  drop constraint order_line_component_snapshot_order_id_line_id_source_produ_key;

create unique index order_line_component_snapshots_current_uidx
  on public.order_line_component_snapshots (order_id, line_id, component_revision_key)
  where is_current;

-- ---------------------------------------------------------------------
-- 2. revise_order_line_component_snapshot
-- ---------------------------------------------------------------------

create or replace function public.revise_order_line_component_snapshot(
  p_snapshot_id uuid,
  p_label text,
  p_placement text,
  p_production_method text,
  p_production_colour text,
  p_specification text,
  p_production_instructions text,
  p_sell_price numeric,
  p_billing_mode text
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
  v_old public.order_line_component_snapshots;
  v_new public.order_line_component_snapshots;
  v_old_tracking public.order_line_production_tracking;
  v_current_count integer;
  v_new_label text;
  v_new_placement text;
  v_new_production_method text;
  v_new_production_colour text;
  v_new_specification text;
  v_new_production_instructions text;
  v_new_sell_price numeric;
  v_new_billing_mode text;
  v_changed_fields jsonb;
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
    raise exception 'SNAPSHOT_REVISION_ACTOR_UNRESOLVED: authenticated user does not resolve to a valid OPPS staff identity';
  end if;

  -- ── 2. Validate required id / editable-field constraints ────────────
  if p_snapshot_id is null then
    raise exception 'SNAPSHOT_REVISION_SNAPSHOT_ID_REQUIRED: p_snapshot_id is required';
  end if;
  if p_billing_mode is not null and p_billing_mode not in ('per_unit', 'once_per_order') then
    raise exception 'SNAPSHOT_REVISION_INVALID_BILLING_MODE: % is not a recognized billing mode', p_billing_mode;
  end if;
  if p_sell_price is not null and p_sell_price < 0 then
    raise exception 'SNAPSHOT_REVISION_INVALID_SELL_PRICE: sell_price must be >= 0';
  end if;

  -- ── 3. Lock the current snapshot - this is the ONLY read of it, so
  -- authorization, the integrity checks, and the fields copied into the
  -- revision all observe the identical locked row ─────────────────────
  select * into v_old from public.order_line_component_snapshots where id = p_snapshot_id for update;
  if not found then
    raise exception 'SNAPSHOT_REVISION_NOT_FOUND: snapshot % does not exist', p_snapshot_id;
  end if;

  -- ── 4. Authorize (matches this table's own RLS policy exactly) ──────
  if not public.is_opps_staff() then
    raise exception 'SNAPSHOT_REVISION_FORBIDDEN: no staff access';
  end if;

  -- ── 5. Concurrent-revision protection: a second racing call blocks on
  -- the FOR UPDATE above until the first commits, then observes
  -- is_current = false here and is rejected explicitly - never two
  -- current successors for one component ──────────────────────────────
  if not v_old.is_current then
    raise exception 'SNAPSHOT_REVISION_STALE: this component was already revised by someone else - reload and try again';
  end if;

  -- ── 6. Order/line/tenant integrity - explicit assertion, not just
  -- reliance on the partial unique index ───────────────────────────────
  if v_old.order_id is null or v_old.tenant_id is null or v_old.line_id is null then
    raise exception 'SNAPSHOT_REVISION_INTEGRITY_VIOLATION: snapshot % is missing required order/tenant/line linkage', p_snapshot_id;
  end if;
  select count(*) into v_current_count
  from public.order_line_component_snapshots
  where component_revision_key = v_old.component_revision_key and is_current;
  if v_current_count <> 1 then
    raise exception 'SNAPSHOT_REVISION_INTEGRITY_VIOLATION: expected exactly one current row for this component, found %', v_current_count;
  end if;

  -- NULL contract for this RPC version: a null parameter means "leave this
  -- field unchanged", NOT "clear it" - every editable field falls back to
  -- v_old's own value via coalesce. The effective value is computed ONCE
  -- here, into v_new_*, and that same value is used both for what actually
  -- gets persisted below AND for the changed_fields audit diff - never
  -- computed from the raw incoming params, which would let a null
  -- parameter (silently preserving the old value) still log a false
  -- before/after diff against something that never actually changed. If
  -- staff ever need to intentionally clear a nullable field, that needs an
  -- explicit distinct clear mechanism in a later phase - null is not
  -- overloaded to mean that here.
  v_new_label := coalesce(p_label, v_old.label);
  v_new_placement := coalesce(p_placement, v_old.placement);
  v_new_production_method := coalesce(p_production_method, v_old.production_method);
  v_new_production_colour := coalesce(p_production_colour, v_old.production_colour);
  v_new_specification := coalesce(p_specification, v_old.specification);
  v_new_production_instructions := coalesce(p_production_instructions, v_old.production_instructions);
  v_new_sell_price := coalesce(p_sell_price, v_old.sell_price);
  v_new_billing_mode := coalesce(p_billing_mode, v_old.billing_mode);

  v_changed_fields := jsonb_strip_nulls(jsonb_build_object(
    'label', case when v_new_label is distinct from v_old.label then jsonb_build_object('before', v_old.label, 'after', v_new_label) end,
    'placement', case when v_new_placement is distinct from v_old.placement then jsonb_build_object('before', v_old.placement, 'after', v_new_placement) end,
    'production_method', case when v_new_production_method is distinct from v_old.production_method then jsonb_build_object('before', v_old.production_method, 'after', v_new_production_method) end,
    'production_colour', case when v_new_production_colour is distinct from v_old.production_colour then jsonb_build_object('before', v_old.production_colour, 'after', v_new_production_colour) end,
    'specification', case when v_new_specification is distinct from v_old.specification then jsonb_build_object('before', v_old.specification, 'after', v_new_specification) end,
    'production_instructions', case when v_new_production_instructions is distinct from v_old.production_instructions then jsonb_build_object('before', v_old.production_instructions, 'after', v_new_production_instructions) end,
    'sell_price', case when v_new_sell_price is distinct from v_old.sell_price then jsonb_build_object('before', v_old.sell_price, 'after', v_new_sell_price) end,
    'billing_mode', case when v_new_billing_mode is distinct from v_old.billing_mode then jsonb_build_object('before', v_old.billing_mode, 'after', v_new_billing_mode) end
  ));

  -- ── 7. Three-step ordering, deliberately: (a) insert the new row
  -- NON-current first - the superseded_by FK requires the target row to
  -- already exist, so it cannot be set on the old row before the new row
  -- is inserted; inserting the new row as non-current also avoids
  -- colliding with the still-current old row under the partial unique
  -- index; (b) mark the old row non-current and point its superseded_by
  -- at the now-existing new row; (c) promote the new row to current -
  -- by this point the old row is already non-current, so exactly one
  -- current row exists for this component_revision_key at every step.
  -- Still no UPDATE grant to authenticated - all of this happens only
  -- inside this SECURITY DEFINER function. ─────────────────────────────
  insert into public.order_line_component_snapshots (
    id, tenant_id, order_id, line_id, client_product_id, source_product_component_id,
    component_type, label, production_method, placement, production_colour, specification,
    production_instructions, sell_price, billing_mode, quantity_per_unit, sort_order,
    inventory_product_id, resolved_inventory_variant_id, artwork_revision_ids, notes,
    created_by, snapshot_taken_at, created_at,
    is_current, revision, superseded_by, component_revision_key
  ) values (
    gen_random_uuid(), v_old.tenant_id, v_old.order_id, v_old.line_id, v_old.client_product_id, v_old.source_product_component_id,
    v_old.component_type,
    v_new_label,
    v_new_production_method,
    v_new_placement,
    v_new_production_colour,
    v_new_specification,
    v_new_production_instructions,
    v_new_sell_price,
    v_new_billing_mode,
    v_old.quantity_per_unit, v_old.sort_order,
    v_old.inventory_product_id, v_old.resolved_inventory_variant_id, v_old.artwork_revision_ids, v_old.notes,
    v_actor_uid, now(), now(),
    false, v_old.revision + 1, null, v_old.component_revision_key
  )
  returning * into v_new;

  update public.order_line_component_snapshots
  set is_current = false, superseded_by = v_new.id
  where id = v_old.id;

  update public.order_line_component_snapshots
  set is_current = true
  where id = v_new.id
  returning * into v_new;

  -- ── 9. Carry current tracking state forward by INSERTING a new
  -- tracking row against the new snapshot - old tracking is left
  -- untouched, still attached to the now-superseded snapshot, for audit.
  -- If production_stage currently reads a completed stage, the new row
  -- correctly starts at that same completed stage - intentional, not
  -- reset, so in-progress stage/method state is never lost just because
  -- staff corrected the underlying spec. ───────────────────────────────
  select * into v_old_tracking from public.order_line_production_tracking where order_line_component_snapshot_id = v_old.id;
  if found then
    insert into public.order_line_production_tracking (
      id, tenant_id, order_id, line_id, order_line_component_snapshot_id,
      production_method, production_stage, inventory_supplier_variant_id, quantity_allocated, notes,
      created_by, created_at, updated_at
    ) values (
      gen_random_uuid(), v_old_tracking.tenant_id, v_old_tracking.order_id, v_old_tracking.line_id, v_new.id,
      v_old_tracking.production_method, v_old_tracking.production_stage, v_old_tracking.inventory_supplier_variant_id, v_old_tracking.quantity_allocated, v_old_tracking.notes,
      v_actor_uid, now(), now()
    );
  end if;

  -- ── 10. Activity event - actor, changed-field before/after diff ─────
  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_old.tenant_id, v_actor_email, v_actor_name, 'production_revision', 'orders', v_old.order_id,
    format('%s revised production configuration for line %s (%s)', coalesce(v_actor_name, 'Staff'), v_old.line_id, coalesce(v_old.label, v_old.component_type)),
    jsonb_build_object(
      'old_snapshot_id', v_old.id,
      'new_snapshot_id', v_new.id,
      'line_id', v_old.line_id,
      'revision', v_new.revision,
      'changed_fields', v_changed_fields
    )
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'snapshot', to_jsonb(v_new),
    'activity_event_id', v_event_id
  );
end;
$function$;

revoke execute on function public.revise_order_line_component_snapshot(uuid, text, text, text, text, text, text, numeric, text) from public, anon;
grant execute on function public.revise_order_line_component_snapshot(uuid, text, text, text, text, text, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. duplicate_order_line_with_snapshots
-- ---------------------------------------------------------------------

create or replace function public.duplicate_order_line_with_snapshots(
  p_order_id uuid,
  p_source_line_id text,
  p_new_line_id text
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
  v_order public.orders;
  v_products jsonb;
  v_source_line jsonb;
  v_source_line_count integer;
  v_target_line jsonb;
  v_target_line_count integer;
  v_new_line jsonb;
  v_cloned_count integer;
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
    raise exception 'ORDER_LINE_DUPLICATION_ACTOR_UNRESOLVED: authenticated user does not resolve to a valid OPPS staff identity';
  end if;

  -- ── 2. Validate required ids ─────────────────────────────────────────
  if p_source_line_id is null or btrim(p_source_line_id) = '' then
    raise exception 'ORDER_LINE_DUPLICATION_SOURCE_REQUIRED: p_source_line_id is required';
  end if;
  if p_new_line_id is null or btrim(p_new_line_id) = '' then
    raise exception 'ORDER_LINE_DUPLICATION_TARGET_REQUIRED: p_new_line_id is required';
  end if;
  if p_source_line_id = p_new_line_id then
    raise exception 'ORDER_LINE_DUPLICATION_SOURCE_EQUALS_TARGET: source and target line ids must differ';
  end if;

  -- ── 3. Lock the order on its first/only authoritative read - the
  -- order row IS the source, so there is no unlocked-then-relocked gap ─
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_LINE_DUPLICATION_ORDER_NOT_FOUND: order % does not exist', p_order_id;
  end if;

  -- ── 4. Authorize ─────────────────────────────────────────────────────
  if not public.is_opps_staff() then
    raise exception 'ORDER_LINE_DUPLICATION_FORBIDDEN: no staff access';
  end if;

  -- ── 5. Advisory lock, namespaced by order + target line id ──────────
  perform pg_advisory_xact_lock(hashtextextended('duplicate_order_line:' || p_order_id::text || ':' || p_new_line_id, 0));

  v_products := coalesce(v_order.products, '[]'::jsonb);

  -- ── 6. Exactly one source line must exist ────────────────────────────
  select count(*) into v_source_line_count
  from jsonb_array_elements(v_products) elem
  where elem->>'line_id' = p_source_line_id;
  if v_source_line_count = 0 then
    raise exception 'ORDER_LINE_DUPLICATION_SOURCE_NOT_FOUND: source line % does not exist on this order', p_source_line_id;
  elsif v_source_line_count > 1 then
    raise exception 'ORDER_LINE_DUPLICATION_SOURCE_AMBIGUOUS: source line % appears more than once on this order', p_source_line_id;
  end if;

  select elem into v_source_line
  from jsonb_array_elements(v_products) elem
  where elem->>'line_id' = p_source_line_id
  limit 1;

  -- ── 7. Idempotent replay / conflict check via provenance, not
  -- existence alone - a reused target id against a different source
  -- raises an explicit conflict rather than being silently accepted ───
  select count(*) into v_target_line_count
  from jsonb_array_elements(v_products) elem
  where elem->>'line_id' = p_new_line_id;

  if v_target_line_count > 0 then
    select elem into v_target_line
    from jsonb_array_elements(v_products) elem
    where elem->>'line_id' = p_new_line_id
    limit 1;

    if (v_target_line->>'duplicated_from_line_id') is not distinct from p_source_line_id then
      select count(*) into v_cloned_count
      from public.order_line_component_snapshots
      where order_id = p_order_id and line_id = p_new_line_id and is_current;
      return jsonb_build_object(
        'ok', true, 'replayed', true,
        'new_line_id', p_new_line_id,
        'cloned_component_count', v_cloned_count
      );
    else
      raise exception 'ORDER_LINE_DUPLICATION_IDEMPOTENCY_CONFLICT: target line id already exists with different provenance';
    end if;
  end if;

  -- ── 8. Genuine duplication - commercial line append + snapshot clone
  -- in the same transaction, atomic by construction ────────────────────
  v_new_line := v_source_line || jsonb_build_object('line_id', p_new_line_id, 'duplicated_from_line_id', p_source_line_id);

  update public.orders
  set products = v_products || jsonb_build_array(v_new_line), updated_at = now()
  where id = p_order_id;

  insert into public.order_line_component_snapshots (
    id, tenant_id, order_id, line_id, client_product_id, source_product_component_id,
    component_type, label, production_method, placement, production_colour, specification,
    production_instructions, sell_price, billing_mode, quantity_per_unit, sort_order,
    inventory_product_id, resolved_inventory_variant_id, artwork_revision_ids, notes,
    created_by, snapshot_taken_at, created_at,
    is_current, revision, superseded_by, component_revision_key
  )
  select
    gen_random_uuid(), tenant_id, order_id, p_new_line_id, client_product_id, source_product_component_id,
    component_type, label, production_method, placement, production_colour, specification,
    production_instructions, sell_price, billing_mode, quantity_per_unit, sort_order,
    inventory_product_id, resolved_inventory_variant_id, artwork_revision_ids, notes,
    v_actor_uid, now(), now(),
    true, 1, null, gen_random_uuid()
  from public.order_line_component_snapshots
  where order_id = p_order_id and line_id = p_source_line_id and is_current
  for update;

  get diagnostics v_cloned_count = row_count;

  -- Deliberately never touches order_line_production_tracking,
  -- inventory_variant_reservations, or any movement/completion-history
  -- table - a duplicate line starts fresh/unstarted by construction.

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_order.tenant_id, v_actor_email, v_actor_name, 'line_duplicated', 'orders', p_order_id,
    format('%s duplicated order line "%s" as "%s" (%s component(s))', coalesce(v_actor_name, 'Staff'), p_source_line_id, p_new_line_id, v_cloned_count),
    jsonb_build_object(
      'source_line_id', p_source_line_id,
      'new_line_id', p_new_line_id,
      'cloned_component_count', v_cloned_count
    )
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok', true, 'replayed', false,
    'new_line_id', p_new_line_id,
    'cloned_component_count', v_cloned_count,
    'activity_event_id', v_event_id
  );
end;
$function$;

revoke execute on function public.duplicate_order_line_with_snapshots(uuid, text, text) from public, anon;
grant execute on function public.duplicate_order_line_with_snapshots(uuid, text, text) to authenticated;

commit;
