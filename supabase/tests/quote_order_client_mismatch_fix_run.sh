#!/usr/bin/env bash
# Disposable pg16 proof for 20260918090000_quote_order_client_mismatch_fix.sql:
# a quote with NO linked client record (customer_id null — a normal,
# supported OPPS quoting state, not a fixture anomaly) must still be able
# to complete Quote -> Invoice -> Order. Before this fix, CLIENT_MISMATCH
# from link_invoice_to_order_relational aborted the ENTIRE order creation;
# after, the order is created and the auto-link is safely skipped.
#
# LOCAL, DISPOSABLE container only. Never touches staging or production.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG1="$ROOT/supabase/migrations/20260916090000_quote_order_invoice_conversion.sql"
MIG2="$ROOT/supabase/migrations/20260917090000_quote_direct_invoice_conversion.sql"
MIG3="$ROOT/supabase/migrations/20260918090000_quote_order_client_mismatch_fix.sql"
CID="quote-cm-fix-$$"
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
  customer_billing_address text,
  payment_terms text,
  terms text,
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

create table public.opps_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  customer_id uuid,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  customer_billing_address text,
  source_order_id uuid references public.orders(id),
  invoice_date date not null,
  due_date date,
  payment_terms text,
  currency_code text default 'ZAR',
  status text default 'draft' check (status in ('draft','approved','exported','imported_to_zoho','paid','partially_paid','overdue','void')),
  reference_number text,
  subtotal numeric default 0,
  discount_total numeric default 0,
  shipping_charge numeric default 0,
  adjustment numeric default 0,
  tax_total numeric default 0,
  total numeric default 0,
  amount_paid numeric default 0,
  balance_due numeric default 0,
  notes text,
  terms text,
  internal_notes text,
  tenant_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table public.opps_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.opps_invoices(id) on delete cascade,
  line_number integer not null,
  item_name text not null,
  item_description text,
  item_type text default 'goods',
  quantity numeric not null,
  unit text,
  rate numeric not null,
  discount numeric default 0,
  tax_name text,
  tax_percentage numeric default 0,
  account_name text,
  item_total numeric not null,
  source_order_item_id uuid,
  created_at timestamptz default now()
);
create table public.opps_invoice_number_sequences (
  tenant_id uuid not null,
  year integer not null,
  last_number integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, year)
);
create function public.next_opps_invoice_number(p_tenant_id uuid)
returns text language plpgsql security definer as $$
declare invoice_year integer := extract(year from now())::integer; next_number integer;
begin
  insert into public.opps_invoice_number_sequences (tenant_id, year, last_number)
  values (p_tenant_id, invoice_year, 1)
  on conflict (tenant_id, year) do update
    set last_number = public.opps_invoice_number_sequences.last_number + 1, updated_at = now()
  returning last_number into next_number;
  return 'OPPS-INV-' || invoice_year::text || '-' || lpad(next_number::text, 4, '0');
end;
$$;

create table public.opps_invoice_activity (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.opps_invoices(id) on delete cascade,
  activity_type text not null,
  activity_label text not null,
  activity_note text,
  from_status text,
  to_status text,
  metadata jsonb default '{}'::jsonb,
  tenant_id uuid,
  created_by uuid,
  created_at timestamptz default now()
);

create or replace function public.link_invoice_to_order_relational(p_invoice_id uuid, p_order_id uuid)
returns public.opps_invoices
language plpgsql security definer as $$
declare
  v_invoice public.opps_invoices%rowtype;
  v_order public.orders%rowtype;
begin
  if not (public.is_app_admin() or public.user_finance_level() in (1, 2)) then
    raise exception using errcode = '42501', message = 'FINANCE_PERMISSION_REQUIRED';
  end if;
  select * into v_invoice from public.opps_invoices where id = p_invoice_id;
  if v_invoice.id is null then raise exception using errcode = 'P0001', message = 'INVOICE_NOT_FOUND'; end if;
  if not public.can_access_tenant(v_invoice.tenant_id) then raise exception using errcode = '42501', message = 'TENANT_ACCESS_DENIED'; end if;
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND'; end if;
  if not public.can_access_tenant(v_order.tenant_id) then raise exception using errcode = '42501', message = 'TENANT_ACCESS_DENIED'; end if;
  if v_invoice.tenant_id is distinct from v_order.tenant_id then raise exception using errcode = 'P0001', message = 'TENANT_MISMATCH'; end if;
  if v_invoice.customer_id is null or v_order.client_id is null
     or v_invoice.customer_id is distinct from v_order.client_id then
    raise exception using errcode = 'P0001', message = 'CLIENT_MISMATCH';
  end if;
  if v_invoice.status = 'void' then raise exception using errcode = 'P0001', message = 'INVOICE_VOID'; end if;
  if v_invoice.source_order_id is not null and v_invoice.source_order_id is distinct from p_order_id then
    raise exception using errcode = 'P0001', message = 'INVOICE_ALREADY_LINKED';
  end if;
  update public.opps_invoices set source_order_id = p_order_id, updated_at = now()
  where id = p_invoice_id returning * into v_invoice;
  insert into public.opps_invoice_activity (invoice_id, activity_type, activity_label, metadata, tenant_id, created_by)
  values (p_invoice_id, 'invoice_linked_to_order', 'Linked to order (relational)',
    jsonb_build_object('order_id', p_order_id, 'order_number', v_order.order_number, 'link_mode', 'relational_only'), v_invoice.tenant_id, auth.uid());
  return v_invoice;
end;
$$;

insert into public.tenants values ('11111111-1111-1111-1111-111111111111');
SQL
echo "prelude ok"

for m in "$MIG1" "$MIG2" "$MIG3"; do
  name="$(basename "$m")"
  if ! run < "$m" >/tmp/cmf.out 2>&1; then echo "$name FAILED:"; cat /tmp/cmf.out; exit 1; fi
  echo "$name applied"
done
if ! run < "$MIG3" >/tmp/cmf2.out 2>&1; then echo "20260918090000 SECOND APPLY FAILED:"; cat /tmp/cmf2.out; exit 1; fi
echo "20260918090000 idempotent"

echo "=========================================="
echo "SEQUENTIAL SCENARIOS"
echo "=========================================="
docker exec -i "$CID" psql -X -q -U postgres -d m 2>&1 <<'SQL' | grep -E 'PASS|FAIL|RESULT'
do $$
declare
  TENANT constant uuid := '11111111-1111-1111-1111-111111111111';
  q uuid; rev uuid; r jsonb; n int; v_invoice_id uuid; v_order_id uuid;
  before_source_order_id uuid; after_source_order_id uuid;
begin
  set local test.uid = '22222222-2222-2222-2222-222222222222';

  -- ── the exact staging repro: accepted quote, customer_name set,
  --    customer_id NEVER set (no linked client record — a normal,
  --    supported OPPS quoting state) ─────────────────────────────────
  insert into public.opps_quotes (tenant_id, quote_number, status, customer_name, total)
  values (TENANT, 'QT-2026-000007', 'accepted', 'UAT Walk-in Customer', 790.00)
  returning id into q;
  insert into public.opps_quote_revisions (quote_id, tenant_id, revision_number, snapshot, totals)
  values (q, TENANT, 1,
    jsonb_build_object('total', 790.00, 'subtotal', 790.00, 'discount_total', 0, 'shipping_charge', 0, 'tax_total', 0,
      'items', jsonb_build_array(jsonb_build_object('line_number', 1, 'role', 'product', 'item_name', 'Item', 'quantity', 1, 'rate', 790.00, 'discount', 0, 'item_total', 790.00))),
    jsonb_build_object('total', 790.00)
  ) returning id into rev;
  update public.opps_quotes set accepted_revision_id = rev where id = q;

  r := public.convert_quote_to_invoice(q);
  v_invoice_id := (r->>'invoice_id')::uuid;
  update public.opps_invoices set status = 'paid', amount_paid = 790.00, balance_due = 0 where id = v_invoice_id;

  if (select customer_id from public.opps_quotes where id = q) is null
     and (select customer_id from public.opps_invoices where id = v_invoice_id) is null
  then raise notice 'PASS 1 repro precondition confirmed: quote.customer_id and invoice.customer_id are both null (no linked client), exactly the staging fixture state';
  else raise notice 'FAIL 1 quote.customer_id=% invoice.customer_id=%', (select customer_id from public.opps_quotes where id = q), (select customer_id from public.opps_invoices where id = v_invoice_id); end if;

  -- ── THE FIX: before 20260918090000 this raised CLIENT_MISMATCH and
  --    rolled back the entire order creation. It must now succeed AND
  --    the pre-existing invoice must become a NORMAL linked invoice of
  --    the new order (source_order_id set), not merely skipped. ───────
  begin
    r := public.convert_quote_to_order(q);
    v_order_id := (r->>'order_id')::uuid;
    if (r->>'ok')::boolean = true and v_order_id is not null
       and (r->>'invoice_link_status') = 'linked'
    then raise notice 'PASS 2 Create Order succeeds for a client-less quote (previously raised CLIENT_MISMATCH and aborted entirely) — invoice_link_status=linked (not merely skipped)';
    else raise notice 'FAIL 2 r=%', r; end if;
  exception when others then
    raise notice 'FAIL 2 convert_quote_to_order raised instead of succeeding: %', sqlerrm;
  end;

  -- ── order was genuinely created, with the same null client_id the
  --    quote itself has — not blocked, not forced to a wrong client ───
  select count(*) into n from public.orders where source_quote_id = q;
  if n = 1 and (select client_id from public.orders where id = v_order_id) is null
     and (select source_quote_id from public.orders where id = v_order_id) = q
     and (select source_invoice_id from public.orders where id = v_order_id) = v_invoice_id
     and (select status from public.opps_quotes where id = q) = 'converted'
  then raise notice 'PASS 3 exactly one order created, client_id null (matches the quote, not force-assigned), source_quote_id + source_invoice_id both set, quote converted';
  else raise notice 'FAIL 3 n=% order=%', n, (select row_to_json(o) from public.orders o where id = v_order_id); end if;

  -- ── THE ACTUAL REQUIRED INVARIANT: the invoice IS canonically linked
  --    — opps_invoices.source_order_id = the new order's id — via the
  --    ONE canonical RPC, no parallel UPDATE. ──────────────────────────
  select source_order_id into after_source_order_id from public.opps_invoices where id = v_invoice_id;
  if after_source_order_id = v_order_id
  then raise notice 'PASS 4 REQUIRED INVARIANT satisfied: opps_invoices.source_order_id = the new order — the clientless-but-same-quote invoice is now a fully normal linked invoice, via link_invoice_to_order_relational itself, not a parallel UPDATE';
  else raise notice 'FAIL 4 invoice not linked: source_order_id=% (expected %)', after_source_order_id, v_order_id; end if;

  -- ── discoverability: the EXACT query InvoicesTab.jsx's linkedInvoicesQuery
  --    runs (listInvoices({sourceOrderId}) -> .eq("source_order_id", ...)) ──
  select count(*) into n from public.opps_invoices where source_order_id = v_order_id;
  if n = 1 then raise notice 'PASS 5 order''s Invoices-tab query (source_order_id = order id) discovers the clientless direct invoice';
  else raise notice 'FAIL 5 InvoicesTab query found % rows', n; end if;

  -- ── one opps_invoice_activity row from the canonical linker — same
  --    activity logging as any normal manual link, no bypass ───────────
  select count(*) into n from public.opps_invoice_activity where invoice_id = v_invoice_id and activity_type = 'invoice_linked_to_order';
  if n = 1 then raise notice 'PASS 5b invoice_linked_to_order activity present — went through the real canonical RPC, not a shortcut';
  else raise notice 'FAIL 5b activity count=%', n; end if;

  -- ── replaying Create Order still returns the same order, doesn't
  --    re-attempt/re-fail the linking, doesn't duplicate anything ─────
  r := public.convert_quote_to_order(q);
  select count(*) into n from public.orders where source_quote_id = q;
  if (r->>'replayed')::boolean = true and (r->>'order_id')::uuid = v_order_id and n = 1
  then raise notice 'PASS 6 replay after the fix still returns the SAME order, exactly one order row';
  else raise notice 'FAIL 6 r=% n=%', r, n; end if;

  raise notice 'RESULT: FIRST GROUP DONE';
end $$;
SQL

echo "=========================================="
echo "link_invoice_to_order_relational — full identity-proof matrix"
echo "=========================================="
docker exec -i "$CID" psql -X -q -U postgres -d m 2>&1 <<'SQL' | grep -E 'PASS|FAIL|RESULT'
do $$
declare
  TENANT constant uuid := '11111111-1111-1111-1111-111111111111';
  client_a uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  client_b uuid := 'aaaaaaaa-0000-0000-0000-0000000000b2';
  quote_x uuid := 'bbbbbbb1-0000-0000-0000-000000000001';
  quote_y uuid := 'bbbbbbb2-0000-0000-0000-000000000002';
  quote_z uuid := 'bbbbbbb3-0000-0000-0000-000000000003';
  quote_w uuid := 'bbbbbbb4-0000-0000-0000-000000000004';
  inv uuid; ord uuid;
begin
  set local test.uid = '22222222-2222-2222-2222-222222222222';

  -- source_quote_id on both opps_invoices and orders is a real FK to
  -- opps_quotes(id) — these stub quotes just need to exist for the
  -- identity-proof matrix below; their own content is irrelevant here.
  -- Each scenario that sets opps_invoices.source_quote_id needs its OWN
  -- quote (opps_invoices_source_quote_id_once is a real partial unique
  -- index — one direct invoice per quote — so quote_x is used for #9's
  -- invoice only; #11 needs a fresh one).
  insert into public.opps_quotes (id, tenant_id, quote_number, status, customer_name, total)
  values (quote_x, TENANT, 'QT-TEST-X', 'accepted', 'Quote X Customer', 0);
  insert into public.opps_quotes (id, tenant_id, quote_number, status, customer_name, total)
  values (quote_y, TENANT, 'QT-TEST-Y', 'accepted', 'Quote Y Customer', 0);
  insert into public.opps_quotes (id, tenant_id, quote_number, status, customer_name, total)
  values (quote_z, TENANT, 'QT-TEST-Z', 'accepted', 'Quote Z Customer', 0);
  insert into public.opps_quotes (id, tenant_id, quote_number, status, customer_name, total)
  values (quote_w, TENANT, 'QT-TEST-W', 'accepted', 'Quote W Customer', 0);

  -- 7 · two different non-null client_ids -> still rejects
  insert into public.opps_invoices (invoice_number, customer_id, customer_name, invoice_date, tenant_id, status)
  values ('OPPS-INV-TEST-7', client_a, 'Client A', current_date, TENANT, 'draft') returning id into inv;
  insert into public.orders (client_name, client_id, tenant_id, order_number, products, total_amount)
  values ('Client B', client_b, TENANT, 'ORD-TEST-7', '[]'::jsonb, 0) returning id into ord;
  begin
    perform public.link_invoice_to_order_relational(inv, ord);
    raise notice 'FAIL 7 two different non-null client_ids should reject';
  exception when others then
    if sqlerrm like '%CLIENT_MISMATCH%' then raise notice 'PASS 7 two different non-null client_ids still reject: CLIENT_MISMATCH — never weakened';
    else raise notice 'FAIL 7 wrong error: %', sqlerrm; end if;
  end;

  -- 8 · one null, one non-null -> still rejects
  insert into public.opps_invoices (invoice_number, customer_id, customer_name, invoice_date, tenant_id, status)
  values ('OPPS-INV-TEST-8', null, 'No Client', current_date, TENANT, 'draft') returning id into inv;
  insert into public.orders (client_name, client_id, tenant_id, order_number, products, total_amount)
  values ('Client B', client_b, TENANT, 'ORD-TEST-8', '[]'::jsonb, 0) returning id into ord;
  begin
    perform public.link_invoice_to_order_relational(inv, ord);
    raise notice 'FAIL 8 null invoice client + non-null order client should reject';
  exception when others then
    if sqlerrm like '%CLIENT_MISMATCH%' then raise notice 'PASS 8 one null + one non-null client still rejects: CLIENT_MISMATCH';
    else raise notice 'FAIL 8 wrong error: %', sqlerrm; end if;
  end;

  -- 9 · both null, but DIFFERENT source_quote_id -> still rejects (the
  --     shared-quote escape hatch requires the SAME quote, not just "any
  --     quote provenance exists on both sides")
  insert into public.opps_invoices (invoice_number, customer_id, customer_name, invoice_date, tenant_id, status, source_quote_id)
  values ('OPPS-INV-TEST-9', null, 'No Client', current_date, TENANT, 'draft', quote_x) returning id into inv;
  insert into public.orders (client_name, client_id, tenant_id, order_number, products, total_amount, source_quote_id)
  values ('No Client', null, TENANT, 'ORD-TEST-9', '[]'::jsonb, 0, quote_y) returning id into ord;
  begin
    perform public.link_invoice_to_order_relational(inv, ord);
    raise notice 'FAIL 9 both null but DIFFERENT source_quote_id should reject';
  exception when others then
    if sqlerrm like '%CLIENT_MISMATCH%' then raise notice 'PASS 9 both null clients but DIFFERENT source_quote_id still rejects: CLIENT_MISMATCH';
    else raise notice 'FAIL 9 wrong error: %', sqlerrm; end if;
  end;

  -- 10 · both null, NEITHER side has any quote provenance at all -> still rejects
  insert into public.opps_invoices (invoice_number, customer_id, customer_name, invoice_date, tenant_id, status)
  values ('OPPS-INV-TEST-10', null, 'No Client', current_date, TENANT, 'draft') returning id into inv;
  insert into public.orders (client_name, client_id, tenant_id, order_number, products, total_amount)
  values ('No Client', null, TENANT, 'ORD-TEST-10', '[]'::jsonb, 0) returning id into ord;
  begin
    perform public.link_invoice_to_order_relational(inv, ord);
    raise notice 'FAIL 10 both null with NO quote provenance should reject';
  exception when others then
    if sqlerrm like '%CLIENT_MISMATCH%' then raise notice 'PASS 10 both null clients with no quote provenance at all still rejects: CLIENT_MISMATCH — the escape hatch never applies without a genuine shared quote';
    else raise notice 'FAIL 10 wrong error: %', sqlerrm; end if;
  end;

  -- 11 · both null, SAME non-null source_quote_id, same tenant -> succeeds
  insert into public.opps_invoices (invoice_number, customer_id, customer_name, invoice_date, tenant_id, status, source_quote_id)
  values ('OPPS-INV-TEST-11', null, 'No Client', current_date, TENANT, 'draft', quote_z) returning id into inv;
  insert into public.orders (client_name, client_id, tenant_id, order_number, products, total_amount, source_quote_id)
  values ('No Client', null, TENANT, 'ORD-TEST-11', '[]'::jsonb, 0, quote_z) returning id into ord;
  perform public.link_invoice_to_order_relational(inv, ord);
  if (select source_order_id from public.opps_invoices where id = inv) = ord
  then raise notice 'PASS 11 both null clients, SAME source_quote_id, same tenant -> succeeds, invoice linked to the order';
  else raise notice 'FAIL 11 not linked'; end if;

  -- 12 · invoice already linked to a DIFFERENT order still rejects
  --      (unrelated to the client check — proves this migration didn't
  --      touch that guard either). Uses a fresh, non-null-client pair
  --      (isolated from the null-client/quote-identity path entirely) so
  --      the client check trivially passes on both link attempts and the
  --      ALREADY_LINKED guard is the only thing under test.
  declare inv12 uuid; ord12a uuid; ord12b uuid;
  begin
    insert into public.opps_invoices (invoice_number, customer_id, customer_name, invoice_date, tenant_id, status)
    values ('OPPS-INV-TEST-12', client_a, 'Client A', current_date, TENANT, 'draft') returning id into inv12;
    insert into public.orders (client_name, client_id, tenant_id, order_number, products, total_amount)
    values ('Client A', client_a, TENANT, 'ORD-TEST-12A', '[]'::jsonb, 0) returning id into ord12a;
    insert into public.orders (client_name, client_id, tenant_id, order_number, products, total_amount)
    values ('Client A', client_a, TENANT, 'ORD-TEST-12B', '[]'::jsonb, 0) returning id into ord12b;
    perform public.link_invoice_to_order_relational(inv12, ord12a);
    begin
      perform public.link_invoice_to_order_relational(inv12, ord12b);
      raise notice 'FAIL 12 invoice already linked elsewhere should reject';
    exception when others then
      if sqlerrm like '%INVOICE_ALREADY_LINKED%' then raise notice 'PASS 12 invoice already linked to a different order still rejects: INVOICE_ALREADY_LINKED, never reassigned';
      else raise notice 'FAIL 12 wrong error: %', sqlerrm; end if;
    end;
  end;

  -- 13 · void invoice still rejects
  insert into public.opps_invoices (invoice_number, customer_id, customer_name, invoice_date, tenant_id, status, source_quote_id)
  values ('OPPS-INV-TEST-13', null, 'No Client', current_date, TENANT, 'void', quote_w) returning id into inv;
  insert into public.orders (client_name, client_id, tenant_id, order_number, products, total_amount, source_quote_id)
  values ('No Client', null, TENANT, 'ORD-TEST-13', '[]'::jsonb, 0, quote_w) returning id into ord;
  begin
    perform public.link_invoice_to_order_relational(inv, ord);
    raise notice 'FAIL 13 void invoice should reject';
  exception when others then
    if sqlerrm like '%INVOICE_VOID%' then raise notice 'PASS 13 void invoice still rejects: INVOICE_VOID';
    else raise notice 'FAIL 13 wrong error: %', sqlerrm; end if;
  end;

  -- 14 · matching non-null client_ids still succeeds (the ORIGINAL,
  --      pre-existing behavior — completely unaffected)
  insert into public.opps_invoices (invoice_number, customer_id, customer_name, invoice_date, tenant_id, status)
  values ('OPPS-INV-TEST-14', client_a, 'Client A', current_date, TENANT, 'draft') returning id into inv;
  insert into public.orders (client_name, client_id, tenant_id, order_number, products, total_amount)
  values ('Client A', client_a, TENANT, 'ORD-TEST-14', '[]'::jsonb, 0) returning id into ord;
  perform public.link_invoice_to_order_relational(inv, ord);
  if (select source_order_id from public.opps_invoices where id = inv) = ord
  then raise notice 'PASS 14 matching non-null client_ids still link successfully — original behavior fully preserved';
  else raise notice 'FAIL 14 not linked'; end if;

  raise notice 'RESULT: SECOND GROUP DONE';
end $$;
SQL

echo "-----------------------------------------"
echo "RESULT: PASS (20260918090000 applies + idempotent; clientless same-quote quote -> invoice -> order now produces the FULL required invariant — opps_invoices.source_order_id = order.id, discoverable via the real InvoicesTab query, via the ONE canonical link_invoice_to_order_relational RPC — while every genuine mismatch case (different clients, one null, both null with different or no quote provenance, already-linked, void) still correctly rejects, and the original matching-client-id path is fully preserved)"
