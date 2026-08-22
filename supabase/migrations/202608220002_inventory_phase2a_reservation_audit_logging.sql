-- Inventory Phase 2A Stage B fix — reservation lifecycle audit logging.
--
-- Brings the four RPCs from 202608220001 into alignment with the
-- reviewed architecture: every state-changing operation must write an
-- opps_activity_events row in the SAME transaction as the inventory
-- state change, with no best-effort/try-catch around the audit insert -
-- if it fails, the whole operation rolls back.
--
-- Reuses the exact, pre-existing opps_activity_events table (see
-- 202606230002_operational_accountability.sql: id, tenant_id,
-- actor_email not null, actor_name, event_type not null, entity_type
-- not null, entity_id, summary not null, metadata jsonb, created_at) -
-- the same table and column shape OrderDrawer.jsx's
-- logOrderCorrectionEvent and ProductsEditor.jsx's logProductionActivity
-- already write to client-side. No existing RPC wrote to this table
-- from SQL before this migration (verified: zero matches for
-- 'opps_activity_events' in any function body) - this establishes the
-- SQL-side convention for the first time, using the identical naming
-- style (snake_case event_type, entity_type/entity_id, human-readable
-- summary, structured metadata) rather than inventing anything new.
--
-- Does NOT touch 202608220001's table/view/CHECK/RLS/grant definitions.
-- Does NOT touch the existing Medium pilot reservation
-- (2c6f2c2e-03c8-4017-b2e4-eea70de0fb1a) - it was created before this
-- fix existed and is intentionally left without a retroactive event; no
-- fabricated backfill event is created for it.

-- inventory_reserve_variant's return type changes from the plain
-- inventory_variant_reservations row to jsonb (reservation + a live
-- availability snapshot: stock_unverified/balance_verified_at/
-- on_hand_qty/reserved_qty/available_qty), so callers no longer have to
-- separately query the availability view to know if stock is
-- authoritative. There are no production UI callers of this RPC yet, so
-- this is the safe point to make the change. A return-type change
-- requires DROP + CREATE, not CREATE OR REPLACE.
drop function if exists public.inventory_reserve_variant(uuid, uuid, text, uuid, uuid, numeric, text);

create function public.inventory_reserve_variant(
  p_tenant_id uuid,
  p_order_id uuid,
  p_line_id text,
  p_snapshot_id uuid,
  p_inventory_variant_id uuid,
  p_quantity numeric,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_snapshot public.order_line_component_snapshots;
  v_variant public.inventory_variants;
  v_existing public.inventory_variant_reservations;
  v_result public.inventory_variant_reservations;
  v_order public.orders;
  v_actor_email text;
  v_actor_name text;
  v_avail_on_hand numeric;
  v_avail_verified_at timestamptz;
  v_avail_reserved numeric;
  v_avail_available numeric;
begin
  if not public.is_opps_staff() then
    raise exception 'INVENTORY_RESERVE_FORBIDDEN: staff access required';
  end if;
  if not public.can_access_tenant(p_tenant_id) then
    raise exception 'INVENTORY_RESERVE_FORBIDDEN: tenant access denied';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVENTORY_RESERVE_INVALID_QUANTITY: quantity must be positive';
  end if;

  select u.user_email, coalesce(u.full_name, u.user_email) into v_actor_email, v_actor_name
  from public.users u where u.auth_user_id = auth.uid();

  -- Idempotent replay: return the existing reservation - no new row, no
  -- new activity event. One logical reservation creation = one event.
  if p_idempotency_key is not null then
    select * into v_existing
    from public.inventory_variant_reservations
    where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
    if found then
      select on_hand_qty, balance_verified_at, reserved_qty, available_qty
      into v_avail_on_hand, v_avail_verified_at, v_avail_reserved, v_avail_available
      from public.inventory_variant_availability_v where inventory_variant_id = v_existing.inventory_variant_id;
      return jsonb_build_object(
        'reservation', to_jsonb(v_existing),
        'stock_unverified', v_avail_verified_at is null,
        'balance_verified_at', v_avail_verified_at,
        'on_hand_qty', v_avail_on_hand,
        'reserved_qty', v_avail_reserved,
        'available_qty', v_avail_available
      );
    end if;
  end if;

  select * into v_snapshot
  from public.order_line_component_snapshots
  where id = p_snapshot_id and order_id = p_order_id and line_id = p_line_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'INVENTORY_RESERVE_SNAPSHOT_MISMATCH: snapshot does not belong to this order/line/tenant';
  end if;
  if v_snapshot.inventory_product_id is null then
    raise exception 'INVENTORY_RESERVE_NOT_INVENTORY_BEARING: this component snapshot has no inventory identity to reserve against';
  end if;

  select * into v_variant
  from public.inventory_variants
  where id = p_inventory_variant_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'INVENTORY_RESERVE_VARIANT_NOT_FOUND: variant does not exist for this tenant';
  end if;
  if v_variant.inventory_product_id is distinct from v_snapshot.inventory_product_id then
    raise exception 'INVENTORY_RESERVE_IDENTITY_MISMATCH: variant does not belong to this component''s inventory product';
  end if;

  select * into v_order from public.orders where id = p_order_id;

  insert into public.inventory_variant_reservations (
    tenant_id, order_id, line_id, order_line_component_snapshot_id,
    inventory_variant_id, quantity, status, idempotency_key, created_by
  ) values (
    p_tenant_id, p_order_id, p_line_id, p_snapshot_id,
    p_inventory_variant_id, p_quantity, 'active', p_idempotency_key, auth.uid()
  )
  returning * into v_result;

  -- Same transaction as the state change above, no exception handling -
  -- if this insert fails (e.g. NOT NULL violation on actor_email), the
  -- reservation insert above rolls back with it.
  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    p_tenant_id, v_actor_email, v_actor_name, 'inventory_reservation_created', 'inventory_variant_reservation', v_result.id,
    format('%s reserved %s x %s for order %s (line %s)', coalesce(v_actor_name, 'Staff'), p_quantity, v_variant.internal_sku, coalesce(v_order.order_number, p_order_id::text), p_line_id),
    jsonb_build_object(
      'tenant_id', p_tenant_id, 'order_id', p_order_id, 'line_id', p_line_id,
      'reservation_id', v_result.id, 'snapshot_id', p_snapshot_id,
      'inventory_variant_id', p_inventory_variant_id, 'quantity', p_quantity, 'status', 'active',
      'idempotency_key', p_idempotency_key, 'actor', auth.uid(),
      'stock_unverified', v_variant.balance_verified_at is null, 'balance_verified_at', v_variant.balance_verified_at
    )
  );

  select on_hand_qty, balance_verified_at, reserved_qty, available_qty
  into v_avail_on_hand, v_avail_verified_at, v_avail_reserved, v_avail_available
  from public.inventory_variant_availability_v where inventory_variant_id = v_result.inventory_variant_id;

  return jsonb_build_object(
    'reservation', to_jsonb(v_result),
    'stock_unverified', v_avail_verified_at is null,
    'balance_verified_at', v_avail_verified_at,
    'on_hand_qty', v_avail_on_hand,
    'reserved_qty', v_avail_reserved,
    'available_qty', v_avail_available
  );
end;
$$;

create or replace function public.inventory_release_reservation(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_reason text default null
)
returns public.inventory_variant_reservations
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_reservation public.inventory_variant_reservations;
  v_previous_status text;
  v_consumed numeric;
  v_variant public.inventory_variants;
  v_actor_email text;
  v_actor_name text;
begin
  if not public.is_opps_staff() then
    raise exception 'INVENTORY_RELEASE_FORBIDDEN: staff access required';
  end if;
  if not public.can_access_tenant(p_tenant_id) then
    raise exception 'INVENTORY_RELEASE_FORBIDDEN: tenant access denied';
  end if;

  select u.user_email, coalesce(u.full_name, u.user_email) into v_actor_email, v_actor_name
  from public.users u where u.auth_user_id = auth.uid();

  select * into v_reservation
  from public.inventory_variant_reservations
  where id = p_reservation_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'INVENTORY_RELEASE_NOT_FOUND: reservation does not exist for this tenant';
  end if;
  v_previous_status := v_reservation.status;
  if v_previous_status <> 'active' then
    raise exception 'INVENTORY_RELEASE_NOT_ACTIVE: only an active reservation can be released';
  end if;

  select coalesce(sum(quantity_delta), 0) into v_consumed
  from public.inventory_movements
  where related_reservation_id = v_reservation.id;
  if v_consumed <> 0 then
    raise exception 'INVENTORY_RELEASE_ALREADY_CONSUMED: this reservation already has consumption movements; release cannot discard consumed history';
  end if;

  select * into v_variant from public.inventory_variants where id = v_reservation.inventory_variant_id;

  update public.inventory_variant_reservations
  set status = 'released', released_reason = p_reason, updated_at = now()
  where id = p_reservation_id
  returning * into v_reservation;

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    p_tenant_id, v_actor_email, v_actor_name, 'inventory_reservation_released', 'inventory_variant_reservation', v_reservation.id,
    format('%s released reservation of %s x %s%s', coalesce(v_actor_name, 'Staff'), v_reservation.quantity, coalesce(v_variant.internal_sku, v_reservation.inventory_variant_id::text), case when p_reason is not null then ' - ' || p_reason else '' end),
    jsonb_build_object(
      'tenant_id', p_tenant_id, 'order_id', v_reservation.order_id, 'line_id', v_reservation.line_id,
      'reservation_id', v_reservation.id, 'snapshot_id', v_reservation.order_line_component_snapshot_id,
      'inventory_variant_id', v_reservation.inventory_variant_id, 'quantity', v_reservation.quantity,
      'previous_status', v_previous_status, 'new_status', 'released', 'released_reason', p_reason, 'actor', auth.uid()
    )
  );

  return v_reservation;
end;
$$;

create or replace function public.inventory_consume_reservation(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_quantity numeric,
  p_movement_type text default 'order_pick',
  p_reason text default null
)
returns public.inventory_movements
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

  select u.user_email, coalesce(u.full_name, u.user_email) into v_actor_email, v_actor_name
  from public.users u where u.auth_user_id = auth.uid();

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

  v_remaining := v_reservation.quantity - (v_already_consumed + p_quantity);
  v_new_status := case when v_already_consumed + p_quantity >= v_reservation.quantity then 'consumed' else v_reservation.status end;

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
      'remaining_quantity', v_remaining, 'resulting_status', v_new_status,
      'movement_id', v_movement.id, 'movement_type', p_movement_type, 'reason', p_reason, 'actor', auth.uid()
    )
  );

  return v_movement;
end;
$$;

create or replace function public.inventory_recalculate_line_reservations(
  p_tenant_id uuid,
  p_order_id uuid,
  p_line_id text
)
returns setof public.inventory_variant_reservations
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_order public.orders;
  v_line_qty numeric;
  v_snapshot public.order_line_component_snapshots;
  v_reservation public.inventory_variant_reservations;
  v_variant public.inventory_variants;
  v_target_qty numeric;
  v_already_consumed numeric;
  v_previous_qty numeric;
  v_actor_email text;
  v_actor_name text;
begin
  if not public.is_opps_staff() then
    raise exception 'INVENTORY_RECALC_FORBIDDEN: staff access required';
  end if;
  if not public.can_access_tenant(p_tenant_id) then
    raise exception 'INVENTORY_RECALC_FORBIDDEN: tenant access denied';
  end if;

  select u.user_email, coalesce(u.full_name, u.user_email) into v_actor_email, v_actor_name
  from public.users u where u.auth_user_id = auth.uid();

  select * into v_order from public.orders where id = p_order_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'INVENTORY_RECALC_ORDER_NOT_FOUND';
  end if;

  select coalesce((line.value ->> 'quantity')::numeric, 0) into v_line_qty
  from jsonb_array_elements(case when jsonb_typeof(coalesce(v_order.products, '[]'::jsonb)) = 'array' then v_order.products else '[]'::jsonb end) line(value)
  where line.value ->> 'line_id' = p_line_id
  limit 1;
  if v_line_qty is null then
    raise exception 'INVENTORY_RECALC_LINE_NOT_FOUND: line % not found on order', p_line_id;
  end if;

  for v_snapshot in
    select * from public.order_line_component_snapshots
    where order_id = p_order_id and line_id = p_line_id and tenant_id = p_tenant_id and inventory_product_id is not null
  loop
    v_target_qty := v_snapshot.quantity_per_unit * v_line_qty;

    for v_reservation in
      select * from public.inventory_variant_reservations
      where order_line_component_snapshot_id = v_snapshot.id and status = 'active'
      for update
    loop
      select -coalesce(sum(quantity_delta), 0) into v_already_consumed
      from public.inventory_movements
      where related_reservation_id = v_reservation.id;

      if v_target_qty < v_already_consumed then
        raise exception 'INVENTORY_RECALC_BELOW_CONSUMED: reservation % already has % consumed, cannot reduce target to %',
          v_reservation.id, v_already_consumed, v_target_qty;
      end if;

      v_previous_qty := v_reservation.quantity;

      -- Only write a state change (and its event) when the quantity
      -- actually differs - a no-op recalculation must not log noise.
      if v_target_qty is distinct from v_previous_qty then
        update public.inventory_variant_reservations
        set quantity = v_target_qty, updated_at = now()
        where id = v_reservation.id
        returning * into v_reservation;

        select * into v_variant from public.inventory_variants where id = v_reservation.inventory_variant_id;

        insert into public.opps_activity_events (
          tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
        ) values (
          p_tenant_id, v_actor_email, v_actor_name, 'inventory_reservation_recalculated', 'inventory_variant_reservation', v_reservation.id,
          format('%s recalculated reservation %s: %s -> %s x %s (order line quantity changed)', coalesce(v_actor_name, 'Staff'), v_reservation.id, v_previous_qty, v_target_qty, coalesce(v_variant.internal_sku, v_reservation.inventory_variant_id::text)),
          jsonb_build_object(
            'tenant_id', p_tenant_id, 'order_id', p_order_id, 'line_id', p_line_id,
            'reservation_id', v_reservation.id, 'snapshot_id', v_snapshot.id,
            'inventory_variant_id', v_reservation.inventory_variant_id,
            'previous_quantity', v_previous_qty, 'new_quantity', v_target_qty,
            'reason', 'order_line_recalculation', 'actor', auth.uid()
          )
        );
      end if;

      return next v_reservation;
    end loop;
  end loop;

  return;
end;
$$;

revoke all on function public.inventory_reserve_variant(uuid, uuid, text, uuid, uuid, numeric, text) from public, anon;
revoke all on function public.inventory_release_reservation(uuid, uuid, text) from public, anon;
revoke all on function public.inventory_consume_reservation(uuid, uuid, numeric, text, text) from public, anon;
revoke all on function public.inventory_recalculate_line_reservations(uuid, uuid, text) from public, anon;

grant execute on function public.inventory_reserve_variant(uuid, uuid, text, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.inventory_release_reservation(uuid, uuid, text) to authenticated;
grant execute on function public.inventory_consume_reservation(uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.inventory_recalculate_line_reservations(uuid, uuid, text) to authenticated;
