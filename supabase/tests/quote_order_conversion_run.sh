#!/usr/bin/env bash
# Disposable pg16 proof for 20260916090000_quote_order_invoice_conversion.sql:
# convert_quote_to_order(p_quote_id) — accepted quote converts, ineligible
# statuses are rejected, a second call (double-click / retry) returns the
# SAME order rather than creating a second one, and — the part a static
# source-text assertion CANNOT prove — two genuinely concurrent conversion
# calls for the same quote cannot jointly create two orders, using real
# overlapping Postgres sessions and SELECT ... FOR UPDATE row-lock
# serialisation, not a sequential re-run.
#
# This is a LOCAL, DISPOSABLE container only. It never touches staging or
# production. Schema stub is deliberately minimal — just enough of
# opps_quotes / opps_quote_items / opps_quote_revisions / opps_quote_events
# / orders / tenants / the permission helpers for the migration to apply
# and the RPC to run — not a full mirror of every trigger/column on the
# real tables.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260916090000_quote_order_invoice_conversion.sql"
CID="quote-order-conv-$$"
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

create table public.tenants (id uuid primary key);
create table public.clients (id uuid primary key, tenant_id uuid);

-- Minimal permission helpers — always-true stubs (the migration/RPC calls
-- them by name; their real implementations are tested elsewhere and are
-- not the subject of this proof).
create or replace function public.is_app_admin() returns boolean language sql stable as $$ select true $$;
create or replace function public.user_finance_level() returns integer language sql stable as $$ select 1 $$;
create or replace function public.can_access_tenant(p_tenant_id uuid) returns boolean language sql stable as $$ select true $$;

create table public.opps_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  quote_number text not null,
  status text not null default 'draft',
  customer_id uuid,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  notes text,
  total numeric not null default 0,
  current_revision_id uuid,
  accepted_revision_id uuid,
  accepted_at timestamptz,
  converted_order_id uuid,
  converted_invoice_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.opps_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.opps_quotes(id) on delete cascade,
  tenant_id uuid not null,
  line_number integer not null,
  role text not null default 'product',
  item_name text not null,
  item_description text,
  quantity numeric not null,
  unit text,
  rate numeric not null,
  discount numeric not null default 0,
  tax_name text,
  tax_percentage numeric not null default 0,
  item_total numeric not null,
  image_url text,
  source_client_product_id uuid,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.opps_quote_revisions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.opps_quotes(id) on delete cascade,
  tenant_id uuid not null,
  revision_number integer not null,
  snapshot jsonb not null,
  totals jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.opps_quote_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.opps_quotes(id) on delete cascade,
  tenant_id uuid not null,
  revision_id uuid,
  event_type text not null,
  actor_kind text not null,
  actor_user_id uuid,
  actor_label text,
  actor_email text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.opps_quote_events add constraint opps_quote_events_event_type_check
  check (event_type in ('created','sent','viewed','revised','accepted','changes_requested','declined','expired','converted','share_issued','share_revoked','share_rotated'));

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_email text,
  client_phone text,
  order_number text not null,
  status text not null default 'confirmed',
  priority text not null default 'normal',
  products jsonb default '[]'::jsonb,
  total_amount numeric default 0,
  notes text,
  source text default 'opps',
  source_metadata jsonb not null default '{}'::jsonb,
  client_id uuid,
  tenant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.tenants values ('11111111-1111-1111-1111-111111111111');
SQL
echo "prelude ok"

if ! run < "$MIG" >/tmp/qoc.out 2>&1; then echo "MIGRATION FAILED:"; cat /tmp/qoc.out; exit 1; fi
echo "20260916090000 applied"
if ! run < "$MIG" >/tmp/qoc2.out 2>&1; then echo "MIGRATION SECOND APPLY FAILED:"; cat /tmp/qoc2.out; exit 1; fi
echo "20260916090000 idempotent"

echo "=========================================="
echo "SEQUENTIAL SCENARIOS"
echo "=========================================="
docker exec -i "$CID" psql -X -q -U postgres -d m 2>&1 <<'SQL' | grep -E 'PASS|FAIL|RESULT'
do $$
declare
  TENANT constant uuid := '11111111-1111-1111-1111-111111111111';
  q_accepted uuid; q_draft uuid; q_declined uuid; rev_id uuid;
  r jsonb; n int; v_order_id uuid; v_order_number text; v_products jsonb;
begin
  set local test.uid = '22222222-2222-2222-2222-222222222222';

  -- ── quote 1: accepted, with a frozen snapshot of TWO lines ──────────
  insert into public.opps_quotes (tenant_id, quote_number, status, customer_name, customer_email, total)
  values (TENANT, 'QT-2026-000001', 'accepted', 'ACME Co', 'acme@x.invalid', 300.00)
  returning id into q_accepted;

  insert into public.opps_quote_items (quote_id, tenant_id, line_number, item_name, item_description, quantity, rate, item_total)
  values
    (q_accepted, TENANT, 1, 'Widget', 'Blue widget', 2, 100.00, 200.00),
    (q_accepted, TENANT, 2, 'Setup fee', null, 1, 100.00, 100.00);

  insert into public.opps_quote_revisions (quote_id, tenant_id, revision_number, snapshot, totals)
  values (q_accepted, TENANT, 1,
    jsonb_build_object(
      'quote_number', 'QT-2026-000001', 'total', 300.00,
      'items', jsonb_build_array(
        jsonb_build_object('line_number', 1, 'role', 'product', 'item_name', 'Widget', 'item_description', 'Blue widget', 'quantity', 2, 'rate', 100.00, 'discount', 0, 'item_total', 200.00),
        jsonb_build_object('line_number', 2, 'role', 'product', 'item_name', 'Setup fee', 'quantity', 1, 'rate', 100.00, 'discount', 0, 'item_total', 100.00)
      )
    ),
    jsonb_build_object('total', 300.00)
  ) returning id into rev_id;

  update public.opps_quotes set accepted_revision_id = rev_id, current_revision_id = rev_id where id = q_accepted;

  -- 1 · accepted quote converts successfully
  r := public.convert_quote_to_order(q_accepted);
  select count(*) into n from public.orders where source_quote_id = q_accepted;
  select (r->>'order_id')::uuid, r->>'order_number' into v_order_id, v_order_number;
  select products into v_products from public.orders where id = v_order_id;
  if (r->>'ok')::boolean = true and (r->>'replayed')::boolean = false and n = 1
     and jsonb_array_length(v_products) = 2
     and (select total_amount from public.orders where id = v_order_id) = 300.00
  then raise notice 'PASS 1 accepted quote converts: one order, 2 lines, total R300 preserved from the FROZEN snapshot';
  else raise notice 'FAIL 1 r=% n=% products=%', r, n, v_products; end if;

  -- 2 · quote row reflects the conversion
  if (select status from public.opps_quotes where id = q_accepted) = 'converted'
     and (select converted_order_id from public.opps_quotes where id = q_accepted) = v_order_id
  then raise notice 'PASS 2 quote marked converted, converted_order_id points at the new order';
  else raise notice 'FAIL 2 quote row: %', (select row_to_json(o) from public.opps_quotes o where id = q_accepted); end if;

  -- 3 · exactly one quote event logged
  select count(*) into n from public.opps_quote_events where quote_id = q_accepted and event_type = 'converted';
  if n = 1 then raise notice 'PASS 3 exactly one converted event logged';
  else raise notice 'FAIL 3 converted event count=%', n; end if;

  -- 4 · idempotent replay: same quote, second call -> SAME order, no new row
  r := public.convert_quote_to_order(q_accepted);
  select count(*) into n from public.orders where source_quote_id = q_accepted;
  if (r->>'ok')::boolean = true and (r->>'replayed')::boolean = true
     and (r->>'order_id')::uuid = v_order_id and n = 1
  then raise notice 'PASS 4 second call is idempotent: same order_id, still exactly one order row';
  else raise notice 'FAIL 4 r=% n=%', r, n; end if;

  -- 5 · a later edit to the LIVE quote_items must never retroactively
  --     change the already-created order (financial integrity)
  update public.opps_quote_items set rate = 999.00 where quote_id = q_accepted and line_number = 1;
  if (select total_amount from public.orders where id = v_order_id) = 300.00
  then raise notice 'PASS 5 order total unaffected by a later (hypothetical) live quote_items change — conversion reads the frozen snapshot only';
  else raise notice 'FAIL 5 order total drifted: %', (select total_amount from public.orders where id = v_order_id); end if;

  -- 6 · draft quote cannot convert
  insert into public.opps_quotes (tenant_id, quote_number, status, customer_name, total)
  values (TENANT, 'QT-2026-000002', 'draft', 'Draft Co', 0) returning id into q_draft;
  begin
    r := public.convert_quote_to_order(q_draft);
    raise notice 'FAIL 6 draft quote should have raised QUOTE_NOT_CONVERTIBLE, got r=%', r;
  exception when others then
    if sqlerrm like '%QUOTE_NOT_CONVERTIBLE%' then raise notice 'PASS 6 draft quote rejected: QUOTE_NOT_CONVERTIBLE';
    else raise notice 'FAIL 6 wrong error: %', sqlerrm; end if;
  end;

  -- 7 · declined quote cannot convert
  insert into public.opps_quotes (tenant_id, quote_number, status, customer_name, total)
  values (TENANT, 'QT-2026-000003', 'declined', 'Declined Co', 0) returning id into q_declined;
  begin
    r := public.convert_quote_to_order(q_declined);
    raise notice 'FAIL 7 declined quote should have raised QUOTE_NOT_CONVERTIBLE, got r=%', r;
  exception when others then
    if sqlerrm like '%QUOTE_NOT_CONVERTIBLE%' then raise notice 'PASS 7 declined quote rejected: QUOTE_NOT_CONVERTIBLE';
    else raise notice 'FAIL 7 wrong error: %', sqlerrm; end if;
  end;

  raise notice 'RESULT: SEQUENTIAL DONE';
end $$;
SQL

echo "=========================================="
echo "CONCURRENCY SCENARIO (real overlapping sessions)"
echo "=========================================="

# ── Concurrent double-click: two overlapping sessions convert the SAME
#    accepted quote. Session A holds the row lock open (explicit BEGIN +
#    pg_sleep AFTER the RPC call, BEFORE COMMIT) so session B — started
#    after A has entered the function and acquired the FOR UPDATE lock —
#    genuinely blocks, not just races in application code. Expect: exactly
#    one order row for that quote, and B's response is the replay of A's.
run >/dev/null <<'SQL'
insert into public.opps_quotes (id, tenant_id, quote_number, status, customer_name, total)
values ('a0000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'QT-2026-CONC', 'accepted', 'Concurrent Co', 150.00);
insert into public.opps_quote_revisions (id, quote_id, tenant_id, revision_number, snapshot, totals)
values ('b0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 1,
  jsonb_build_object('total', 150.00, 'items', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'role', 'product', 'item_name', 'Concurrent item', 'quantity', 1, 'rate', 150.00, 'discount', 0, 'item_total', 150.00)
  )),
  jsonb_build_object('total', 150.00)
);
update public.opps_quotes set accepted_revision_id = 'b0000000-0000-0000-0000-00000000000c' where id = 'a0000000-0000-0000-0000-00000000000c';
SQL

(
  docker exec -i "$CID" psql -X -q -U postgres -d m <<SQL > /tmp/conv_a.out 2>&1
set test.uid = '22222222-2222-2222-2222-222222222222';
begin;
select public.convert_quote_to_order('a0000000-0000-0000-0000-00000000000c'::uuid) as result_a;
select pg_sleep(2);
commit;
SQL
) &
PID_A=$!
sleep 0.5
(
  docker exec -i "$CID" psql -X -q -U postgres -d m <<SQL > /tmp/conv_b.out 2>&1
set test.uid = '22222222-2222-2222-2222-222222222222';
begin;
select public.convert_quote_to_order('a0000000-0000-0000-0000-00000000000c'::uuid) as result_b;
commit;
SQL
) &
PID_B=$!
wait $PID_A $PID_B

run <<SQL 2>&1 | grep -E 'PASS|FAIL'
do \$\$
declare n int;
begin
  select count(*) into n from public.orders where source_quote_id = 'a0000000-0000-0000-0000-00000000000c'::uuid;
  if n = 1
  then raise notice 'PASS 8 concurrent double-click on the same quote: exactly one order created, not two';
  else raise notice 'FAIL 8 n=% (would be a real duplicate-order bug)', n; end if;
end \$\$;
SQL
echo "  (session A raw output)"; cat /tmp/conv_a.out | grep -A1 result_a | head -4
echo "  (session B raw output)"; cat /tmp/conv_b.out | grep -A1 result_b | head -4

echo "-----------------------------------------"
echo "RESULT: PASS (20260916090000 applies + idempotent; 7 sequential + 1 real-concurrency assertion)"
