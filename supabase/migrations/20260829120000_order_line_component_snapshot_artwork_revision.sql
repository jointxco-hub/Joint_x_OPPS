-- Order Line Coherence Phase 1E — placement-specific artwork relink.
--
-- Sibling to revise_order_line_component_snapshot (PR #49 /
-- 20260828090000_order_line_snapshot_lifecycle_foundation.sql). That RPC
-- revises the reusable production-config fields and carries
-- artwork_revision_ids forward VERBATIM - it has no artwork parameter,
-- deliberately, so the Edit Production modal can keep "artwork = a
-- read-only history field". This function is the ONLY controlled path
-- that changes which client_product_artwork revision(s) a frozen
-- production component points at, and it does so the exact same way
-- revise_order_line_component_snapshot changes anything else: never an
-- UPDATE of the frozen row (authenticated still has zero UPDATE/DELETE
-- grant on order_line_component_snapshots - unchanged here), but a new
-- appended revision sharing the same component_revision_key, with the old
-- row superseded.
--
-- Minimal by design (audited - see Phase 1E return):
--   * no new column - placement and artwork_revision_ids are already
--     per-snapshot-row, so Front and Back are already separate rows;
--     independence is structural, this function only has to avoid
--     rewriting the wrong row.
--   * no base-table grant change - the three-step supersede dance runs
--     only inside this SECURITY DEFINER function, same as the sibling.
--   * no change to find_or_create_client_product_artwork_from_asset
--     (202608220006) - the frontend still resolves an asset to a
--     client_product_artwork revision through that existing RPC first,
--     then hands the resulting revision id(s) here.
--
-- Front/Back independence as a SERVER-SIDE invariant: every supplied
-- artwork revision must belong to the SAME client_product_id as the
-- snapshot AND carry the SAME placement as the snapshot. A "Back" artwork
-- revision handed against the "Front" snapshot is rejected
-- (SNAPSHOT_ARTWORK_RELINK_PLACEMENT_MISMATCH), so a Front relink can
-- never touch Back's linkage and vice versa - not by UI convention, by
-- this check.
--
-- Treatment-scope compatibility: order_line_component_snapshots has no
-- treatment_id/garment_variant_id column (audited live) - a snapshot is
-- family-scoped by construction. So a treatment-scoped
-- client_product_artwork revision (treatment_id IS NOT NULL, the Phase 2B
-- namespace) is rejected here, mirroring ComponentFieldsForm's
-- allowArtworkLinking=false gating for scoped components. As defence in
-- depth, if the snapshot's source_product_component_id still resolves to
-- a component that is itself treatment- or variant-scoped, the relink is
-- also refused.
--
-- NULL/empty contract (explicit, per Phase 1E instruction): this phase
-- has NO unlink capability. p_artwork_revision_ids must contain at least
-- one non-null id. An empty or null array is a hard error
-- (SNAPSHOT_ARTWORK_RELINK_ARTWORK_REQUIRED), never silently interpreted
-- as "remove artwork" - clearing frozen production artwork needs its own
-- explicitly designed and tested mechanism in a later phase.
--
-- Optimistic concurrency: p_expected_revision must equal the current
-- row's revision. A mismatch - or the row no longer being is_current -
-- raises SNAPSHOT_REVISION_STALE (the exact same token the sibling RPC
-- and the frontend's stale-handling branch already use), so a stale relink
-- is never silently applied against an out-of-date snapshot id.

begin;

create or replace function public.revise_order_line_component_snapshot_artwork(
  p_snapshot_id uuid,
  p_artwork_revision_ids uuid[],
  p_expected_revision integer
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
  v_supplied_count integer;
  v_distinct_count integer;
  v_found_count integer;
  v_wrong_product integer;
  v_wrong_placement integer;
  v_treatment_scoped integer;
  v_scoped_component boolean;
  v_before_sorted uuid[];
  v_after_sorted uuid[];
  v_event_id uuid;
begin
  -- ── 1. Resolve actor (identical to revise_order_line_component_snapshot) ─
  v_actor_uid := auth.uid();
  select u.user_email, u.full_name into v_actor_email, v_actor_name
  from public.users u
  where u.auth_user_id = v_actor_uid and coalesce(u.is_active, true)
  order by u.created_at asc
  limit 1;
  if v_actor_email is null then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_ACTOR_UNRESOLVED: authenticated user does not resolve to a valid OPPS staff identity';
  end if;

  -- ── 2. Validate parameters ─────────────────────────────────────────
  if p_snapshot_id is null then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_SNAPSHOT_ID_REQUIRED: p_snapshot_id is required';
  end if;
  if p_expected_revision is null then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_EXPECTED_REVISION_REQUIRED: p_expected_revision is required for optimistic concurrency';
  end if;
  -- No unlink in this phase: an empty/null array is never "remove artwork".
  if p_artwork_revision_ids is null
     or array_length(p_artwork_revision_ids, 1) is null
     or array_length(p_artwork_revision_ids, 1) < 1 then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_ARTWORK_REQUIRED: at least one artwork revision must be supplied - clearing production artwork is not supported in this phase';
  end if;
  if exists (select 1 from unnest(p_artwork_revision_ids) x where x is null) then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_ARTWORK_REQUIRED: artwork revision ids must not contain null';
  end if;
  v_supplied_count := (select count(*) from unnest(p_artwork_revision_ids));
  v_distinct_count := (select count(distinct x) from unnest(p_artwork_revision_ids) x);
  if v_supplied_count <> v_distinct_count then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_DUPLICATE_ARTWORK: the same artwork revision id was supplied more than once';
  end if;

  -- ── 3. Lock the current snapshot - the ONLY read of it, so
  -- authorization, integrity checks, and the fields copied into the new
  -- revision all observe the identical locked row ────────────────────
  select * into v_old from public.order_line_component_snapshots where id = p_snapshot_id for update;
  if not found then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_NOT_FOUND: snapshot % does not exist', p_snapshot_id;
  end if;

  -- ── 4. Authorize (matches this table's RLS policy / the sibling RPC) ─
  if not public.is_opps_staff() then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_FORBIDDEN: no staff access';
  end if;

  -- ── 5. Concurrent-revision protection: a racing call blocks on the
  -- FOR UPDATE above, then observes is_current = false here ───────────
  if not v_old.is_current then
    raise exception 'SNAPSHOT_REVISION_STALE: this component was already revised by someone else - reload and try again';
  end if;

  -- ── 6. Order/line/tenant integrity - explicit assertion ────────────
  if v_old.order_id is null or v_old.tenant_id is null or v_old.line_id is null then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_INTEGRITY_VIOLATION: snapshot % is missing required order/tenant/line linkage', p_snapshot_id;
  end if;
  select count(*) into v_current_count
  from public.order_line_component_snapshots
  where component_revision_key = v_old.component_revision_key and is_current;
  if v_current_count <> 1 then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_INTEGRITY_VIOLATION: expected exactly one current row for this component, found %', v_current_count;
  end if;

  -- ── 7. Optimistic-concurrency check - explicit revision match ──────
  if v_old.revision <> p_expected_revision then
    raise exception 'SNAPSHOT_REVISION_STALE: expected revision % but this component is already at revision % - reload and try again', p_expected_revision, v_old.revision;
  end if;

  -- ── 8. Placement / family preconditions on the snapshot itself ─────
  if v_old.client_product_id is null then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_NO_CLIENT_PRODUCT: this snapshot is not linked to a client product - artwork cannot be validated against a family';
  end if;
  if v_old.placement is null or btrim(v_old.placement) = '' then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_NO_PLACEMENT: this component has no placement - placement-specific artwork cannot be linked';
  end if;

  -- ── 9. Validate every supplied artwork revision belongs to the same
  -- family, the same placement, and the family (not treatment) namespace.
  -- This is the Front/Back independence invariant: a revision carrying a
  -- different placement than the snapshot is rejected outright. ───────
  select
    count(*),
    count(*) filter (where a.client_product_id is distinct from v_old.client_product_id),
    count(*) filter (where a.placement is distinct from v_old.placement),
    count(*) filter (where a.treatment_id is not null)
  into v_found_count, v_wrong_product, v_wrong_placement, v_treatment_scoped
  from public.client_product_artwork a
  where a.id = any (p_artwork_revision_ids);

  if v_found_count <> v_supplied_count then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_ARTWORK_NOT_FOUND: one or more supplied artwork revision ids do not exist';
  end if;
  if v_wrong_product > 0 then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_CLIENT_PRODUCT_MISMATCH: an artwork revision belongs to a different client product than this component';
  end if;
  if v_wrong_placement > 0 then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_PLACEMENT_MISMATCH: an artwork revision is for a different placement than this component (%). Front and Back artwork stay independent', v_old.placement;
  end if;
  if v_treatment_scoped > 0 then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_TREATMENT_SCOPE_MISMATCH: this snapshot is family-scoped - treatment-scoped artwork cannot be linked in this phase';
  end if;

  -- ── 10. Defence in depth: refuse a relink when the snapshot's source
  -- component still resolves to a treatment- or variant-scoped row.
  -- Tolerates a deleted source (source_product_component_id may be null
  -- or dangling by design - ON DELETE SET NULL). ────────────────────
  if v_old.source_product_component_id is not null then
    select (pc.treatment_id is not null or pc.garment_variant_id is not null)
    into v_scoped_component
    from public.product_components pc
    where pc.id = v_old.source_product_component_id;
    if coalesce(v_scoped_component, false) then
      raise exception 'SNAPSHOT_ARTWORK_RELINK_SCOPED_COMPONENT: placement-specific artwork linking is not available for treatment/variant-scoped components in this phase';
    end if;
  end if;

  -- ── 11. No-op guard - a relink that resolves to the exact same set of
  -- revisions the component already points at writes nothing and is
  -- rejected, rather than spending a revision on no change. ──────────
  v_before_sorted := (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(v_old.artwork_revision_ids, '{}')) x);
  v_after_sorted := (select array_agg(x order by x) from unnest(p_artwork_revision_ids) x);
  if v_before_sorted = v_after_sorted then
    raise exception 'SNAPSHOT_ARTWORK_RELINK_NO_CHANGE: the selected artwork already matches this component''s current artwork';
  end if;

  -- ── 12. Three-step supersede dance - identical ordering to
  -- revise_order_line_component_snapshot. Every non-artwork field is
  -- copied verbatim from v_old; only artwork_revision_ids changes. ───
  insert into public.order_line_component_snapshots (
    id, tenant_id, order_id, line_id, client_product_id, source_product_component_id,
    component_type, label, production_method, placement, production_colour, specification,
    production_instructions, sell_price, billing_mode, quantity_per_unit, sort_order,
    inventory_product_id, resolved_inventory_variant_id, artwork_revision_ids, notes,
    created_by, snapshot_taken_at, created_at,
    is_current, revision, superseded_by, component_revision_key
  ) values (
    gen_random_uuid(), v_old.tenant_id, v_old.order_id, v_old.line_id, v_old.client_product_id, v_old.source_product_component_id,
    v_old.component_type, v_old.label, v_old.production_method, v_old.placement, v_old.production_colour, v_old.specification,
    v_old.production_instructions, v_old.sell_price, v_old.billing_mode, v_old.quantity_per_unit, v_old.sort_order,
    v_old.inventory_product_id, v_old.resolved_inventory_variant_id, p_artwork_revision_ids, v_old.notes,
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

  -- ── 13. Carry current tracking state forward by INSERTING a new
  -- tracking row against the new snapshot - old tracking is left
  -- untouched, still attached to the now-superseded snapshot, for audit.
  -- Identical to the sibling RPC: stage/method/allocation/notes are
  -- carried forward exactly, never reset. ──────────────────────────
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

  -- ── 14. One production_artwork_relink activity event with the
  -- before/after artwork revision id arrays. ──────────────────────
  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_old.tenant_id, v_actor_email, v_actor_name, 'production_artwork_relink', 'orders', v_old.order_id,
    format('%s relinked %s artwork for line %s (%s)', coalesce(v_actor_name, 'Staff'), v_old.placement, v_old.line_id, coalesce(v_old.label, v_old.component_type)),
    jsonb_build_object(
      'old_snapshot_id', v_old.id,
      'new_snapshot_id', v_new.id,
      'line_id', v_old.line_id,
      'placement', v_old.placement,
      'revision', v_new.revision,
      'artwork_revision_ids', jsonb_build_object(
        'before', to_jsonb(coalesce(v_old.artwork_revision_ids, '{}'::uuid[])),
        'after', to_jsonb(p_artwork_revision_ids)
      )
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

revoke execute on function public.revise_order_line_component_snapshot_artwork(uuid, uuid[], integer) from public, anon;
grant execute on function public.revise_order_line_component_snapshot_artwork(uuid, uuid[], integer) to authenticated;

commit;
