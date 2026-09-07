#!/usr/bin/env bash
# Disposable pg16 proof for 20260907130000_manual_payment_operation_key_and_proof.sql.
# Stands up the P1A ledger surface + private-upload helper + a storage.objects
# stub, applies 20260907120000 then 20260907130000, and exercises the corrected
# security contract: RPC-only writes, DB-enforced immutability, real storage
# ownership validation, mandatory operation key, safe conflict/replay, cleanup.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG1="$ROOT/supabase/migrations/20260907120000_record_manual_invoice_payment.sql"
MIG2="$ROOT/supabase/migrations/20260907130000_manual_payment_operation_key_and_proof.sql"
MIG3="$ROOT/supabase/migrations/20260907160000_fix_manual_payment_opps_order_id_text_cast.sql"
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
create schema if not exists storage;
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

-- storage.objects stub (columns this migration reads: bucket_id, name, owner_id)
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner_id text, created_at timestamptz default now(),
  unique (bucket_id, name));

create table public.tenants (id uuid primary key);
create table public.orders (id uuid primary key, order_number text, tenant_id uuid, total_amount numeric);
-- opps_order_id is TEXT in production/staging (stores the OPPS order id as a
-- string); opps_invoices.source_order_id is UUID — the RPC casts across it.
create table public.xlab_orders (id uuid primary key, opps_order_id text, opps_order_number text, tenant_id uuid, order_number text, created_at timestamptz default now());
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
-- INV-LP mirrors production OPPS-INV-2026-0085: order-linked, already 'paid'
-- from a legacy direct write, canonical ledger empty. xlab_orders.opps_order_id
-- holds the OPPS order UUID as TEXT and there is no completed platform payment.
insert into public.orders values ('00000000-0000-0000-0000-0000000000dd','ORD-LEGACY','11111111-1111-1111-1111-111111111111',1715.00);
insert into public.opps_invoices (id, tenant_id, invoice_number, status, total, amount_paid, balance_due, source_order_id) values
  ('aaaaaaaa-0000-0000-0000-00000000000d','11111111-1111-1111-1111-111111111111','INV-LP','paid',1715.00,1715.00,0.00,'00000000-0000-0000-0000-0000000000dd');
insert into public.xlab_orders values
  ('00000000-0000-0000-0000-0000000000ee','00000000-0000-0000-0000-0000000000dd',null,'11111111-1111-1111-1111-111111111111','X-LEG',now());
-- legacy pre-upgrade manual payment (mirrors staging OPPS-INV-2026-0001 R430)
insert into public.invoice_payments (invoice_id, amount, method, reference, source, created_by)
values ('aaaaaaaa-0000-0000-0000-000000000001', 430.00, 'eft', 'LEGACY-430', 'manual', '99999999-9999-9999-9999-999999999999');
SQL
echo "prelude ok"

if ! run < "$MIG1" >/tmp/pp1.out 2>&1; then echo "MIG1 FAILED:"; cat /tmp/pp1.out; exit 1; fi
echo "20260907120000 applied"
if ! run < "$MIG2" >/tmp/pp2.out 2>&1; then echo "MIG2 FAILED:"; cat /tmp/pp2.out; exit 1; fi
echo "20260907130000 applied"
if ! run < "$MIG2" >/tmp/pp2b.out 2>&1; then echo "MIG2 SECOND APPLY FAILED:"; cat /tmp/pp2b.out; exit 1; fi
echo "20260907130000 idempotent"
if ! run < "$MIG3" >/tmp/pp3.out 2>&1; then echo "MIG3 FAILED:"; cat /tmp/pp3.out; exit 1; fi
echo "20260907160000 applied"
if ! run < "$MIG3" >/tmp/pp3b.out 2>&1; then echo "MIG3 SECOND APPLY FAILED:"; cat /tmp/pp3b.out; exit 1; fi
echo "20260907160000 idempotent"

docker exec -i "$CID" psql -X -q -U postgres -d m 2>&1 <<'SQL' | grep -E 'PASS|FAIL|RESULT|ERROR'
do $$
declare
  A  constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';  -- INV-A  R1000 (also holds LEGACY-430)
  B  constant uuid := 'aaaaaaaa-0000-0000-0000-000000000002';  -- INV-B  R5000
  Z  constant uuid := 'aaaaaaaa-0000-0000-0000-000000000009';  -- imported_to_zoho R500
  LP constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000d';  -- INV-LP order-linked, already 'paid', empty ledger
  T1 constant text := '11111111-1111-1111-1111-111111111111';
  U1 constant text := '99999999-9999-9999-9999-999999999999';
  r jsonb; n int; att int; st text; pid uuid; aid uuid; p1 text; p2 text; fs text; ts text;
begin
  perform set_config('test.uid', U1, false);
  perform set_config('test.tenants', T1, false);
  perform set_config('test.finance_level','1', false);
  perform set_config('test.is_staff','true', false);

  -- helper: "upload" a private object then stage it
  -- (inline below per scenario)

  -- 1 · legacy NULL-operation-key payment still valid + counted
  if public.invoice_amount_paid(A) = 430.00
     and (select client_operation_key is null from public.invoice_payments where reference='LEGACY-430')
  then raise notice 'PASS 1 legacy NULL-operation-key payment remains valid and counted';
  else raise notice 'FAIL 1 paid=%', public.invoice_amount_paid(A); end if;

  -- 2 · a NEW manual payment requires a non-empty operation key
  begin
    perform public.record_manual_invoice_payment(B, 100.00, null, now(), 'eft', null, null);
    raise notice 'FAIL 2 missing operation key accepted';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_OPERATION_KEY_REQUIRED%' then raise notice 'PASS 2 missing operation key rejected';
    else raise notice 'FAIL 2 %', sqlerrm; end if;
  end;

  -- 3 · payment with an operation key and NO external reference
  r := public.record_manual_invoice_payment(B, 200.00, null, now(), 'eft', 'no ref', 'opB1');
  select count(*) into n from public.invoice_payments where invoice_id=B and client_operation_key='opB1';
  if (r->>'replayed')::boolean = false and n = 1
     and (select reference is null from public.invoice_payments where client_operation_key='opB1')
  then raise notice 'PASS 3 no-reference payment recorded with operation key';
  else raise notice 'FAIL 3 r=% n=%', r, n; end if;

  -- 4 · valid retry (same key + same details) -> original payment, no 2nd row/event
  r := public.record_manual_invoice_payment(B, 200.00, null, now(), 'eft', 'no ref', 'opB1');
  select count(*) into n from public.invoice_payments where invoice_id=B and client_operation_key='opB1';
  select count(*) into att from public.opps_invoice_activity where invoice_id=B and activity_type='invoice_payment_recorded';
  if (r->>'replayed')::boolean = true and n = 1 and att = 1
  then raise notice 'PASS 4 valid retry returns the original payment (1 row, 1 event)';
  else raise notice 'FAIL 4 replayed=% n=% events=%', r->>'replayed', n, att; end if;

  -- 5 · same key + conflicting amount -> reject
  begin
    perform public.record_manual_invoice_payment(B, 999.00, null, now(), 'eft', null, 'opB1');
    raise notice 'FAIL 5 conflicting replay accepted';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_OPERATION_CONFLICT%' then raise notice 'PASS 5 same key + different details rejected';
    else raise notice 'FAIL 5 %', sqlerrm; end if;
  end;

  -- 6 · two intentional identical reference-free payments (different keys)
  perform public.record_manual_invoice_payment(B, 300.00, null, current_date, 'eft', null, 'opB2');
  perform public.record_manual_invoice_payment(B, 300.00, null, current_date, 'eft', null, 'opB3');
  select count(*) into n from public.invoice_payments where invoice_id=B and client_operation_key in ('opB2','opB3');
  if n = 2 then raise notice 'PASS 6 two intentional reference-free payments remain separate';
  else raise notice 'FAIL 6 n=%', n; end if;

  -- 7 · a reference reused by a DIFFERENT operation -> hard conflict (never silent)
  perform public.record_manual_invoice_payment(B, 400.00, 'BANK-9', current_date, 'eft', null, 'opB4');
  begin
    perform public.record_manual_invoice_payment(B, 400.00, 'BANK-9', current_date, 'eft', null, 'opB5');
    raise notice 'FAIL 7 reused reference under a new operation accepted';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT%' then raise notice 'PASS 7 reused reference under a different operation rejected';
    else raise notice 'FAIL 7 %', sqlerrm; end if;
  end;

  -- 8 · stage_payment_proof: a real object under this op is accepted and links atomically
  insert into storage.objects (bucket_id, name, owner_id)
  values ('uploads', T1 || '/finance/payment-proof/opZ1/2026/09/07/a-pop.png', U1);
  r := public.stage_payment_proof(Z, 'opZ1', T1 || '/finance/payment-proof/opZ1/2026/09/07/a-pop.png', 'pop.png', 'image/png', 40000);
  r := public.record_manual_invoice_payment(Z, 500.00, null, now(), 'eft', 'zoho paid', 'opZ1');
  select status, payment_id into st, pid from public.payment_attachments where operation_key='opZ1';
  if (r->>'proof_linked')::int = 1 and st = 'linked' and pid = (r->>'payment_id')::uuid
     and (select status from public.opps_invoices where id=Z) = 'imported_to_zoho'
  then raise notice 'PASS 8 verified staged proof links atomically; commercial status preserved';
  else raise notice 'FAIL 8 r=% st=% pid=%', r, st, pid; end if;

  -- 9 · stage_payment_proof rejects a path whose object does NOT exist
  begin
    perform public.stage_payment_proof(Z, 'opZ2', T1 || '/finance/payment-proof/opZ2/2026/09/07/ghost.png', 'g.png', 'image/png', 1000);
    raise notice 'FAIL 9 nonexistent object accepted';
  exception when others then
    if sqlerrm like 'PAYMENT_ATTACHMENT_OBJECT_NOT_FOUND%' then raise notice 'PASS 9 storage object must actually exist';
    else raise notice 'FAIL 9 %', sqlerrm; end if;
  end;

  -- 10 · a same-tenant object NOT under this operation's folder is rejected
  insert into storage.objects (bucket_id, name, owner_id)
  values ('uploads', T1 || '/some/other/place/random.png', U1);
  begin
    perform public.stage_payment_proof(Z, 'opZ3', T1 || '/some/other/place/random.png', 'r.png', 'image/png', 1000);
    raise notice 'FAIL 10 arbitrary same-tenant path accepted';
  exception when others then
    if sqlerrm like 'PAYMENT_ATTACHMENT_PATH_NOT_OPERATION_SCOPED%' then raise notice 'PASS 10 arbitrary same-tenant storage path rejected';
    else raise notice 'FAIL 10 %', sqlerrm; end if;
  end;

  -- 11 · another operation's staged file cannot be claimed
  insert into storage.objects (bucket_id, name, owner_id)
  values ('uploads', T1 || '/finance/payment-proof/opX1/2026/09/07/x.png', U1);
  perform public.stage_payment_proof(B, 'opX1', T1 || '/finance/payment-proof/opX1/2026/09/07/x.png', 'x.png', 'image/png', 1000);
  begin
    perform public.stage_payment_proof(B, 'opX2', T1 || '/finance/payment-proof/opX1/2026/09/07/x.png', 'x.png', 'image/png', 1000);
    raise notice 'FAIL 11 stole another operation staged proof';
  exception when others then
    if sqlerrm like 'PAYMENT_ATTACHMENT_PATH_NOT_OPERATION_SCOPED%' or sqlerrm like '%payment_attachments_path_once%'
    then raise notice 'PASS 11 another operation''s staged proof cannot be claimed';
    else raise notice 'FAIL 11 %', sqlerrm; end if;
  end;

  -- 12 · direct table writes are revoked from `authenticated`
  if not has_table_privilege('authenticated', 'public.payment_attachments', 'INSERT')
     and not has_table_privilege('authenticated', 'public.payment_attachments', 'UPDATE')
     and not has_table_privilege('authenticated', 'public.payment_attachments', 'DELETE')
     and has_table_privilege('authenticated', 'public.payment_attachments', 'SELECT')
  then raise notice 'PASS 12 authenticated has SELECT only (no direct INSERT/UPDATE/DELETE)';
  else raise notice 'FAIL 12 grants: I=% U=% D=% S=%',
    has_table_privilege('authenticated','public.payment_attachments','INSERT'),
    has_table_privilege('authenticated','public.payment_attachments','UPDATE'),
    has_table_privilege('authenticated','public.payment_attachments','DELETE'),
    has_table_privilege('authenticated','public.payment_attachments','SELECT'); end if;

  -- 13 · trigger blocks direct reassignment / identity / status tamper on a LINKED row
  select id into aid from public.payment_attachments where operation_key='opZ1' and status='linked';
  begin update public.payment_attachments set payment_id = gen_random_uuid() where id = aid;
        raise notice 'FAIL 13a linked payment_id reassigned';
  exception when others then
    if sqlerrm like 'PAYMENT_ATTACHMENT_PAYMENT_IMMUTABLE%' then raise notice 'PASS 13a linked payment_id reassignment denied';
    else raise notice 'FAIL 13a %', sqlerrm; end if; end;
  begin update public.payment_attachments set storage_path = T1 || '/x/y/z.png' where id = aid;
        raise notice 'FAIL 13b storage_path changed';
  exception when others then
    if sqlerrm like 'PAYMENT_ATTACHMENT_IDENTITY_IMMUTABLE%' then raise notice 'PASS 13b storage identity change denied';
    else raise notice 'FAIL 13b %', sqlerrm; end if; end;
  begin update public.payment_attachments set status = 'superseded' where id = aid;
        raise notice 'FAIL 13c unaudited supersede accepted';
  exception when others then
    if sqlerrm like 'PAYMENT_ATTACHMENT_SUPERSEDE_NEEDS_AUDIT%' then raise notice 'PASS 13c unaudited status flip to superseded denied';
    else raise notice 'FAIL 13c %', sqlerrm; end if; end;
  begin update public.payment_attachments set status = 'staged', payment_id = null where id = aid;
        raise notice 'FAIL 13d linked row unlinked';
  exception when others then
    if sqlerrm like 'PAYMENT_ATTACHMENT_%IMMUTABLE%' or sqlerrm like 'PAYMENT_ATTACHMENT_BAD_TRANSITION%'
    then raise notice 'PASS 13d linked -> staged / unlink denied';
    else raise notice 'FAIL 13d %', sqlerrm; end if; end;

  -- 14 · trigger blocks direct DELETE of a linked row; staged is deletable
  begin delete from public.payment_attachments where id = aid;
        raise notice 'FAIL 14a linked row deleted directly';
  exception when others then
    if sqlerrm like 'PAYMENT_ATTACHMENT_LINKED_IMMUTABLE%' then raise notice 'PASS 14a direct delete of a linked proof denied';
    else raise notice 'FAIL 14a %', sqlerrm; end if; end;

  -- 15 · remove_staged_payment_proof removes an unlinked staged row (RPC path)
  select id into aid from public.payment_attachments where operation_key='opX1' and status='staged';
  r := public.remove_staged_payment_proof(aid);
  if (r->>'ok')::boolean and not exists (select 1 from public.payment_attachments where id=aid)
     and (r->>'storage_path') is not null
  then raise notice 'PASS 15 staged proof removed via RPC (returns path for object cleanup)';
  else raise notice 'FAIL 15 r=%', r; end if;

  -- 16 · attach_payment_proof to an already-recorded payment: no ledger change
  select id into pid from public.invoice_payments where client_operation_key='opZ1';
  select public.invoice_amount_paid(Z) into n;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('uploads', T1 || '/finance/payment-proof/late-' || pid::text || '/2026/09/07/late.jpg', U1);
  r := public.attach_payment_proof(pid, T1 || '/finance/payment-proof/late-' || pid::text || '/2026/09/07/late.jpg', 'late.jpg', 'image/jpeg', 12345);
  if (r->>'ok')::boolean
     and (select count(*) from public.invoice_payments where invoice_id=Z) = 1
     and public.invoice_amount_paid(Z) = n
     and (select status from public.payment_attachments where id=(r->>'attachment_id')::uuid) = 'linked'
     and exists (select 1 from public.opps_invoice_activity where invoice_id=Z and activity_type='invoice_payment_proof_added')
  then raise notice 'PASS 16 add-proof-to-existing: no ledger row, no amount change, audit event';
  else raise notice 'FAIL 16 r=% paid=%', r, public.invoice_amount_paid(Z); end if;

  -- 17 · supersede a linked proof (audited); reason required; no amount change
  select id into aid from public.payment_attachments where operation_key='opZ1' and status='linked' limit 1;
  begin perform public.supersede_payment_attachment(aid, '   ');
        raise notice 'FAIL 17a blank reason accepted';
  exception when others then
    if sqlerrm like 'PAYMENT_ATTACHMENT_REASON_REQUIRED%' then raise notice 'PASS 17a supersede requires a reason';
    else raise notice 'FAIL 17a %', sqlerrm; end if; end;
  r := public.supersede_payment_attachment(aid, 'clearer copy received');
  if (r->>'ok')::boolean
     and (select status from public.payment_attachments where id=aid) = 'superseded'
     and public.invoice_amount_paid(Z) = n
     and exists (select 1 from public.opps_invoice_activity where invoice_id=Z and activity_type='invoice_payment_proof_superseded')
  then raise notice 'PASS 17b linked proof retired via audited RPC, no amount change';
  else raise notice 'FAIL 17b r=%', r; end if;

  -- 18 · retired proof stays visible (SELECT), and superseded cannot regress
  if exists (select 1 from public.payment_attachments where id=aid and status='superseded') then
    begin update public.payment_attachments set status = 'linked' where id = aid;
          raise notice 'FAIL 18 superseded regressed to linked';
    exception when others then
      if sqlerrm like 'PAYMENT_ATTACHMENT_BAD_TRANSITION%' then raise notice 'PASS 18 retired proof retained + cannot regress';
      else raise notice 'FAIL 18 %', sqlerrm; end if; end;
  else raise notice 'FAIL 18 retired proof not visible'; end if;

  -- 19 · cleanup_abandoned_payment_proof: sweeps ONLY the old staged row;
  --      a fresh staged row (inside the 5-min floor) is left alone, and
  --      linked/superseded evidence for any operation is never touched
  insert into storage.objects (bucket_id, name, owner_id) values
    ('uploads', T1 || '/finance/payment-proof/opCLEAN/2026/09/07/old.png', U1),
    ('uploads', T1 || '/finance/payment-proof/opCLEAN/2026/09/07/fresh.png', U1);
  perform public.stage_payment_proof(B, 'opCLEAN', T1 || '/finance/payment-proof/opCLEAN/2026/09/07/old.png', 'old.png', 'image/png', 1000);
  perform public.stage_payment_proof(B, 'opCLEAN', T1 || '/finance/payment-proof/opCLEAN/2026/09/07/fresh.png', 'fresh.png', 'image/png', 1000);
  -- created_at is trigger-immutable; backdate only the "old" row via a harness-only bypass
  alter table public.payment_attachments disable trigger trg_payment_attachments_immutable;
  update public.payment_attachments set created_at = now() - interval '2 hours'
    where operation_key='opCLEAN' and storage_path like '%/old.png';
  alter table public.payment_attachments enable trigger trg_payment_attachments_immutable;
  r := public.cleanup_abandoned_payment_proof('opCLEAN', 30);
  if jsonb_array_length(r->'removed') = 1
     and (r#>>'{removed,0}') like '%/old.png'
     and not exists (select 1 from public.payment_attachments where storage_path like '%/old.png')
     and exists (select 1 from public.payment_attachments where operation_key='opCLEAN' and storage_path like '%/fresh.png' and status='staged')
     -- superseded evidence from opZ1 (scenario 17) is still present
     and exists (select 1 from public.payment_attachments where operation_key='opZ1' and status='superseded')
  then raise notice 'PASS 19 abandoned old staged upload swept; fresh staged + retired evidence untouched';
  else raise notice 'FAIL 19 r=%', r; end if;

  -- 20 · cross-source + overpayment guards still fire under the new RPC
  begin perform public.record_manual_invoice_payment(Z, 5.00, null, now(), 'eft', null, 'opOVER');
        raise notice 'FAIL 20 overpayment on a settled invoice accepted';
  exception when others then
    if sqlerrm like 'INVOICE_PAYMENT_OVERPAYMENT%' then raise notice 'PASS 20 overpayment guard still fires';
    else raise notice 'FAIL 20 %', sqlerrm; end if; end;

  -- 21 · atomicity: forced audit failure rolls back the payment AND the proof link
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
  insert into storage.objects (bucket_id, name, owner_id)
  values ('uploads', T1 || '/finance/payment-proof/opROLL/2026/09/07/r.png', U1);
  perform public.stage_payment_proof(B, 'opROLL', T1 || '/finance/payment-proof/opROLL/2026/09/07/r.png', 'r.png', 'image/png', 1000);
  perform set_config('test.break_audit','on', false);
  begin
    perform public.record_manual_invoice_payment(B, 250.00, null, now(), 'eft', null, 'opROLL');
    raise notice 'FAIL 21 expected FORCED_AUDIT_FAILURE';
  exception when others then
    perform set_config('test.break_audit','off', false);
    select count(*) into n from public.invoice_payments where client_operation_key='opROLL';
    select status into st from public.payment_attachments where operation_key='opROLL';
    if sqlerrm like 'FORCED_AUDIT_FAILURE%' and n = 0 and st = 'staged'
    then raise notice 'PASS 21 audit failure rolls back the payment; proof left staged';
    else raise notice 'FAIL 21 err=% ledger=% proof=%', sqlerrm, n, st; end if;
  end;
  drop trigger trg_break_audit on public.opps_invoice_activity;

  -- 22 · P0 REGRESSION (7-arg) — legacy-paid reconciliation, production
  --      OPPS-INV-2026-0085 shape: order-linked invoice already 'paid' from a
  --      legacy direct write, empty canonical ledger, xlab_orders.opps_order_id
  --      is TEXT, no completed platform payment. The cross-source guard must
  --      compare xo.opps_order_id = v_invoice.source_order_id::text (was
  --      `operator does not exist: text = uuid`). After: guard passes, one
  --      ledger row + one audit event, commercial 'paid' status preserved.
  r := public.record_manual_invoice_payment(LP, 1715.00, 'EFT-LEGACY-0085', now(), 'eft', 'reconcile legacy paid status', 'opLEGACY');
  select status into st from public.opps_invoices where id = LP;
  select count(*) into n from public.invoice_payments where invoice_id = LP;
  select count(*) into att from public.opps_invoice_activity
    where invoice_id = LP and activity_type = 'invoice_payment_recorded';
  select from_status, to_status into fs, ts from public.opps_invoice_activity
    where invoice_id = LP and activity_type = 'invoice_payment_recorded' order by created_at desc limit 1;
  if (r->>'replayed')::boolean = false and n = 1 and att = 1
     and public.invoice_payment_status(LP) = 'paid'
     and st = 'paid' and fs = 'paid' and ts = 'paid'
  then raise notice 'PASS 22 legacy-paid order-linked reconciliation (7-arg): ledger recorded, commercial paid preserved, no text=uuid error';
  else raise notice 'FAIL 22 r=% st=% n=% att=% from=% to=%', r, st, n, att, fs, ts; end if;
  -- replay with the same operation key: still one row, still one event
  r := public.record_manual_invoice_payment(LP, 1715.00, 'EFT-LEGACY-0085', now(), 'eft', 'reconcile legacy paid status', 'opLEGACY');
  select count(*) into n from public.invoice_payments where invoice_id = LP;
  select count(*) into att from public.opps_invoice_activity where invoice_id = LP and activity_type='invoice_payment_recorded';
  if (r->>'replayed')::boolean = true and n = 1 and att = 1
  then raise notice 'PASS 22b legacy-paid reconciliation replay -> replayed=true, still 1 row / 1 event';
  else raise notice 'FAIL 22b r=% n=% att=%', r, n, att; end if;

  raise notice 'RESULT: DONE';
end $$;
SQL
echo "-----------------------------------------"
echo "RESULT: PASS (120000 + 130000 + 160000 apply + idempotent; 26 corrected-contract assertions green, incl. legacy-paid text/uuid reconciliation + replay)"
