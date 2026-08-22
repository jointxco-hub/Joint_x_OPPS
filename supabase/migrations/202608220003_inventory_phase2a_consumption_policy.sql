-- Inventory Phase 2A — consumption policy fix.
--
-- Stage D live testing against production found two real defects in
-- inventory_consume_reservation:
--
--   1. Consumption succeeded against unverified stock
--      (balance_verified_at IS NULL) with no distinction at all -
--      contradicts the intended policy: a reservation may exist against
--      unverified stock, but physical consumption must not.
--
--   2. Insufficient physical stock was only blocked indirectly by the
--      inventory_variants.on_hand_qty >= 0 CHECK constraint, producing a
--      raw Postgres constraint-violation error rather than a clean,
--      catchable business-rule exception.
--
-- This migration replaces only inventory_consume_reservation to add two
-- explicit, ordered guards (unverified stock, then insufficient stock),
-- both checked with the variant row already locked, before any state
-- change - so a rejected call has zero side effects, same as every
-- other guard already proven in this RPC. The existing
-- on_hand_qty >= 0 CHECK constraint is left in place as defense-in-depth
-- only; it is no longer the user-facing enforcement mechanism.
--
-- INVENTORY_CONSUME_EXCEEDS_RESERVATION (the reservation-quantity
-- ceiling) is unchanged - still checked first, using only the
-- already-locked reservation row, before the variant is even touched.
--
-- Return type changes from the plain inventory_movements row to jsonb
-- (movement + quantity_consumed/total_consumed/remaining_quantity/
-- resulting_status/on_hand_qty/balance_verified_at), mirroring the same
-- contract improvement already made to inventory_reserve_variant in
-- 202608220002 - there are still zero production UI callers of this
-- RPC (confirmed again below before dropping), so this remains the safe
-- window to do it. Parameter signature is unchanged.
--
-- Does not touch 202608220001 or 202608220002. Does not touch the
-- reservation table schema. Does not implement rework/supplemental
-- reservations - see the header note above the function for the
-- confirmed, deferred gap.

drop function if exists public.inventory_consume_reservation(uuid, uuid, numeric, text, text);

create function public.inventory_consume_reservation(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_quantity numeric,
  p_movement_type text default 'order_pick',
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_reservation public.inventory_variant_reservations;
  v_variant public.inventory_variants;
  v_already_consumed numeric;
  v_before numeric;
  v_after numeric;
  v_movement public.inventory_movements;
  v_new_status text;
  v_remaining numeric;
  v_total_consumed numeric;
  v_actor_email text;
  v_actor_name text;
begin
  if not public.is_opps_staff() then
    raise exception 'INVENTORY_CONSUME_FORBIDDEN: staff access required';
  end if;
  if not public.can_access_tenant(p_tenant_id) then
    raise exception 'INVENTORY_CONSUME_FORBIDDEN: tenant access denied';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVENTORY_CONSUME_INVALID_QUANTITY: quantity must be positive';
  end if;
  if p_movement_type not in ('order_pick', 'damage', 'manual_adjust', 'return', 'count', 'receive', 'transfer') then
    raise exception 'INVENTORY_CONSUME_INVALID_MOVEMENT_TYPE: %', p_movement_type;
  end if;

  -- Server-derived actor identity only - see 202608220002 for why this
  -- lookup is guaranteed to find a row once is_opps_staff() has passed.
  select u.user_email, u.full_name into v_actor_email, v_actor_name
  from public.users u
  where u.auth_user_id = auth.uid() and coalesce(u.is_active, true)
  order by u.created_at asc
  limit 1;
  if v_actor_email is null then
    raise exception 'INVENTORY_ACTOR_UNRESOLVED: authenticated user does not resolve to a valid OPPS staff identity';
  end if;

  -- Lock order: reservation first, then variant - unchanged from the
  -- existing implementation, consistent across every RPC in this set.
  select * into v_reservation
  from public.inventory_variant_reservations
  where id = p_reservation_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'INVENTORY_CONSUME_NOT_FOUND: reservation does not exist for this tenant';
  end if;
  if v_reservation.status not in ('active', 'consumed') then
    raise exception 'INVENTORY_CONSUME_INVALID_STATE: reservation is % and cannot be consumed against', v_reservation.status;
  end if;

  -- Reservation-level ceiling, checked entirely from the already-locked
  -- reservation row and the movement ledger - unchanged, still first.
  select -coalesce(sum(quantity_delta), 0) into v_already_consumed
  from public.inventory_movements
  where related_reservation_id = v_reservation.id;

  if v_already_consumed + p_quantity > v_reservation.quantity then
    raise exception 'INVENTORY_CONSUME_EXCEEDS_RESERVATION: % already consumed of % reserved, cannot consume % more',
      v_already_consumed, v_reservation.quantity, p_quantity;
  end if;

  select * into v_variant
  from public.inventory_variants
  where id = v_reservation.inventory_variant_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'INVENTORY_CONSUME_VARIANT_NOT_FOUND';
  end if;

  -- Hard policy gate 1: a reservation may exist against unverified
  -- stock, but physical consumption must not. Checked with the variant
  -- row already locked, before any write.
  if v_variant.balance_verified_at is null then
    raise exception 'INVENTORY_CONSUME_UNVERIFIED_STOCK: variant % (%) has no verified physical balance - a stocktake must confirm on-hand quantity before it can be consumed',
      v_variant.internal_sku, v_variant.id;
  end if;

  -- Hard policy gate 2: a deliberate business-rule rejection, not
  -- reliance on the on_hand_qty >= 0 CHECK constraint (kept in place
  -- below as defense-in-depth only, no longer the user-facing check).
  if p_quantity > v_variant.on_hand_qty then
    raise exception 'INVENTORY_CONSUME_INSUFFICIENT_STOCK: requested % but only % on hand for variant % (%)',
      p_quantity, v_variant.on_hand_qty, v_variant.internal_sku, v_variant.id;
  end if;

  v_before := v_variant.on_hand_qty;
  v_after := v_before - p_quantity;

  update public.inventory_variants set on_hand_qty = v_after, updated_at = now() where id = v_variant.id;

  insert into public.inventory_movements (
    tenant_id, inventory_id, inventory_product_id, inventory_variant_id,
    movement_type, quantity_before, quantity_after, quantity_delta,
    related_order_id, related_reservation_id, reason, created_by, created_by_name
  ) values (
    p_tenant_id, null, v_variant.inventory_product_id, v_variant.id,
    p_movement_type, v_before, v_after, -p_quantity,
    v_reservation.order_id, v_reservation.id, p_reason, auth.uid(), v_actor_email
  )
  returning * into v_movement;

  v_total_consumed := v_already_consumed + p_quantity;
  v_remaining := v_reservation.quantity - v_total_consumed;
  v_new_status := case when v_total_consumed >= v_reservation.quantity then 'consumed' else v_reservation.status end;

  update public.inventory_variant_reservations
  set status = v_new_status, updated_at = now()
  where id = v_reservation.id;

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    p_tenant_id, v_actor_email, v_actor_name, 'inventory_reservation_consumed', 'inventory_variant_reservation', v_reservation.id,
    format('%s consumed %s x %s from reservation %s via %s', coalesce(v_actor_name, 'Staff'), p_quantity, v_variant.internal_sku, v_reservation.id, p_movement_type),
    jsonb_build_object(
      'tenant_id', p_tenant_id, 'order_id', v_reservation.order_id, 'line_id', v_reservation.line_id,
      'reservation_id', v_reservation.id, 'snapshot_id', v_reservation.order_line_component_snapshot_id,
      'inventory_variant_id', v_reservation.inventory_variant_id,
      'requested_quantity', p_quantity, 'reservation_quantity', v_reservation.quantity,
      'total_consumed', v_total_consumed, 'remaining_quantity', v_remaining, 'resulting_status', v_new_status,
      'movement_id', v_movement.id, 'movement_type', p_movement_type, 'reason', p_reason, 'actor', auth.uid(),
      'on_hand_before', v_before, 'on_hand_after', v_after
    )
  );

  return jsonb_build_object(
    'movement', to_jsonb(v_movement),
    'quantity_consumed', p_quantity,
    'total_consumed', v_total_consumed,
    'remaining_quantity', v_remaining,
    'resulting_status', v_new_status,
    'on_hand_qty', v_after,
    'balance_verified_at', v_variant.balance_verified_at
  );
end;
$$;

revoke all on function public.inventory_consume_reservation(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.inventory_consume_reservation(uuid, uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Confirmed, deferred gap (architecture note only - not implemented):
-- ---------------------------------------------------------------------
-- A reservation's quantity is a hard ceiling shared by every movement
-- type linked to it (order_pick, damage, ...). For "planned 2, one
-- damaged in production, actual 3 consumed" there is no legitimate way
-- for the 3rd unit to be consumed against the same reservation once the
-- first 2 are - INVENTORY_CONSUME_EXCEEDS_RESERVATION correctly blocks
-- it, on purpose. The future fix is an explicit, separately-approved
-- supplemental/rework reservation (its own row, its own lifecycle, its
-- own audit trail) - never a silent increase of the original
-- reservation's quantity, and never a bypass of this ceiling.
