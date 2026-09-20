#!/usr/bin/env bash
# Disposable pg16 proof for 20260920180000_paxi_dispatch_gate.sql:
# an order using Pep PAXI as its courier cannot be marked
# shipped/delivered while its PAXI code is empty, enforced by a BEFORE
# UPDATE trigger (not just the UI), with a paired AFTER UPDATE trigger
# recording successful dispatches and courier/code edits to
# opps_activity_events.
#
# This is a LOCAL, DISPOSABLE container only. It never touches staging
# or production. Schema stub is deliberately minimal - just enough of
# orders / tenants / users / opps_activity_events for the migration to
# apply and the triggers to fire, not a full mirror of every column on
# the real tables.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260920180000_paxi_dispatch_gate.sql"
CID="paxi-dispatch-gate-$$"
cleanup() { docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$CID" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=m postgres:16-alpine >/dev/null
for i in $(seq 1 90); do docker exec "$CID" pg_isready -U postgres -d m -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
sleep 2
run() { docker exec -i "$CID" psql -X -v ON_ERROR_STOP=1 -U postgres -d m; }

run >/dev/null <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.email() returns text language sql stable
  as $$ select nullif(current_setting('test.email', true), '') $$;

create table public.tenants (id uuid primary key);
create table public.users (auth_user_id uuid primary key, user_email text);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  order_number text not null,
  status text default 'confirmed', -- nullable: real orders.status has no NOT NULL/CHECK constraint either (see migration header)
  fulfillment_type text not null default 'courier',
  courier text,
  pep_code text,
  source text default 'opps',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.opps_activity_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  actor_email text not null,
  actor_name text,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.tenants values ('11111111-1111-1111-1111-111111111111');
SQL
echo "prelude ok"

if ! run < "$MIG" >/tmp/paxi.out 2>&1; then echo "MIGRATION FAILED:"; cat /tmp/paxi.out; exit 1; fi
echo "20260920180000 applied"
if ! run < "$MIG" >/tmp/paxi2.out 2>&1; then echo "MIGRATION SECOND APPLY FAILED:"; cat /tmp/paxi2.out; exit 1; fi
echo "20260920180000 idempotent"

echo "=========================================="
echo "SCENARIOS"
echo "=========================================="
docker exec -i "$CID" psql -X -q -U postgres -d m 2>&1 <<'SQL' | grep -E 'PASS|FAIL|RESULT'
do $$
declare
  TENANT constant uuid := '11111111-1111-1111-1111-111111111111';
  o_paxi uuid; o_norm uuid; o_other uuid; o_collection uuid; o_qs_collection uuid; o_ready uuid;
  n int; v_msg text; v_courier text; v_pep_code text; v_status text;
begin
  set local test.uid = '22222222-2222-2222-2222-222222222222';
  set local test.email = 'staff@jointx.co.za';

  -- ── 1 · blocked dispatch: PAXI courier, empty code, cannot ship ─────
  insert into public.orders (tenant_id, order_number, status, fulfillment_type, courier, pep_code)
  values (TENANT, 'ORD-0001', 'ready', 'courier', 'pep_paxi', null) returning id into o_paxi;

  begin
    update public.orders set status = 'shipped' where id = o_paxi;
    raise notice 'FAIL 1 should have raised PAXI_CODE_REQUIRED, update succeeded';
  exception when others then
    if sqlerrm like '%PAXI_CODE_REQUIRED%' then raise notice 'PASS 1 dispatch blocked: PAXI courier with empty code cannot become shipped';
    else raise notice 'FAIL 1 wrong error: %', sqlerrm; end if;
  end;

  select status into v_status from public.orders where id = o_paxi;
  if v_status = 'ready' then raise notice 'PASS 2 rejected update did not partially apply — status is still ready';
  else raise notice 'FAIL 2 status leaked through as %', v_status; end if;

  -- ── 3 · staff MAY save as ready without a code (not gated at all) ───
  update public.orders set pep_code = null, status = 'ready' where id = o_paxi;
  if (select status from public.orders where id = o_paxi) = 'ready'
  then raise notice 'PASS 3 saving as ready with an empty PAXI code is allowed';
  else raise notice 'FAIL 3 unexpected state'; end if;

  -- ── 4 · after entering the code, dispatch unlocks and persists ──────
  update public.orders set pep_code = 'PX123456' where id = o_paxi;
  update public.orders set status = 'shipped' where id = o_paxi;
  select status, pep_code into v_status, v_pep_code from public.orders where id = o_paxi;
  if v_status = 'shipped' and v_pep_code = 'PX123456'
  then raise notice 'PASS 4 dispatch unlocks once the code is entered, and the code persists on the row';
  else raise notice 'FAIL 4 status=% pep_code=%', v_status, v_pep_code; end if;

  -- ── 5 · successful dispatch is logged to opps_activity_events ───────
  select count(*) into n from public.opps_activity_events
    where entity_id = o_paxi and event_type = 'order_paxi_dispatched';
  if n = 1 then raise notice 'PASS 5 successful PAXI dispatch logged exactly once to opps_activity_events';
  else raise notice 'FAIL 5 order_paxi_dispatched count=%', n; end if;

  -- ── 6 · courier/code edits are logged to opps_activity_events ───────
  select count(*) into n from public.opps_activity_events
    where entity_id = o_paxi and event_type = 'order_courier_details_updated';
  if n >= 1 then raise notice 'PASS 6 courier/PAXI code edit(s) logged to opps_activity_events (n=%)', n;
  else raise notice 'FAIL 6 order_courier_details_updated count=%', n; end if;

  -- ── 7 · closes the "jump straight to delivered" loophole ────────────
  insert into public.orders (tenant_id, order_number, status, fulfillment_type, courier, pep_code)
  values (TENANT, 'ORD-0002', 'ready', 'courier', 'pep_paxi', null) returning id into o_ready;
  begin
    update public.orders set status = 'delivered' where id = o_ready;
    raise notice 'FAIL 7 jumping straight to delivered with no code should have been blocked';
  exception when others then
    if sqlerrm like '%PAXI_CODE_REQUIRED%' then raise notice 'PASS 7 jumping straight to delivered (skipping shipped) is blocked the same way';
    else raise notice 'FAIL 7 wrong error: %', sqlerrm; end if;
  end;

  -- ── 8 · normalization: known PAXI spelling/casing variants ──────────
  insert into public.orders (tenant_id, order_number, status, fulfillment_type, courier, pep_code)
  values (TENANT, 'ORD-0003', 'ready', 'courier', 'PAXI', null) returning id into o_norm;
  begin
    update public.orders set status = 'shipped' where id = o_norm;
    raise notice 'FAIL 8 courier="PAXI" (bare, uppercase) should still be gated';
  exception when others then
    if sqlerrm like '%PAXI_CODE_REQUIRED%' then raise notice 'PASS 8 courier="PAXI" normalizes to the gate the same as "pep_paxi"';
    else raise notice 'FAIL 8 wrong error: %', sqlerrm; end if;
  end;

  update public.orders set courier = 'Pep-Paxi' where id = o_norm;
  begin
    update public.orders set status = 'shipped' where id = o_norm;
    raise notice 'FAIL 8b courier="Pep-Paxi" should still be gated';
  exception when others then
    if sqlerrm like '%PAXI_CODE_REQUIRED%' then raise notice 'PASS 8b courier="Pep-Paxi" (mixed case, hyphen) normalizes the same way';
    else raise notice 'FAIL 8b wrong error: %', sqlerrm; end if;
  end;

  -- ── 9 · non-PAXI couriers are completely unaffected ──────────────────
  insert into public.orders (tenant_id, order_number, status, fulfillment_type, courier, pep_code)
  values (TENANT, 'ORD-0004', 'ready', 'courier', 'the_courier_guy', null) returning id into o_other;
  update public.orders set status = 'shipped' where id = o_other;
  if (select status from public.orders where id = o_other) = 'shipped'
  then raise notice 'PASS 9 a non-PAXI courier (the_courier_guy) with no code dispatches without being gated by this trigger';
  else raise notice 'FAIL 9 unexpected block on non-PAXI courier'; end if;

  -- courier with NO courier selected at all — also unaffected by this gate
  insert into public.orders (tenant_id, order_number, status, fulfillment_type, courier, pep_code)
  values (TENANT, 'ORD-0005', 'ready', 'courier', null, null) returning id into o_other;
  update public.orders set status = 'shipped' where id = o_other;
  if (select status from public.orders where id = o_other) = 'shipped'
  then raise notice 'PASS 9b an order with no courier selected at all is unaffected by the PAXI gate';
  else raise notice 'FAIL 9b unexpected block with no courier selected'; end if;

  -- ── 10 · collection orders are exempt regardless of courier value ───
  insert into public.orders (tenant_id, order_number, status, fulfillment_type, courier, pep_code, source)
  values (TENANT, 'ORD-0006', 'ready', 'collection', 'pep_paxi', null, 'opps') returning id into o_collection;
  update public.orders set status = 'shipped' where id = o_collection;
  if (select status from public.orders where id = o_collection) = 'shipped'
  then raise notice 'PASS 10 a collection order is exempt from the PAXI gate even if courier happens to be set to pep_paxi';
  else raise notice 'FAIL 10 collection order was incorrectly blocked'; end if;

  -- ── 11 · Quick Solution collection orders specifically are exempt ───
  -- (QS collection orders always carry fulfillment_type='collection' —
  -- the gate keys off that column, not orders.source, so this is the
  -- same rule as #10, just confirmed against a source='quick_solution' row.)
  insert into public.orders (tenant_id, order_number, status, fulfillment_type, courier, pep_code, source)
  values (TENANT, 'ORD-0007', 'ready', 'collection', 'pep_paxi', null, 'quick_solution') returning id into o_qs_collection;
  update public.orders set status = 'shipped' where id = o_qs_collection;
  if (select status from public.orders where id = o_qs_collection) = 'shipped'
  then raise notice 'PASS 11 a Quick Solution collection order is exempt from the PAXI dispatch gate';
  else raise notice 'FAIL 11 Quick Solution collection order was incorrectly blocked'; end if;

end $$;

-- ── 12-14 · legacy already-shipped/delivered records are never blocked ─
-- The gate only fires on ENTRY into shipped/delivered (old.status NOT
-- already one of them) — editing a record that's already in that state,
-- with an empty PAXI code (e.g. a legacy row from before this migration
-- existed, or a courier corrected after the fact), must never be
-- blocked. Separate do-block, separate order, so it can't be affected
-- by any state the scenarios above left behind.
do $$
declare
  TENANT constant uuid := '11111111-1111-1111-1111-111111111111';
  o_legacy uuid;
begin
  set local test.uid = '22222222-2222-2222-2222-222222222222';
  set local test.email = 'staff@jointx.co.za';

  -- A legacy PAXI order that is ALREADY shipped, with no code on file.
  insert into public.orders (tenant_id, order_number, status, fulfillment_type, courier, pep_code)
  values (TENANT, 'ORD-0008', 'shipped', 'courier', 'pep_paxi', null) returning id into o_legacy;

  -- Editing an unrelated field on it must not be blocked.
  update public.orders set order_number = 'ORD-0008-CORRECTED' where id = o_legacy;
  if (select order_number from public.orders where id = o_legacy) = 'ORD-0008-CORRECTED'
  then raise notice 'PASS 12 editing a field on an already-shipped legacy order (empty PAXI code) is not blocked';
  else raise notice 'FAIL 12 unexpected block on unrelated-field edit'; end if;

  -- Re-saving status='shipped' (no real transition, old already shipped) must not be blocked.
  update public.orders set status = 'shipped' where id = o_legacy;
  if (select status from public.orders where id = o_legacy) = 'shipped'
  then raise notice 'PASS 13 re-saving status=shipped on an already-shipped order is not blocked';
  else raise notice 'FAIL 13 unexpected block re-saving the same status'; end if;

  -- Moving shipped -> delivered (both already "dispatched" states) must not be blocked.
  update public.orders set status = 'delivered' where id = o_legacy;
  if (select status from public.orders where id = o_legacy) = 'delivered'
  then raise notice 'PASS 14 moving an already-shipped legacy order on to delivered is not blocked, even with no PAXI code';
  else raise notice 'FAIL 14 unexpected block on shipped -> delivered'; end if;

end $$;

-- ── 15-16 · NULL old.status null-safety (NOT IN vs IS DISTINCT FROM) ──
-- `NULL NOT IN ('shipped','delivered')` evaluates to NULL under
-- three-valued logic, and a plpgsql `if` treats NULL as false — the
-- original NOT IN form would have silently let a NULL-status PAXI
-- order skip this gate entirely. IS DISTINCT FROM fixes that. Separate
-- do-block, separate order.
do $$
declare
  TENANT constant uuid := '11111111-1111-1111-1111-111111111111';
  o_null_status uuid;
  v_status text;
  n int;
begin
  set local test.uid = '22222222-2222-2222-2222-222222222222';
  set local test.email = 'staff@jointx.co.za';

  -- A PAXI order that somehow has a NULL status (e.g. a row that
  -- predates a status default, or was written by a path that never
  -- set one) and no PAXI code on file.
  insert into public.orders (tenant_id, order_number, status, fulfillment_type, courier, pep_code)
  values (TENANT, 'ORD-0009', null, 'courier', 'pep_paxi', null) returning id into o_null_status;

  if (select status from public.orders where id = o_null_status) is null
  then raise notice 'PASS 15-setup order created with a genuinely NULL status';
  else raise notice 'FAIL 15-setup status was not NULL as expected'; end if;

  -- 15 · NULL -> shipped with no code must be blocked, not silently allowed.
  begin
    update public.orders set status = 'shipped' where id = o_null_status;
    raise notice 'FAIL 15 NULL -> shipped with an empty PAXI code should have been blocked';
  exception when others then
    if sqlerrm like '%PAXI_CODE_REQUIRED%' then raise notice 'PASS 15 NULL -> shipped with an empty PAXI code is blocked (NULL old.status is not silently treated as already-dispatched)';
    else raise notice 'FAIL 15 wrong error: %', sqlerrm; end if;
  end;

  select status into v_status from public.orders where id = o_null_status;
  if v_status is null then raise notice 'PASS 15b rejected update did not partially apply — status is still NULL';
  else raise notice 'FAIL 15b status leaked through as %', v_status; end if;

  -- 16 · positive counterpart: NULL -> shipped succeeds once a code is supplied, and persists.
  update public.orders set pep_code = 'PX999000' where id = o_null_status;
  update public.orders set status = 'shipped' where id = o_null_status;
  select status, pep_code into v_status from public.orders where id = o_null_status;
  if (select status from public.orders where id = o_null_status) = 'shipped'
     and (select pep_code from public.orders where id = o_null_status) = 'PX999000'
  then raise notice 'PASS 16 NULL -> shipped succeeds once the PAXI code is entered, and both status and code persist';
  else raise notice 'FAIL 16 status=% pep_code=%', (select status from public.orders where id = o_null_status), (select pep_code from public.orders where id = o_null_status); end if;

  select count(*) into n from public.opps_activity_events
    where entity_id = o_null_status and event_type = 'order_paxi_dispatched';
  if n = 1 then raise notice 'PASS 16b the NULL -> shipped dispatch is logged to opps_activity_events exactly once';
  else raise notice 'FAIL 16b order_paxi_dispatched count=%', n; end if;

end $$;
SQL
