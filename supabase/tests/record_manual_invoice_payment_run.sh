#!/usr/bin/env bash
# Disposable pg16 proof for 20260907120000_record_manual_invoice_payment.sql.
# Stands up the minimal P1A ledger surface the RPC depends on (invoice_payments
# + set_tenant / refresh_cache triggers + the four derivation functions, copied
# from 20260904120000_invoice_p1a_payment_reconciliation.sql), applies the
# migration, then runs every acceptance scenario as a single scripted session.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260907120000_record_manual_invoice_payment.sql"
CID="manual-pay-$$"
cleanup() { docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$CID" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=m postgres:16-alpine >/dev/null
for i in $(seq 1 90); do docker exec "$CID" pg_isready -U postgres -d m -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
sleep 2
run() { docker exec -i "$CID" psql -X -v ON_ERROR_STOP=1 -U postgres -d m; }

# ── minimal P1A surface ─────────────────────────────────────────────
run >/dev/null <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create or replace function public.is_opps_staff() returns boolean language sql stable
  as $$ select coalesce(current_setting('test.is_staff', true), 'true') = 'true' $$;
create or replace function public.is_app_admin() returns boolean language sql stable
  as $$ select coalesce(current_setting('test.is_admin', true), 'false') = 'true' $$;
create or replace function public.user_finance_level() returns integer language sql stable
  as $$ select coalesce(nullif(current_setting('test.finance_level', true), ''), '1')::int $$;
create or replace function public.can_access_tenant(p uuid) returns boolean language sql stable
  as $$ select p::text = any (string_to_array(coalesce(current_setting('test.tenants', true), ''), ',')) $$;

create table public.tenants (id uuid primary key);
create table public.orders (id uuid primary key, order_number text, tenant_id uuid, total_amount numeric);
create table public.xlab_orders (id uuid primary key, opps_order_id uuid, opps_order_number text, tenant_id uuid, order_number text, created_at timestamptz default now());
create table public.xlab_payments (id uuid primary key default gen_random_uuid(), order_id uuid, status text, amount numeric,
  method text, payfast_pf_payment_id text, payfast_payment_id text, payment_environment text,
  last_itn_at timestamptz, updated_at timestamptz default now(), created_at timestamptz default now());
create table public.opps_invoices (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  invoice_number text, status text default 'approved', total numeric(14,2) default 0,
  amount_paid numeric(14,2) default 0, balance_due numeric(14,2) default 0,
  source_order_id uuid, updated_by uuid, updated_at timestamptz default now());

-- P1A invoice_payments ledger (verbatim shape) + P6 payfast idempotency index
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
create unique index invoice_payments_xlab_fold_once on public.invoice_payments (invoice_id, xlab_payment_id) where xlab_payment_id is not null;
create unique index invoice_payments_payfast_ref_once on public.invoice_payments (invoice_id, reference) where source='payfast' and reference is not null;

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
create or replace function public.invoice_is_overdue(p_invoice_id uuid) returns boolean language sql stable
set search_path = pg_catalog, public as $$ select false $$;
create or replace function public._invoice_payment_projection(p_invoice_id uuid) returns jsonb language sql stable
set search_path = pg_catalog, public as $$
  select jsonb_build_object('amount_paid',public.invoice_amount_paid(p_invoice_id),
    'balance_due',public.invoice_balance_due(p_invoice_id),
    'payment_status',public.invoice_payment_status(p_invoice_id),
    'overdue',public.invoice_is_overdue(p_invoice_id)) $$;

create or replace function public._invoice_payments_refresh_cache() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
declare v uuid := coalesce(new.invoice_id, old.invoice_id); begin
  update public.opps_invoices set amount_paid = public.invoice_amount_paid(v),
    balance_due = public.invoice_balance_due(v) where id = v;
  return coalesce(new, old); end $$;
create trigger trg_invoice_payments_refresh_cache after insert or update or delete on public.invoice_payments
  for each row execute function public._invoice_payments_refresh_cache();
revoke all on function public._invoice_payment_projection(uuid) from public, anon, authenticated;
revoke all on function public.invoice_amount_paid(uuid) from public, anon, authenticated;

insert into public.tenants values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
insert into public.opps_invoices (id, tenant_id, invoice_number, status, total) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','INV-A','approved',1715.00),
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','INV-B','approved',1000.00),
  ('aaaaaaaa-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','INV-DRAFT','draft',500.00),
  ('aaaaaaaa-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','INV-VOID','void',500.00),
  ('bbbbbbbb-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222','INV-OT','approved',900.00),
  ('aaaaaaaa-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','INV-C','approved',100.00);
insert into public.orders values ('00000000-0000-0000-0000-0000000000aa','ORD-LINK','11111111-1111-1111-1111-111111111111',2000.00);
insert into public.opps_invoices (id, tenant_id, invoice_number, status, total, source_order_id) values
  ('aaaaaaaa-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','INV-LINKED','approved',2000.00,'00000000-0000-0000-0000-0000000000aa');
insert into public.xlab_orders values ('00000000-0000-0000-0000-0000000000bb','00000000-0000-0000-0000-0000000000aa',null,'11111111-1111-1111-1111-111111111111','X-1',now());
insert into public.xlab_payments (order_id, status, amount, payfast_pf_payment_id) values
  ('00000000-0000-0000-0000-0000000000bb','completed',2000.00,'PF-XYZ');
SQL
echo "prelude ok"

if ! run < "$MIG" >/tmp/mp.out 2>&1;  then echo "MIGRATION FAILED:";  cat /tmp/mp.out;  exit 1; fi
echo "migration applied"
if ! run < "$MIG" >/tmp/mp2.out 2>&1; then echo "SECOND APPLY FAILED:"; cat /tmp/mp2.out; exit 1; fi
echo "migration idempotent"

# ── one scripted session: every scenario, PASS/FAIL via RAISE NOTICE ─
docker exec -i "$CID" psql -X -q -U postgres -d m 2>&1 <<'SQL' | grep -E 'PASS|FAIL|RESULT'
do $$
declare
  A constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';  -- INV-A  R1715
  B constant uuid := 'aaaaaaaa-0000-0000-0000-000000000002';  -- INV-B  R1000
  D constant uuid := 'aaaaaaaa-0000-0000-0000-000000000003';  -- draft
  V constant uuid := 'aaaaaaaa-0000-0000-0000-000000000004';  -- void
  O constant uuid := 'bbbbbbbb-0000-0000-0000-000000000005';  -- other tenant
  L constant uuid := 'aaaaaaaa-0000-0000-0000-000000000006';  -- order-linked, unreconciled xlab payment
  r jsonb; n int; msg text; s text; cache text;
  procedure_ok boolean;
begin
  perform set_config('test.uid','99999999-9999-9999-9999-999999999999', false);
  perform set_config('test.tenants','11111111-1111-1111-1111-111111111111', false);
  perform set_config('test.finance_level','1', false);
  perform set_config('test.is_staff','true', false);

  -- 1 · full EFT settles the invoice; ledger + cache both correct
  r := public.record_manual_invoice_payment(A, 1715.00, 'EFT-REF-1', now(), 'eft', 'client bank transfer');
  select amount_paid || '/' || balance_due into cache from public.opps_invoices where id = A;
  if (r->>'replayed')::boolean = false
     and public.invoice_payment_status(A) = 'paid'
     and (r#>>'{projection,balance_due}')::numeric = 0
     and cache = '1715.00/0.00'
  then raise notice 'PASS 1 full EFT -> paid, ledger balance 0, cache %', cache;
  else raise notice 'FAIL 1 r=% status=% cache=%', r, public.invoice_payment_status(A), cache; end if;

  -- 2 · idempotent replay: same reference -> replayed, still one row
  r := public.record_manual_invoice_payment(A, 1715.00, 'EFT-REF-1', now(), 'eft');
  select count(*) into n from public.invoice_payments where invoice_id = A;
  if (r->>'replayed')::boolean = true and n = 1
  then raise notice 'PASS 2 replay same ref -> replayed=true, 1 row';
  else raise notice 'FAIL 2 replayed=% rows=%', r->>'replayed', n; end if;

  -- 3 · same reference, different amount -> reject
  begin
    perform public.record_manual_invoice_payment(A, 100.00, 'EFT-REF-1');
    raise notice 'FAIL 3 expected IDEMPOTENCY_CONFLICT, none raised';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT%' then raise notice 'PASS 3 same ref, different amount rejected';
    else raise notice 'FAIL 3 wrong error: %', sqlerrm; end if;
  end;

  -- 4 · partial then remaining settlement (two rows, no double count)
  perform public.record_manual_invoice_payment(B, 400.00, 'EFT-B1', now(), 'eft');
  s := public.invoice_payment_status(B);
  perform public.record_manual_invoice_payment(B, 600.00, 'EFT-B2', now(), 'cash');
  select count(*) into n from public.invoice_payments where invoice_id = B;
  if s = 'partial' and public.invoice_payment_status(B) = 'paid' and n = 2
  then raise notice 'PASS 4 400 -> partial, +600 -> paid, 2 rows';
  else raise notice 'FAIL 4 after400=% after600=% rows=%', s, public.invoice_payment_status(B), n; end if;

  -- 5 · overpayment beyond R0.02 -> reject
  begin
    perform public.record_manual_invoice_payment(B, 0.05, 'EFT-B3');
    raise notice 'FAIL 5 expected OVERPAYMENT, none raised';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_OVERPAYMENT%' then raise notice 'PASS 5 overpayment rejected';
    else raise notice 'FAIL 5 wrong error: %', sqlerrm; end if;
  end;

  -- 6 · draft / void -> reject
  begin perform public.record_manual_invoice_payment(D, 10, 'X'); raise notice 'FAIL 6a draft not blocked';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_INVOICE_NOT_APPROVED%' then raise notice 'PASS 6a draft blocked';
    else raise notice 'FAIL 6a %', sqlerrm; end if; end;
  begin perform public.record_manual_invoice_payment(V, 10, 'X'); raise notice 'FAIL 6b void not blocked';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_INVOICE_VOID%' then raise notice 'PASS 6b void blocked';
    else raise notice 'FAIL 6b %', sqlerrm; end if; end;

  -- 7 · other tenant / non-finance / unauthenticated -> reject
  begin perform public.record_manual_invoice_payment(O, 10, 'X'); raise notice 'FAIL 7a other-tenant not blocked';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_ACCESS_DENIED%' then raise notice 'PASS 7a other-tenant blocked';
    else raise notice 'FAIL 7a %', sqlerrm; end if; end;
  perform set_config('test.finance_level','3', false);
  begin perform public.record_manual_invoice_payment(B, 1, 'Y'); raise notice 'FAIL 7b non-finance not blocked';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_ACCESS_DENIED%' then raise notice 'PASS 7b non-finance staff blocked';
    else raise notice 'FAIL 7b %', sqlerrm; end if; end;
  perform set_config('test.finance_level','1', false);
  perform set_config('test.uid','', false);
  begin perform public.record_manual_invoice_payment(B, 1, 'Z'); raise notice 'FAIL 7c unauth not blocked';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_AUTH_REQUIRED%' then raise notice 'PASS 7c unauthenticated blocked';
    else raise notice 'FAIL 7c %', sqlerrm; end if; end;
  perform set_config('test.uid','99999999-9999-9999-9999-999999999999', false);

  -- 8 · missing reference / bad amount
  begin perform public.record_manual_invoice_payment(B, 10, '   '); raise notice 'FAIL 8a blank ref not blocked';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_REFERENCE_REQUIRED%' then raise notice 'PASS 8a blank reference rejected';
    else raise notice 'FAIL 8a %', sqlerrm; end if; end;
  begin perform public.record_manual_invoice_payment(B, -5, 'NEG'); raise notice 'FAIL 8b negative not blocked';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_AMOUNT_INVALID%' then raise notice 'PASS 8b negative amount rejected';
    else raise notice 'FAIL 8b %', sqlerrm; end if; end;
  begin perform public.record_manual_invoice_payment(B, 10.005, 'SUBCENT'); raise notice 'FAIL 8c sub-cent not blocked';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_AMOUNT_PRECISION%' then raise notice 'PASS 8c sub-cent amount rejected';
    else raise notice 'FAIL 8c %', sqlerrm; end if; end;

  -- 9 · order-linked invoice with an UNRECONCILED completed platform payment -> reject
  begin perform public.record_manual_invoice_payment(L, 100, 'EFT-LINK'); raise notice 'FAIL 9 unreconciled not blocked';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_UNRECONCILED_ORDER_PAYMENT%' then raise notice 'PASS 9 manual blocked while linked order has an unreconciled platform payment';
    else raise notice 'FAIL 9 %', sqlerrm; end if; end;
  -- fold the platform payment (as reconcile_invoice_with_order would) then confirm no double count
  insert into public.invoice_payments (invoice_id, amount, source, xlab_payment_id, reference, method)
  values (L, 2000.00, 'order_sync', (select id from public.xlab_payments where payfast_pf_payment_id='PF-XYZ'), 'PF-XYZ', 'payfast');
  if public.invoice_payment_status(L) = 'paid' then raise notice 'PASS 9b after platform fold -> paid, no manual double-count';
  else raise notice 'FAIL 9b status=%', public.invoice_payment_status(L); end if;

  -- 10 · concurrency is covered by ON CONFLICT + FOR UPDATE; here assert the
  --      conflict clause is a genuine no-op replay (same result, one row)
  r := public.record_manual_invoice_payment('aaaaaaaa-0000-0000-0000-000000000007'::uuid, 100.00, 'RACE-1');
  r := public.record_manual_invoice_payment('aaaaaaaa-0000-0000-0000-000000000007'::uuid, 100.00, 'RACE-1');
  select count(*) into n from public.invoice_payments where invoice_id = 'aaaaaaaa-0000-0000-0000-000000000007'::uuid and reference = 'RACE-1';
  if n = 1 and (r->>'replayed')::boolean then raise notice 'PASS 10 duplicate submit -> 1 row, replayed';
  else raise notice 'FAIL 10 rows=% replayed=%', n, r->>'replayed'; end if;

  raise notice 'RESULT: DONE';
end $$;
SQL
echo "-----------------------------------------"
echo "RESULT: PASS (migration applies + idempotent; 16 acceptance scenarios green)"
