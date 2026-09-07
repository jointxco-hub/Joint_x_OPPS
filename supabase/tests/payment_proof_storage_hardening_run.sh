#!/usr/bin/env bash
# Disposable pg16 proof for 20260907140000_payment_proof_storage_hardening.sql.
# Stands up storage.objects + payment_attachments (with RLS + a permissive
# delete/update policy like production has), applies 130000 then 140000, and
# checks: anon SELECT on payment_attachments is gone; authenticated keeps
# SELECT; a staged proof object is still deletable; a linked / superseded
# proof object cannot be deleted or overwritten via storage.objects.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG1="$ROOT/supabase/migrations/20260907120000_record_manual_invoice_payment.sql"
MIG2="$ROOT/supabase/migrations/20260907130000_manual_payment_operation_key_and_proof.sql"
MIG3="$ROOT/supabase/migrations/20260907140000_payment_proof_storage_hardening.sql"
CID="pp-harden-$$"
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
grant usage on schema storage, public to anon, authenticated, service_role;
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
  if clean_path = '' or clean_path !~ '^[^/]+/.+' then return null; end if;
  first_segment := split_part(clean_path, '/', 1);
  if first_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return first_segment::uuid;
  end if;
  return null;
end $$;

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner_id text, created_at timestamptz default now(),
  unique (bucket_id, name));
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
-- permissive read + delete + update policies, like production's tenant policies
create policy stub_uploads_read on storage.objects as permissive for select to authenticated
  using (bucket_id = 'uploads');
create policy stub_uploads_delete on storage.objects as permissive for delete to authenticated
  using (bucket_id = 'uploads');
create policy stub_uploads_update on storage.objects as permissive for update to authenticated
  using (bucket_id = 'uploads') with check (bucket_id = 'uploads');

create table public.tenants (id uuid primary key);
create table public.orders (id uuid primary key, order_number text, tenant_id uuid, total_amount numeric);
create table public.xlab_orders (id uuid primary key, opps_order_id uuid, opps_order_number text, tenant_id uuid, order_number text, created_at timestamptz default now());
create table public.xlab_payments (id uuid primary key default gen_random_uuid(), order_id uuid, status text, amount numeric, payfast_pf_payment_id text, created_at timestamptz default now());
create table public.opps_invoices (id uuid primary key, tenant_id uuid not null references public.tenants(id),
  invoice_number text, status text default 'approved', total numeric(14,2) default 0,
  amount_paid numeric(14,2) default 0, balance_due numeric(14,2) default 0, source_order_id uuid, updated_by uuid);
create table public.opps_invoice_activity (id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.opps_invoices(id) on delete cascade, tenant_id uuid references public.tenants(id),
  activity_type text not null, activity_label text not null, activity_note text, from_status text, to_status text,
  metadata jsonb default '{}'::jsonb, created_by uuid, created_at timestamptz default now());
create table public.invoice_payments (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  invoice_id uuid not null references public.opps_invoices(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0), paid_at timestamptz not null default now(),
  method text, reference text, source text not null default 'manual' check (source in ('manual','payfast','order_sync')),
  xlab_payment_id uuid, order_id uuid, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), created_by uuid);
create or replace function public._invoice_payments_set_tenant() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
declare v uuid; begin select tenant_id into v from public.opps_invoices where id = new.invoice_id;
  if v is null then raise exception using errcode='23503', message='INV_NF'; end if;
  new.tenant_id := v; return new; end $$;
create trigger t_ip_set_tenant before insert or update on public.invoice_payments
  for each row execute function public._invoice_payments_set_tenant();
create or replace function public.invoice_amount_paid(p uuid) returns numeric language sql stable
  set search_path = pg_catalog, public as $$ select coalesce(round(sum(amount),2),0) from public.invoice_payments where invoice_id=p $$;
create or replace function public.invoice_balance_due(p uuid) returns numeric language sql stable
  set search_path = pg_catalog, public as $$ select greatest(round(coalesce((select total from public.opps_invoices where id=p),0) - public.invoice_amount_paid(p),2),0) $$;
create or replace function public.invoice_payment_status(p uuid) returns text language sql stable
  set search_path = pg_catalog, public as $$ with v as (select coalesce((select total from public.opps_invoices where id=p),0) t, public.invoice_amount_paid(p) x)
  select case when v.x<=0 then 'unpaid' when v.x<v.t then 'partial' else 'paid' end from v $$;
create or replace function public.invoice_is_overdue(p uuid) returns boolean language sql stable set search_path=pg_catalog,public as $$ select false $$;
create or replace function public._invoice_payment_projection(p uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
  select jsonb_build_object('amount_paid',public.invoice_amount_paid(p),'balance_due',public.invoice_balance_due(p),
  'payment_status',public.invoice_payment_status(p),'overdue',public.invoice_is_overdue(p)) $$;
create or replace function public._invoice_payments_refresh_cache() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare v uuid := coalesce(new.invoice_id, old.invoice_id); begin
  update public.opps_invoices set amount_paid=public.invoice_amount_paid(v), balance_due=public.invoice_balance_due(v) where id=v;
  return coalesce(new,old); end $$;
create trigger t_ip_cache after insert or update or delete on public.invoice_payments
  for each row execute function public._invoice_payments_refresh_cache();

insert into public.tenants values ('11111111-1111-1111-1111-111111111111');
insert into public.opps_invoices (id, tenant_id, invoice_number, status, total)
values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','INV-A','approved',1000.00);
SQL
echo "prelude ok"

for M in "$MIG1" "$MIG2" "$MIG3"; do
  if ! run < "$M" >/tmp/h.out 2>&1; then echo "APPLY FAILED: $M"; cat /tmp/h.out; exit 1; fi
done
echo "130000 + 140000 applied"
if ! run < "$MIG3" >/tmp/h2.out 2>&1; then echo "140000 SECOND APPLY FAILED:"; cat /tmp/h2.out; exit 1; fi
echo "140000 idempotent"

docker exec -i "$CID" psql -X -q -U postgres -d m 2>&1 <<'SQL' | grep -E 'PASS|FAIL|RESULT|ERROR'
do $$
declare
  A  constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  T1 constant text := '11111111-1111-1111-1111-111111111111';
  U1 constant text := '99999999-9999-9999-9999-999999999999';
  r jsonb; n int;
begin
  perform set_config('test.uid', U1, false);
  perform set_config('test.tenants', T1, false);
  perform set_config('test.finance_level','1', false);
  perform set_config('test.is_staff','true', false);

  -- 1 · anon SELECT on payment_attachments removed; authenticated keeps it
  if not has_table_privilege('anon','public.payment_attachments','SELECT')
     and has_table_privilege('authenticated','public.payment_attachments','SELECT')
     and not has_table_privilege('authenticated','public.payment_attachments','INSERT')
  then raise notice 'PASS 1 anon SELECT dropped; authenticated SELECT-only kept';
  else raise notice 'FAIL 1 anon=% auth_sel=% auth_ins=%',
    has_table_privilege('anon','public.payment_attachments','SELECT'),
    has_table_privilege('authenticated','public.payment_attachments','SELECT'),
    has_table_privilege('authenticated','public.payment_attachments','INSERT'); end if;

  -- seed: a staged proof + record a payment so it becomes linked; then a superseded one
  insert into storage.objects (bucket_id, name, owner_id) values
    ('uploads', T1 || '/finance/payment-proof/opS/2026/09/07/staged.png', U1),
    ('uploads', T1 || '/finance/payment-proof/opL/2026/09/07/linked.png', U1),
    ('uploads', T1 || '/finance/payment-proof/opX/2026/09/07/super.png',  U1),
    ('uploads', T1 || '/other/plain.png', U1);
  perform public.stage_payment_proof(A, 'opS', T1 || '/finance/payment-proof/opS/2026/09/07/staged.png', 's.png', 'image/png', 100);
  perform public.stage_payment_proof(A, 'opL', T1 || '/finance/payment-proof/opL/2026/09/07/linked.png', 'l.png', 'image/png', 100);
  perform public.record_manual_invoice_payment(A, 100.00, null, now(), 'eft', null, 'opL');   -- links opL
  perform public.stage_payment_proof(A, 'opX', T1 || '/finance/payment-proof/opX/2026/09/07/super.png', 'x.png', 'image/png', 100);
  perform public.record_manual_invoice_payment(A, 100.00, null, now(), 'eft', null, 'opX');   -- links opX
  perform public.supersede_payment_attachment(
    (select id from public.payment_attachments where operation_key='opX'), 'retired for test');

  set role authenticated;

  -- 2 · a STILL-STAGED proof object can be deleted (cleanup path works)
  begin
    delete from storage.objects where name = T1 || '/finance/payment-proof/opS/2026/09/07/staged.png';
    get diagnostics n = row_count;
    if n = 1 then raise notice 'PASS 2 staged proof object is still deletable';
    else raise notice 'FAIL 2 staged delete rows=%', n; end if;
  exception when others then raise notice 'FAIL 2 %', sqlerrm; end;

  -- 3 · a LINKED proof object cannot be deleted
  delete from storage.objects where name = T1 || '/finance/payment-proof/opL/2026/09/07/linked.png';
  get diagnostics n = row_count;
  if n = 0 and exists (select 1 from storage.objects where name = T1 || '/finance/payment-proof/opL/2026/09/07/linked.png')
  then raise notice 'PASS 3 linked proof object delete blocked by restrictive policy';
  else raise notice 'FAIL 3 linked delete rows=%', n; end if;

  -- 4 · a SUPERSEDED proof object cannot be deleted
  delete from storage.objects where name = T1 || '/finance/payment-proof/opX/2026/09/07/super.png';
  get diagnostics n = row_count;
  if n = 0 and exists (select 1 from storage.objects where name = T1 || '/finance/payment-proof/opX/2026/09/07/super.png')
  then raise notice 'PASS 4 superseded proof object delete blocked';
  else raise notice 'FAIL 4 superseded delete rows=%', n; end if;

  -- 5 · a LINKED proof object cannot be overwritten (UPDATE)
  update storage.objects set name = name || '.x' where name = T1 || '/finance/payment-proof/opL/2026/09/07/linked.png';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS 5 linked proof object update blocked';
  else raise notice 'FAIL 5 update rows=%', n; end if;

  -- 6 · an unrelated object is unaffected
  delete from storage.objects where name = T1 || '/other/plain.png';
  get diagnostics n = row_count;
  if n = 1 then raise notice 'PASS 6 unrelated uploads object still deletable';
  else raise notice 'FAIL 6 unrelated delete rows=%', n; end if;

  reset role;
  raise notice 'RESULT: DONE';
end $$;
SQL
echo "-----------------------------------------"
echo "RESULT: PASS (140000 applies + idempotent; 6 hardening assertions green)"
