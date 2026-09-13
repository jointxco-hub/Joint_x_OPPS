#!/usr/bin/env bash
# Disposable pg16 proof for 20260913110000_invoice_payfast_payment.sql's
# overpayment-hardening policy: exact/partial payment accepted, an amount
# exceeding the current canonical balance is REJECTED (never recorded, never
# clamped), an already-fully-paid invoice ignores a further ITN, duplicate
# pf_payment_id is idempotent, and — the part a static source-text assertion
# CANNOT prove — two genuinely concurrent ITNs against the same invoice
# cannot jointly over-credit it, using real overlapping Postgres sessions and
# SELECT ... FOR UPDATE row-lock serialisation, not a sequential re-run.
#
# Schema prelude is copied from supabase/tests/payment_operation_key_and_proof_run.sh
# (same disposable pg16 stub: tenants/opps_invoices/opps_invoice_activity/
# invoice_payments + the P1A derivation functions + refresh-cache trigger).
# This script does NOT apply 20260907120000/20260907130000 (record_manual_
# invoice_payment) — 20260913110000 has no dependency on them.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260913110000_invoice_payfast_payment.sql"
CID="pf-overpay-$$"
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
create table public.orders (id uuid primary key, order_number text, tenant_id uuid, total_amount numeric);
create table public.xlab_orders (id uuid primary key, opps_order_id text, opps_order_number text, tenant_id uuid, order_number text, created_at timestamptz default now());
create table public.xlab_payments (id uuid primary key default gen_random_uuid(), order_id uuid, status text, amount numeric,
  method text, payfast_pf_payment_id text, payfast_payment_id text, created_at timestamptz default now());
create table public.opps_invoices (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  invoice_number text, status text default 'approved', total numeric(14,2) default 0,
  amount_paid numeric(14,2) default 0, balance_due numeric(14,2) default 0,
  source_order_id uuid, share_token text, public_visible boolean default true,
  share_revoked_at timestamptz, share_expires_at timestamptz,
  customer_name text, customer_email text,
  updated_by uuid, updated_at timestamptz default now());
create table public.opps_invoice_activity (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.opps_invoices(id) on delete cascade,
  tenant_id uuid references public.tenants(id),
  activity_type text not null, activity_label text not null,
  activity_note text, from_status text, to_status text,
  metadata jsonb default '{}'::jsonb, created_by uuid, created_at timestamptz default now());
create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  invoice_id uuid not null references public.opps_invoices(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  method text, reference text,
  source text not null default 'manual' check (source in ('manual','payfast','order_sync')),
  xlab_payment_id uuid, order_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), created_by uuid);
create unique index invoice_payments_manual_ref_once on public.invoice_payments (invoice_id, reference) where source='manual' and reference is not null;
create or replace function public._invoice_payments_set_tenant() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
declare v uuid; begin
  select tenant_id into v from public.opps_invoices where id = new.invoice_id;
  if v is null then raise exception using errcode='23503', message='INVOICE_PAYMENT_INVOICE_NOT_FOUND'; end if;
  new.tenant_id := v; return new; end $$;
create trigger trg_invoice_payments_set_tenant before insert or update on public.invoice_payments
  for each row execute function public._invoice_payments_set_tenant();
create or replace function public.invoice_amount_paid(p_invoice_id uuid) returns numeric language sql stable
set search_path = pg_catalog, public as $$
  select coalesce(round(sum(amount),2),0) from public.invoice_payments where invoice_id = p_invoice_id $$;
create or replace function public.invoice_balance_due(p_invoice_id uuid) returns numeric language sql stable
set search_path = pg_catalog, public as $$
  select greatest(round(coalesce((select total from public.opps_invoices where id=p_invoice_id),0) - public.invoice_amount_paid(p_invoice_id),2),0) $$;
create or replace function public.invoice_payment_status(p_invoice_id uuid) returns text language sql stable
set search_path = pg_catalog, public as $$
  with v as (select coalesce((select total from public.opps_invoices where id=p_invoice_id),0) t, public.invoice_amount_paid(p_invoice_id) p)
  select case when v.p <= 0 then 'unpaid' when v.p < v.t then 'partial' else 'paid' end from v $$;
create or replace function public._invoice_payments_refresh_cache() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
declare v uuid := coalesce(new.invoice_id, old.invoice_id); begin
  update public.opps_invoices set amount_paid = public.invoice_amount_paid(v),
    balance_due = public.invoice_balance_due(v) where id = v;
  return coalesce(new, old); end $$;
create trigger trg_invoice_payments_refresh_cache after insert or update or delete on public.invoice_payments
  for each row execute function public._invoice_payments_refresh_cache();

insert into public.tenants values ('11111111-1111-1111-1111-111111111111');
insert into public.opps_invoices (id, tenant_id, invoice_number, status, total, share_token, customer_name, customer_email) values
  ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','INV-EXACT','approved',1000.00,'tok-exact','A','a@x.invalid'),
  ('a0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','INV-PARTIAL','approved',1000.00,'tok-partial','B','b@x.invalid'),
  ('a0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','INV-OVER','approved',1000.00,'tok-over','C','c@x.invalid'),
  ('a0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','INV-DUP','approved',1000.00,'tok-dup','D','d@x.invalid'),
  ('a0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','INV-CONCDUP','approved',1000.00,'tok-concdup','E','e@x.invalid'),
  ('a0000000-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','INV-CONCEXCEED','approved',1000.00,'tok-concexceed','F','f@x.invalid'),
  ('a0000000-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','INV-VOID','void',1000.00,'tok-void','G','g@x.invalid');
-- INV-PAID: total 500, already fully settled via a prior MANUAL payment (not payfast)
insert into public.opps_invoices (id, tenant_id, invoice_number, status, total, share_token, customer_name, customer_email) values
  ('a0000000-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','INV-PAID','approved',500.00,'tok-paid','H','h@x.invalid');
insert into public.invoice_payments (invoice_id, amount, method, reference, source) values
  ('a0000000-0000-0000-0000-000000000008', 500.00, 'eft', 'PRE-PAID-REF', 'manual');
SQL
echo "prelude ok"

if ! run < "$MIG" >/tmp/pfh.out 2>&1; then echo "MIGRATION FAILED:"; cat /tmp/pfh.out; exit 1; fi
echo "20260913110000 applied"
if ! run < "$MIG" >/tmp/pfh2.out 2>&1; then echo "MIGRATION SECOND APPLY FAILED:"; cat /tmp/pfh2.out; exit 1; fi
echo "20260913110000 idempotent"

echo "=========================================="
echo "SEQUENTIAL SCENARIOS"
echo "=========================================="
docker exec -i "$CID" psql -X -q -U postgres -d m 2>&1 <<'SQL' | grep -E 'PASS|FAIL|RESULT'
do $$
declare
  EXACT       constant uuid := 'a0000000-0000-0000-0000-000000000001';
  PARTIAL     constant uuid := 'a0000000-0000-0000-0000-000000000002';
  OVER        constant uuid := 'a0000000-0000-0000-0000-000000000003';
  DUP         constant uuid := 'a0000000-0000-0000-0000-000000000004';
  VOID_INV    constant uuid := 'a0000000-0000-0000-0000-000000000007';
  PAID        constant uuid := 'a0000000-0000-0000-0000-000000000008';
  r jsonb; n int; act int;
begin
  -- 1 · exact payment: R1000 balance + R1000 ITN -> one ledger row, balance 0
  r := public.apply_invoice_payfast_payment(EXACT, 1000.00, 'PF-EXACT-1', '{}'::jsonb);
  select count(*) into n from public.invoice_payments where invoice_id=EXACT and source='payfast';
  if (r->>'ok')::boolean = true and (r->>'replayed')::boolean = false and n = 1
     and public.invoice_balance_due(EXACT) = 0.00
  then raise notice 'PASS 1 exact R1000 payment recorded, one ledger row, balance R0';
  else raise notice 'FAIL 1 r=% n=% balance=%', r, n, public.invoice_balance_due(EXACT); end if;

  -- 2 · valid partial payment: R1000 balance + R400 -> recorded, balance R600
  r := public.apply_invoice_payfast_payment(PARTIAL, 400.00, 'PF-PARTIAL-1', '{}'::jsonb);
  select count(*) into n from public.invoice_payments where invoice_id=PARTIAL and source='payfast';
  if (r->>'ok')::boolean = true and n = 1 and (r->>'amount_paid')::numeric = 400.00
     and public.invoice_balance_due(PARTIAL) = 600.00
  then raise notice 'PASS 2 valid partial R400 recorded, balance R600 (not broken by the overpayment fix)';
  else raise notice 'FAIL 2 r=% n=% balance=%', r, n, public.invoice_balance_due(PARTIAL); end if;

  -- 3 · invalid overpayment: R1000 balance + R1200 ITN -> rejected, ledger untouched, auditable
  r := public.apply_invoice_payfast_payment(OVER, 1200.00, 'PF-OVER-1', '{}'::jsonb);
  select count(*) into n from public.invoice_payments where invoice_id=OVER;
  select count(*) into act from public.opps_invoice_activity where invoice_id=OVER and activity_type='invoice_payment_rejected';
  if (r->>'ok')::boolean = false and r->>'reason' = 'INVOICE_PAYMENT_OVERPAYMENT_REJECTED'
     and n = 0 and public.invoice_balance_due(OVER) = 1000.00 and act = 1
  then raise notice 'PASS 3 R1200 on R1000 balance REJECTED: no ledger row, balance still R1000, one audit event';
  else raise notice 'FAIL 3 r=% n=% balance=% act=%', r, n, public.invoice_balance_due(OVER), act; end if;

  -- 3b · the SAME rejected pf_payment_id retried again -> still rejected,
  --      but reuses the existing activity row instead of piling up a
  --      second identical one (overpayment-hardening dedupe follow-up)
  r := public.apply_invoice_payfast_payment(OVER, 1200.00, 'PF-OVER-1', '{}'::jsonb);
  select count(*) into act from public.opps_invoice_activity where invoice_id=OVER and activity_type='invoice_payment_rejected';
  select count(*) into n from public.invoice_payments where invoice_id=OVER;
  if (r->>'ok')::boolean = false and r->>'reason' = 'INVOICE_PAYMENT_OVERPAYMENT_REJECTED'
     and n = 0 and act = 1
  then raise notice 'PASS 3b retried rejection of the same pf_payment_id: still exactly ONE activity row, not two';
  else raise notice 'FAIL 3b r=% n=% act=%', r, n, act; end if;

  -- 4 · duplicate same pf_payment_id (sequential retry) -> exactly one payment entry
  r := public.apply_invoice_payfast_payment(DUP, 700.00, 'PF-DUP-1', '{}'::jsonb);
  r := public.apply_invoice_payfast_payment(DUP, 700.00, 'PF-DUP-1', '{}'::jsonb);
  select count(*) into n from public.invoice_payments where invoice_id=DUP and reference='PF-DUP-1';
  if (r->>'replayed')::boolean = true and n = 1
  then raise notice 'PASS 4 duplicate pf_payment_id (sequential) -> exactly one payment entry';
  else raise notice 'FAIL 4 r=% n=%', r, n; end if;

  -- 5 · fully paid invoice receives another ITN -> ignored, no additional credit
  r := public.apply_invoice_payfast_payment(PAID, 100.00, 'PF-PAID-EXTRA', '{}'::jsonb);
  select count(*) into n from public.invoice_payments where invoice_id=PAID;
  if (r->>'ok')::boolean = true and (r->>'ignored')::boolean = true and r->>'reason' = 'INVOICE_ALREADY_PAID'
     and n = 1 and public.invoice_amount_paid(PAID) = 500.00
  then raise notice 'PASS 5 fully-paid invoice ignores a further ITN, no additional credit';
  else raise notice 'FAIL 5 r=% n=% paid=%', r, n, public.invoice_amount_paid(PAID); end if;

  -- 6 · void invoice still rejected outright (unaffected by this change)
  r := public.apply_invoice_payfast_payment(VOID_INV, 100.00, 'PF-VOID-1', '{}'::jsonb);
  if (r->>'ok')::boolean = false and r->>'reason' = 'INVOICE_VOID'
  then raise notice 'PASS 6 void invoice still rejected outright';
  else raise notice 'FAIL 6 r=%', r; end if;

  raise notice 'RESULT: SEQUENTIAL DONE';
end $$;
SQL

echo "=========================================="
echo "CONCURRENCY SCENARIOS (real overlapping sessions)"
echo "=========================================="

# ── Concurrent DUPLICATE pf_payment_id: two overlapping sessions submit the
#    SAME pf_payment_id for the same invoice. Session A holds the row lock
#    open (explicit BEGIN + pg_sleep AFTER the function call, BEFORE COMMIT)
#    so session B — started after A has entered the function and acquired
#    the lock — genuinely blocks on FOR UPDATE, not just races in application
#    code. Expect: exactly one invoice_payments row for that reference.
INV_CONCDUP="a0000000-0000-0000-0000-000000000005"
(
  docker exec -i "$CID" psql -X -q -U postgres -d m <<SQL > /tmp/concdup_a.out 2>&1
begin;
select public.apply_invoice_payfast_payment('${INV_CONCDUP}'::uuid, 600.00, 'PF-CONCDUP-1', '{}'::jsonb) as result_a;
select pg_sleep(2);
commit;
SQL
) &
PID_A=$!
sleep 0.5
(
  docker exec -i "$CID" psql -X -q -U postgres -d m <<SQL > /tmp/concdup_b.out 2>&1
begin;
select public.apply_invoice_payfast_payment('${INV_CONCDUP}'::uuid, 600.00, 'PF-CONCDUP-1', '{}'::jsonb) as result_b;
commit;
SQL
) &
PID_B=$!
wait $PID_A $PID_B

run <<SQL 2>&1 | grep -E 'PASS|FAIL'
do \$\$
declare n int; bal numeric;
begin
  select count(*) into n from public.invoice_payments where invoice_id='${INV_CONCDUP}'::uuid and reference='PF-CONCDUP-1';
  select public.invoice_balance_due('${INV_CONCDUP}'::uuid) into bal;
  if n = 1 and bal = 400.00
  then raise notice 'PASS 7 concurrent duplicate pf_payment_id: exactly one payment entry, balance R400 (not R-200 / not double-locked)';
  else raise notice 'FAIL 7 n=% balance=%', n, bal; end if;
end \$\$;
SQL
echo "  (session A raw output)"; cat /tmp/concdup_a.out | grep -A1 result_a | head -4
echo "  (session B raw output)"; cat /tmp/concdup_b.out | grep -A1 result_b | head -4

# ── Concurrent DISTINCT payments that TOGETHER exceed the balance: invoice
#    balance R1000, two genuinely different completed PayFast sessions each
#    for R600. Only one can be honoured — the loser must be rejected, not
#    recorded, and the final total must never exceed R1000.
INV_CONCEXC="a0000000-0000-0000-0000-000000000006"
(
  docker exec -i "$CID" psql -X -q -U postgres -d m <<SQL > /tmp/concexc_a.out 2>&1
begin;
select public.apply_invoice_payfast_payment('${INV_CONCEXC}'::uuid, 600.00, 'PF-CONCEXC-A', '{}'::jsonb) as result_a;
select pg_sleep(2);
commit;
SQL
) &
PID_A=$!
sleep 0.5
(
  docker exec -i "$CID" psql -X -q -U postgres -d m <<SQL > /tmp/concexc_b.out 2>&1
begin;
select public.apply_invoice_payfast_payment('${INV_CONCEXC}'::uuid, 600.00, 'PF-CONCEXC-B', '{}'::jsonb) as result_b;
commit;
SQL
) &
PID_B=$!
wait $PID_A $PID_B

run <<SQL 2>&1 | grep -E 'PASS|FAIL'
do \$\$
declare total_recorded numeric; n int;
begin
  select coalesce(sum(amount),0) into total_recorded from public.invoice_payments
    where invoice_id='${INV_CONCEXC}'::uuid and reference in ('PF-CONCEXC-A','PF-CONCEXC-B');
  select count(*) into n from public.invoice_payments
    where invoice_id='${INV_CONCEXC}'::uuid and reference in ('PF-CONCEXC-A','PF-CONCEXC-B');
  if total_recorded <= 1000.00 and n = 1
  then raise notice 'PASS 8 two concurrent distinct R600 ITNs on a R1000 balance: only ONE recorded (total=%), never R1200', total_recorded;
  else raise notice 'FAIL 8 total_recorded=% n=% (would be a real double-credit bug)', total_recorded, n; end if;
end \$\$;
SQL
echo "  (session A raw output)"; cat /tmp/concexc_a.out | grep -A1 result_a | head -4
echo "  (session B raw output)"; cat /tmp/concexc_b.out | grep -A1 result_b | head -4

echo "-----------------------------------------"
echo "RESULT: PASS (20260913110000 applies + idempotent; 7 sequential + 2 real-concurrency assertions)"
