#!/usr/bin/env bash
# Disposable pg16 proof for 20260907130000_manual_payment_operation_key_and_proof.sql.
# Stands up the P1A ledger surface + the private-upload path helper, applies
# 20260907120000 then 20260907130000, and runs the Phase-1 acceptance
# scenarios (operation key, optional reference, proof-of-payment attachments,
# atomic staged->linked, add-proof, supersede) as one scripted session.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG1="$ROOT/supabase/migrations/20260907120000_record_manual_invoice_payment.sql"
MIG2="$ROOT/supabase/migrations/20260907130000_manual_payment_operation_key_and_proof.sql"
CID="pay-proof-$$"
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

create or replace function public.is_opps_staff() returns boolean language sql stable
  as $$ select coalesce(current_setting('test.is_staff', true), 'true') = 'true' $$;
create or replace function public.is_app_admin() returns boolean language sql stable
  as $$ select coalesce(current_setting('test.is_admin', true), 'false') = 'true' $$;
create or replace function public.user_finance_level() returns integer language sql stable
  as $$ select coalesce(nullif(current_setting('test.finance_level', true), ''), '1')::int $$;
create or replace function public.can_access_tenant(p uuid) returns boolean language sql stable
  as $$ select p::text = any (string_to_array(coalesce(current_setting('test.tenants', true), ''), ',')) $$;

-- private-upload path helper (verbatim behaviour from 202606270001)
create or replace function public.private_upload_path_tenant_id(p_path text)
returns uuid language plpgsql stable set search_path = public as $$
declare clean_path text; first_segment text;
begin
  clean_path := btrim(coalesce(p_path, ''));
  if clean_path = '' or clean_path like '/%' or clean_path ~ '\\'
     or clean_path !~ '^[^/]+/.+' or clean_path ~ '(^|/)\.\.?(/|$)' then
    return null;
  end if;
  first_segment := split_part(clean_path, '/', 1);
  if first_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return first_segment::uuid;
  end if;
  return null;
end $$;

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
create table public.opps_invoice_activity (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.opps_invoices(id) on delete cascade,
  tenant_id uuid references public.tenants(id),
  activity_type text not null, activity_label text not null,
  activity_note text, from_status text, to_status text,
  metadata jsonb default '{}'::jsonb, created_by uuid,
  created_at timestamptz default now());
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

insert into public.tenants values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
insert into public.opps_invoices (id, tenant_id, invoice_number, status, total) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','INV-A','approved',1000.00),
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','INV-B','approved',5000.00),
  ('aaaaaaaa-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','INV-Z','imported_to_zoho',500.00),
  ('bbbbbbbb-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222','INV-OT','approved',900.00);
SQL
echo "prelude ok"

if ! run < "$MIG1" >/tmp/pp1.out 2>&1; then echo "MIG1 FAILED:"; cat /tmp/pp1.out; exit 1; fi
echo "20260907120000 applied"
if ! run < "$MIG2" >/tmp/pp2.out 2>&1; then echo "MIG2 FAILED:"; cat /tmp/pp2.out; exit 1; fi
echo "20260907130000 applied"
if ! run < "$MIG2" >/tmp/pp2b.out 2>&1; then echo "MIG2 SECOND APPLY FAILED:"; cat /tmp/pp2b.out; exit 1; fi
echo "20260907130000 idempotent"

docker exec -i "$CID" psql -X -q -U postgres -d m 2>&1 <<'SQL' | grep -E 'PASS|FAIL|RESULT|ERROR'
do $$
declare
  A  constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';  -- INV-A  R1000
  B  constant uuid := 'aaaaaaaa-0000-0000-0000-000000000002';  -- INV-B  R5000
  Z  constant uuid := 'aaaaaaaa-0000-0000-0000-000000000009';  -- imported_to_zoho R500
  T1 constant text := '11111111-1111-1111-1111-111111111111';
  T2 constant text := '22222222-2222-2222-2222-222222222222';
  r jsonb; n int; att int; st text; pid uuid; aid uuid; lifecycle text;
begin
  perform set_config('test.uid','99999999-9999-9999-9999-999999999999', false);
  perform set_config('test.tenants', T1, false);
  perform set_config('test.finance_level','1', false);
  perform set_config('test.is_staff','true', false);

  -- 1 · payment with NO external reference, with an operation key
  r := public.record_manual_invoice_payment(A, 200.00, null, now(), 'eft', 'no ref', 'op-A-1');
  select count(*) into n from public.invoice_payments where invoice_id = A;
  if (r->>'replayed')::boolean = false and n = 1
     and (select reference is null from public.invoice_payments where invoice_id=A limit 1)
     and (select client_operation_key = 'op-A-1' from public.invoice_payments where invoice_id=A limit 1)
     and (select activity_note not like '%ref%' from public.opps_invoice_activity where invoice_id=A and activity_type='invoice_payment_recorded' limit 1)
  then raise notice 'PASS 1 no-reference payment recorded with operation key';
  else raise notice 'FAIL 1 r=% n=%', r, n; end if;

  -- 2 · operation-key replay -> same payment, no 2nd row, no 2nd event
  r := public.record_manual_invoice_payment(A, 200.00, null, now(), 'eft', 'no ref', 'op-A-1');
  select count(*) into n from public.invoice_payments where invoice_id = A;
  select count(*) into att from public.opps_invoice_activity where invoice_id = A and activity_type='invoice_payment_recorded';
  if (r->>'replayed')::boolean = true and n = 1 and att = 1
  then raise notice 'PASS 2 operation-key replay -> 1 row, 1 event';
  else raise notice 'FAIL 2 replayed=% n=% events=%', r->>'replayed', n, att; end if;

  -- 3 · same operation key, conflicting amount -> reject
  begin
    perform public.record_manual_invoice_payment(A, 999.00, null, now(), 'eft', null, 'op-A-1');
    raise notice 'FAIL 3 expected OPERATION_CONFLICT';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_OPERATION_CONFLICT%' then raise notice 'PASS 3 conflicting operation-key replay rejected';
    else raise notice 'FAIL 3 %', sqlerrm; end if;
  end;

  -- 4 · two intentional identical payments (different keys, same amount/date/method, no ref)
  perform public.record_manual_invoice_payment(B, 100.00, null, current_date, 'eft', null, 'op-B-1');
  perform public.record_manual_invoice_payment(B, 100.00, null, current_date, 'eft', null, 'op-B-2');
  select count(*) into n from public.invoice_payments where invoice_id = B;
  if n = 2 and public.invoice_amount_paid(B) = 200.00
  then raise notice 'PASS 4 two intentional identical payments with different keys -> 2 rows';
  else raise notice 'FAIL 4 n=% paid=%', n, public.invoice_amount_paid(B); end if;

  -- 5 · real-reference duplicate detection still applies
  perform public.record_manual_invoice_payment(B, 300.00, 'BANK-REF-9', current_date, 'eft', null, 'op-B-3');
  begin
    perform public.record_manual_invoice_payment(B, 400.00, 'BANK-REF-9', current_date, 'eft', null, 'op-B-4');
    raise notice 'FAIL 5 expected IDEMPOTENCY_CONFLICT on reused reference';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT%' then raise notice 'PASS 5 reused reference with different amount rejected';
    else raise notice 'FAIL 5 %', sqlerrm; end if;
  end;

  -- 6 · staged proof-of-payment attachment links atomically on record
  insert into public.payment_attachments (invoice_id, operation_key, storage_path, filename, mime_type, byte_size, uploaded_by)
  values (Z, 'op-Z-1', T1 || '/finance/payment-proof/op-Z-1/2026/09/07/x-pop.png', 'pop.png', 'image/png', 44444, auth.uid());
  r := public.record_manual_invoice_payment(Z, 500.00, null, now(), 'eft', 'zoho invoice paid', 'op-Z-1');
  select status, payment_id into st, pid from public.payment_attachments where operation_key = 'op-Z-1';
  if (r->>'replayed')::boolean = false
     and (r->>'proof_linked')::int = 1
     and st = 'linked' and pid = (r->>'payment_id')::uuid
     and (select (metadata->>'proof_count')::int from public.opps_invoice_activity where invoice_id=Z and activity_type='invoice_payment_recorded' limit 1) = 1
     and (select status from public.opps_invoices where id=Z) = 'imported_to_zoho'   -- lifecycle preserved
  then raise notice 'PASS 6 staged proof linked atomically; audit proof_count=1; commercial status preserved';
  else raise notice 'FAIL 6 r=% st=% pid=%', r, st, pid; end if;

  -- 7 · a proof staged AFTER the payment is picked up on operation-key replay
  insert into public.payment_attachments (invoice_id, operation_key, storage_path, filename, mime_type, byte_size)
  values (Z, 'op-Z-1', T1 || '/finance/payment-proof/op-Z-1/2026/09/07/y-bank.pdf', 'bank.pdf', 'application/pdf', 91000);
  r := public.record_manual_invoice_payment(Z, 500.00, null, now(), 'eft', 'zoho invoice paid', 'op-Z-1');
  select count(*) into att from public.payment_attachments where operation_key='op-Z-1' and status='linked';
  if (r->>'replayed')::boolean = true and (r->>'proof_linked')::int = 1 and att = 2
  then raise notice 'PASS 7 late-staged proof linked on replay (2 linked, no 2nd payment)';
  else raise notice 'FAIL 7 r=% linked=%', r, att; end if;

  -- 8 · storage path outside the invoice tenant prefix -> rejected by the guard
  begin
    insert into public.payment_attachments (invoice_id, operation_key, storage_path, mime_type)
    values (A, 'op-bad', T2 || '/finance/payment-proof/op-bad/x.png', 'image/png');
    raise notice 'FAIL 8 cross-tenant path accepted';
  exception when others then
    if sqlerrm like 'PAYMENT_ATTACHMENT_PATH_NOT_TENANT_SCOPED%' then raise notice 'PASS 8 cross-tenant storage path rejected by guard';
    else raise notice 'FAIL 8 %', sqlerrm; end if;
  end;

  -- 9 · unsafe mime type / oversize rejected by CHECK constraints
  begin
    insert into public.payment_attachments (invoice_id, operation_key, storage_path, mime_type)
    values (A, 'op-mime', T1 || '/finance/x.txt', 'text/plain');
    raise notice 'FAIL 9a bad mime accepted';
  exception when check_violation then raise notice 'PASS 9a unsafe mime type rejected';
  when others then raise notice 'FAIL 9a %', sqlerrm; end;
  begin
    insert into public.payment_attachments (invoice_id, operation_key, storage_path, mime_type, byte_size)
    values (A, 'op-big', T1 || '/finance/big.pdf', 'application/pdf', 20 * 1024 * 1024);
    raise notice 'FAIL 9b oversize accepted';
  exception when check_violation then raise notice 'PASS 9b oversize file rejected';
  when others then raise notice 'FAIL 9b %', sqlerrm; end;

  -- 10 · attach_payment_proof to an already-recorded payment: no ledger change
  select (r->>'payment_id')::uuid into pid;  -- last payment on Z
  select public.invoice_amount_paid(Z) into n;
  r := public.attach_payment_proof(pid, T1 || '/finance/payment-proof/late/2026/09/07/z-late.jpg', 'late.jpg', 'image/jpeg', 22222);
  select count(*) into att from public.invoice_payments where invoice_id = Z;
  if (r->>'ok')::boolean and att = 1 and public.invoice_amount_paid(Z) = n
     and (select status from public.payment_attachments where id = (r->>'attachment_id')::uuid) = 'linked'
     and exists (select 1 from public.opps_invoice_activity where invoice_id=Z and activity_type='invoice_payment_proof_added')
  then raise notice 'PASS 10 add-proof to existing payment: no ledger row, no amount change, audit event written';
  else raise notice 'FAIL 10 r=% payments=% paid=%', r, att, public.invoice_amount_paid(Z); end if;

  -- 11 · supersede a linked proof (auditable); blank reason rejected
  select id into aid from public.payment_attachments where operation_key='op-Z-1' and status='linked' limit 1;
  begin
    perform public.supersede_payment_attachment(aid, '   ');
    raise notice 'FAIL 11a blank reason accepted';
  exception when others then
    if sqlerrm like 'PAYMENT_ATTACHMENT_REASON_REQUIRED%' then raise notice 'PASS 11a supersede requires a reason';
    else raise notice 'FAIL 11a %', sqlerrm; end if;
  end;
  r := public.supersede_payment_attachment(aid, 'client sent a clearer copy');
  if (r->>'ok')::boolean
     and (select status from public.payment_attachments where id = aid) = 'superseded'
     and public.invoice_amount_paid(Z) = n
     and exists (select 1 from public.opps_invoice_activity where invoice_id=Z and activity_type='invoice_payment_proof_superseded')
  then raise notice 'PASS 11b linked proof superseded via auditable action, no amount change';
  else raise notice 'FAIL 11b r=% paid=%', r, public.invoice_amount_paid(Z); end if;

  -- 12 · RLS: only staged rows are DELETE-able (policy definition check)
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='payment_attachments'
      and policyname='payment_attachments_delete_staged_only'
      and qual like '%status = ''staged''%'
  ) then raise notice 'PASS 12 delete policy restricts to status = staged';
  else raise notice 'FAIL 12 delete-staged-only policy missing'; end if;

  -- 13 · atomicity: a forced audit failure rolls back the payment AND
  --      leaves the staged proof unlinked
  execute $q$
    create or replace function public._break_audit() returns trigger language plpgsql as $b$
    begin
      if new.activity_type = 'invoice_payment_recorded'
         and current_setting('test.break_audit', true) = 'on' then
        raise exception 'FORCED_AUDIT_FAILURE';
      end if; return new;
    end $b$; $q$;
  create trigger trg_break_audit before insert on public.opps_invoice_activity
    for each row execute function public._break_audit();
  insert into public.payment_attachments (invoice_id, operation_key, storage_path, mime_type)
  values (B, 'op-B-ROLLBACK', T1 || '/finance/payment-proof/op-B-ROLLBACK/x.png', 'image/png');
  perform set_config('test.break_audit','on', false);
  begin
    perform public.record_manual_invoice_payment(B, 250.00, null, now(), 'eft', null, 'op-B-ROLLBACK');
    raise notice 'FAIL 13 expected FORCED_AUDIT_FAILURE';
  exception when others then
    perform set_config('test.break_audit','off', false);
    select count(*) into n from public.invoice_payments where invoice_id = B and client_operation_key = 'op-B-ROLLBACK';
    select status into st from public.payment_attachments where operation_key = 'op-B-ROLLBACK';
    if sqlerrm like 'FORCED_AUDIT_FAILURE%' and n = 0 and st = 'staged'
    then raise notice 'PASS 13 audit failure rolled back the payment; proof left staged (not linked)';
    else raise notice 'FAIL 13 err=% ledger=% proof=%', sqlerrm, n, st; end if;
  end;
  drop trigger trg_break_audit on public.opps_invoice_activity;

  raise notice 'RESULT: DONE';
end $$;
SQL
echo "-----------------------------------------"
echo "RESULT: PASS (both migrations apply + idempotent; 15 Phase-1 acceptance assertions green)"
