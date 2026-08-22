-- Inventory Allocation + Reservation — Phase 2A, Stage A (schema + server
-- contract + dry-run read only).
--
-- Per the architecture review: reuses Inventory Phase 1 identity
-- (inventory_products/inventory_variants/inventory_supplier_variants) and
-- the existing inventory_movements ledger. Does NOT introduce a second
-- physical-balance counter - reservation state lives in its own table,
-- on-hand balance lives on inventory_variants, "available" is always
-- derived (on_hand - active reservations), never stored twice.
--
-- Ordering matters: inventory_variant_reservations is created FIRST so
-- inventory_movements.related_reservation_id has a real FK target.
--
-- Nothing in this migration mutates real stock, writes a reservation, or
-- writes a movement. The four RPCs below are real, fully-validated
-- SECURITY DEFINER functions (the actual server contract) but are not
-- called from anywhere in the shipped UI this pass - only a read-only
-- dry-run view is wired up.

-- ---------------------------------------------------------------------
-- 1. inventory_variant_reservations
-- ---------------------------------------------------------------------
-- Reservation STATE only - never a second stock-balance ledger. Anchored
-- to the immutable blank/inventory-bearing component snapshot (what's
-- actually being produced), not the mutable commercial order line.
-- Current-state table (status transitions in place), with the full
-- history captured via the existing opps_activity_events table - not a
-- new audit framework.

create table if not exists public.inventory_variant_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete cascade,
  -- Matches orders.products[].line_id - no DB FK, the line lives in a
  -- jsonb array, not its own table. Denormalized for query convenience.
  line_id text not null,
  order_line_component_snapshot_id uuid not null references public.order_line_component_snapshots(id) on delete cascade,
  -- RESTRICT, not SET NULL - an active reservation must never silently
  -- lose its identity if a variant row is deleted; deletion of a
  -- reserved variant is blocked until the reservation is released first.
  inventory_variant_id uuid not null references public.inventory_variants(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  status text not null default 'active'
    check (status in ('active', 'released', 'consumed', 'cancelled')),
  released_reason text,
  idempotency_key text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Partial unique index (not a table UNIQUE constraint - a WHERE clause
-- on a uniqueness rule can only be expressed as a partial index): only
-- one ACTIVE reservation per (snapshot, variant) pair at a time.
-- Historical released/cancelled/consumed rows for the same pair remain
-- possible - re-reserving the same variant later (e.g. after an order
-- correction releases then re-reserves) is not blocked.
create unique index if not exists inventory_variant_reservations_active_uidx
  on public.inventory_variant_reservations (order_line_component_snapshot_id, inventory_variant_id)
  where status = 'active';

create unique index if not exists inventory_variant_reservations_idempotency_uidx
  on public.inventory_variant_reservations (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists inventory_variant_reservations_order_id_idx on public.inventory_variant_reservations (order_id);
create index if not exists inventory_variant_reservations_snapshot_id_idx on public.inventory_variant_reservations (order_line_component_snapshot_id);
create index if not exists inventory_variant_reservations_variant_id_idx on public.inventory_variant_reservations (inventory_variant_id);
create index if not exists inventory_variant_reservations_active_status_idx on public.inventory_variant_reservations (inventory_variant_id) where status = 'active';

alter table public.inventory_variant_reservations enable row level security;

create policy inventory_variant_reservations_tenant_read
  on public.inventory_variant_reservations for select
  using (public.can_access_tenant(tenant_id));

create policy inventory_variant_reservations_reviewer_insert
  on public.inventory_variant_reservations for insert
  with check (public.inventory_can_review_tenant(tenant_id));

create policy inventory_variant_reservations_reviewer_update
  on public.inventory_variant_reservations for update
  using (public.inventory_can_review_tenant(tenant_id))
  with check (public.inventory_can_review_tenant(tenant_id));

create policy xos1_require_opps_staff
  on public.inventory_variant_reservations for all
  using (public.is_opps_staff())
  with check (public.is_opps_staff());

revoke all on public.inventory_variant_reservations from public, anon;
-- No DELETE grant - lifecycle is expressed through status transitions,
-- never row removal, matching the "no destructive rewrite" principle
-- already established for order_line_component_snapshots.
grant select, insert, update on public.inventory_variant_reservations to authenticated;

-- ---------------------------------------------------------------------
-- 2. inventory_movements - normalized identity + append-only enforcement
-- ---------------------------------------------------------------------
-- inventory_id was NOT NULL, forcing every movement to reference the
-- legacy flat `inventory` table. Phase-1-only variants (e.g. the two
-- JET-PILOTTEST-* rows created for the Composition pilot) have no
-- legacy inventory row at all, so a normalized movement could never be
-- recorded for them without this change.

alter table public.inventory_movements alter column inventory_id drop not null;

alter table public.inventory_movements
  add column if not exists related_reservation_id uuid references public.inventory_variant_reservations(id) on delete set null;

-- Prevent identity-less movement rows: a movement must reference either
-- the legacy item (inventory_id) or the normalized variant
-- (inventory_variant_id) - never neither. Does not require both, so a
-- normalized-only movement never has to fabricate a legacy row.
alter table public.inventory_movements
  add constraint inventory_movements_identity_present_check
  check (inventory_id is not null or inventory_variant_id is not null);

create index if not exists inventory_movements_related_reservation_id_idx
  on public.inventory_movements (related_reservation_id) where related_reservation_id is not null;

-- Append-only for direct client access: staff may SELECT and INSERT
-- (the live manual stock-count flow in Inventory.jsx inserts 'count'
-- movements directly under the authenticated role's own grant - this is
-- preserved), but never UPDATE or DELETE a historical row directly.
-- Corrections/reversals must be new compensating movements (return,
-- damage, manual_adjust, count, ...), never an edit to what already
-- happened. The four Phase 2A RPCs below are SECURITY DEFINER and so
-- never depended on this grant in the first place; revoking it only
-- removes a capability nothing legitimate was using. Service/superuser
-- migration roles are unaffected - table grants never restrict them.
revoke update, delete on public.inventory_movements from authenticated;

-- ---------------------------------------------------------------------
-- 3. inventory_variants - balance fields
-- ---------------------------------------------------------------------
-- Current stock is not authoritative yet. on_hand_qty starts at 0 for
-- every variant (never auto-copied from legacy inventory.current_stock -
-- that would silently launder an unverified number into a column whose
-- entire purpose is to distinguish verified from unverified balance).
-- balance_verified_at is set only once a real physical count reconciles
-- a variant - hard shortage enforcement is conditional on it being set.

alter table public.inventory_variants
  add column if not exists on_hand_qty numeric not null default 0 check (on_hand_qty >= 0),
  add column if not exists balance_verified_at timestamptz;

-- ---------------------------------------------------------------------
-- 4. Dry-run availability view (read-only)
-- ---------------------------------------------------------------------
-- available = on_hand - active reservations, always derived, never
-- stored. Matches the existing inventory_identity_v pattern exactly
-- (plain view, RLS enforced through the underlying tables, SELECT-only
-- grant to authenticated).

create or replace view public.inventory_variant_availability_v as
select
  iv.tenant_id,
  iv.id as inventory_variant_id,
  iv.inventory_product_id,
  iv.internal_sku,
  iv.colour_name,
  iv.size_name,
  iv.is_active as variant_is_active,
  iv.on_hand_qty,
  iv.balance_verified_at,
  coalesce(r.reserved_qty, 0) as reserved_qty,
  iv.on_hand_qty - coalesce(r.reserved_qty, 0) as available_qty
from public.inventory_variants iv
left join (
  select inventory_variant_id, sum(quantity) as reserved_qty
  from public.inventory_variant_reservations
  where status = 'active'
  group by inventory_variant_id
) r on r.inventory_variant_id = iv.id;

revoke all on public.inventory_variant_availability_v from public, anon;
grant select on public.inventory_variant_availability_v to authenticated;

-- ---------------------------------------------------------------------
-- 5. Server contract - four SECURITY DEFINER RPCs
-- ---------------------------------------------------------------------
-- Real, fully-validated write logic - the actual server boundary the
-- review specified. Not invoked from any shipped UI this pass (Stage A
-- ships schema + dry-run read only); existing purely for review and for
-- Stage B to call once explicitly approved. Every RPC independently
-- re-validates tenant/order/snapshot/variant ownership server-side
-- rather than trusting client-supplied IDs.

create or replace function public.inventory_reserve_variant(
  p_tenant_id uuid,
  p_order_id uuid,
  p_line_id text,
  p_snapshot_id uuid,
  p_inventory_variant_id uuid,
  p_quantity numeric,
  p_idempotency_key text default null
)
returns public.inventory_variant_reservations
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_snapshot public.order_line_component_snapshots;
  v_variant public.inventory_variants;
  v_existing public.inventory_variant_reservations;
  v_result public.inventory_variant_reservations;
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

  -- Idempotent replay: return the existing row rather than erroring or
  -- double-reserving.
  if p_idempotency_key is not null then
    select * into v_existing
    from public.inventory_variant_reservations
    where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
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

  insert into public.inventory_variant_reservations (
    tenant_id, order_id, line_id, order_line_component_snapshot_id,
    inventory_variant_id, quantity, status, idempotency_key, created_by
  ) values (
    p_tenant_id, p_order_id, p_line_id, p_snapshot_id,
    p_inventory_variant_id, p_quantity, 'active', p_idempotency_key, auth.uid()
  )
  returning * into v_result;

  return v_result;
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
  v_consumed numeric;
begin
  if not public.is_opps_staff() then
    raise exception 'INVENTORY_RELEASE_FORBIDDEN: staff access required';
  end if;
  if not public.can_access_tenant(p_tenant_id) then
    raise exception 'INVENTORY_RELEASE_FORBIDDEN: tenant access denied';
  end if;

  select * into v_reservation
  from public.inventory_variant_reservations
  where id = p_reservation_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'INVENTORY_RELEASE_NOT_FOUND: reservation does not exist for this tenant';
  end if;
  if v_reservation.status <> 'active' then
    raise exception 'INVENTORY_RELEASE_NOT_ACTIVE: only an active reservation can be released';
  end if;

  select coalesce(sum(quantity_delta), 0) into v_consumed
  from public.inventory_movements
  where related_reservation_id = v_reservation.id;
  if v_consumed <> 0 then
    raise exception 'INVENTORY_RELEASE_ALREADY_CONSUMED: this reservation already has consumption movements; release cannot discard consumed history';
  end if;

  update public.inventory_variant_reservations
  set status = 'released', released_reason = p_reason, updated_at = now()
  where id = p_reservation_id
  returning * into v_reservation;

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

  -- Net of all movements linked to this reservation (negated, since
  -- consumption is recorded as a negative delta) - a later 'return'
  -- movement against the same reservation correctly reduces the
  -- running "already consumed" total, not just negative-delta rows.
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
    v_reservation.order_id, v_reservation.id, p_reason, auth.uid(), auth.jwt() ->> 'email'
  )
  returning * into v_movement;

  update public.inventory_variant_reservations
  set status = case when v_already_consumed + p_quantity >= v_reservation.quantity then 'consumed' else status end,
      updated_at = now()
  where id = v_reservation.id;

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
  v_target_qty numeric;
  v_already_consumed numeric;
begin
  if not public.is_opps_staff() then
    raise exception 'INVENTORY_RECALC_FORBIDDEN: staff access required';
  end if;
  if not public.can_access_tenant(p_tenant_id) then
    raise exception 'INVENTORY_RECALC_FORBIDDEN: tenant access denied';
  end if;

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

      update public.inventory_variant_reservations
      set quantity = v_target_qty, updated_at = now()
      where id = v_reservation.id
      returning * into v_reservation;

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
