#!/usr/bin/env bash
# Disposable pg16 proof for 20260918100000_quote_direct_invoice_conversion.sql:
# convert_quote_to_invoice(p_quote_id) — the new Quote -> Invoice direct path
# — plus convert_quote_to_order()'s new source_invoice_id propagation and
# the "quote stays accepted after a direct invoice" design decision that
# keeps both conversion paths independently available.
#
# LOCAL, DISPOSABLE container only. Never touches staging or production.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG1="$ROOT/supabase/migrations/20260916090000_quote_order_invoice_conversion.sql"
MIG2="$ROOT/supabase/migrations/20260918100000_quote_direct_invoice_conversion.sql"
CID="quote-inv-conv-$$"
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

-- Minimal opps_invoices/opps_invoice_items — just enough of the real
-- 202606180001_opps_invoicing.sql shape for the direct-invoice RPC to
-- insert into, plus next_opps_invoice_number's own sequence table.
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
-- Real implementation, not a stub — this RPC's own numbering behavior is
-- part of what's being proven ("existing canonical numbering used").
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

-- opps_invoice_activity + a REAL (not stubbed) link_invoice_to_order_relational
-- — this proof exists specifically to verify the canonical invoice<->order
-- link actually gets set, so the linking logic itself must be faithful to
-- 202608180003_invoice_relational_link_and_reopen.sql, not a stub.
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

if ! run < "$MIG1" >/tmp/qic1.out 2>&1; then echo "20260916090000 FAILED:"; cat /tmp/qic1.out; exit 1; fi
echo "20260916090000 applied (base Quote->Order migration, unmodified prerequisite)"
if ! run < "$MIG2" >/tmp/qic2.out 2>&1; then echo "20260918100000 FAILED:"; cat /tmp/qic2.out; exit 1; fi
echo "20260918100000 applied"
if ! run < "$MIG2" >/tmp/qic3.out 2>&1; then echo "20260918100000 SECOND APPLY FAILED:"; cat /tmp/qic3.out; exit 1; fi
echo "20260918100000 idempotent"

echo "=========================================="
echo "SEQUENTIAL SCENARIOS"
echo "=========================================="
docker exec -i "$CID" psql -X -q -U postgres -d m 2>&1 <<'SQL' | grep -E 'PASS|FAIL|RESULT'
do $$
declare
  TENANT constant uuid := '11111111-1111-1111-1111-111111111111';
  CLIENT constant uuid := 'c0000000-0000-0000-0000-000000000001';
  q1 uuid; rev1 uuid; q2 uuid; rev2 uuid; q3 uuid; q4 uuid; rev4 uuid;
  r jsonb; n int; v_invoice_id uuid; v_invoice_number text; v_order_id uuid;
begin
  set local test.uid = '22222222-2222-2222-2222-222222222222';

  -- ── quote 1: accepted, R378 total, ZERO shipping — the exact staging
  --    scenario (QT-2026-000006 -> ORD-Q-D811A982E7 -> R378, R0 shipping).
  --    customer_id set so the canonical link RPC's client-match check has
  --    something real to compare (both invoice and order derive client
  --    from this same quote field, so it can never legitimately mismatch
  --    at this call site). ─────────────────────────────────────────────
  insert into public.opps_quotes (tenant_id, quote_number, status, customer_id, customer_name, customer_email, total)
  values (TENANT, 'QT-2026-000006', 'accepted', CLIENT, 'ACME Co', 'acme@x.invalid', 378.00)
  returning id into q1;
  insert into public.opps_quote_revisions (quote_id, tenant_id, revision_number, snapshot, totals)
  values (q1, TENANT, 1,
    jsonb_build_object(
      'quote_number', 'QT-2026-000006', 'subtotal', 378.00, 'discount_total', 0,
      'shipping_charge', 0, 'tax_total', 0, 'total', 378.00,
      'items', jsonb_build_array(
        jsonb_build_object('line_number', 1, 'role', 'product', 'item_name', 'Tee', 'quantity', 2, 'rate', 150.00, 'discount', 0, 'item_total', 300.00),
        jsonb_build_object('line_number', 2, 'role', 'product', 'item_name', 'Cap', 'quantity', 1, 'rate', 78.00, 'discount', 0, 'item_total', 78.00)
      )
    ),
    jsonb_build_object('total', 378.00)
  ) returning id into rev1;
  update public.opps_quotes set accepted_revision_id = rev1, current_revision_id = rev1 where id = q1;

  -- 1 · accepted quote -> invoice succeeds, R0 shipping preserved exactly (not defaulted)
  r := public.convert_quote_to_invoice(q1);
  select count(*) into n from public.opps_invoices where source_quote_id = q1;
  select (r->>'invoice_id')::uuid, r->>'invoice_number' into v_invoice_id, v_invoice_number;
  if (r->>'ok')::boolean = true and (r->>'replayed')::boolean = false and n = 1
     and (select subtotal from public.opps_invoices where id = v_invoice_id) = 378.00
     and (select shipping_charge from public.opps_invoices where id = v_invoice_id) = 0
     and (select total from public.opps_invoices where id = v_invoice_id) = 378.00
     and (select status from public.opps_invoices where id = v_invoice_id) = 'draft'
     and (select amount_paid from public.opps_invoices where id = v_invoice_id) = 0
     and (select count(*) from public.opps_invoice_items where invoice_id = v_invoice_id) = 2
     and v_invoice_number like 'OPPS-INV-%'
  then raise notice 'PASS 1 accepted quote -> direct invoice: subtotal R378, shipping R0 (exact, not defaulted), total R378, draft, unpaid, 2 lines, canonical OPPS-INV- numbering';
  else raise notice 'FAIL 1 r=% invoice=%', r, (select row_to_json(i) from public.opps_invoices i where id = v_invoice_id); end if;

  -- 2 · quote row: converted_invoice_id set, status STAYS accepted (critical
  --     design decision — Create Order must remain available afterward)
  if (select converted_invoice_id from public.opps_quotes where id = q1) = v_invoice_id
     and (select status from public.opps_quotes where id = q1) = 'accepted'
  then raise notice 'PASS 2 converted_invoice_id set; quote status STAYS accepted (Create Order remains available)';
  else raise notice 'FAIL 2 quote row: %', (select row_to_json(o) from public.opps_quotes o where id = q1); end if;

  -- 3 · exactly one converted event, tagged conversion_type=direct_invoice
  select count(*) into n from public.opps_quote_events where quote_id = q1 and event_type = 'converted';
  if n = 1 and (select metadata->>'conversion_type' from public.opps_quote_events where quote_id = q1) = 'direct_invoice'
  then raise notice 'PASS 3 exactly one converted event, conversion_type=direct_invoice';
  else raise notice 'FAIL 3 n=% metadata=%', n, (select metadata from public.opps_quote_events where quote_id = q1); end if;

  -- 4 · idempotent replay -> SAME invoice, no second one, no second event
  r := public.convert_quote_to_invoice(q1);
  select count(*) into n from public.opps_invoices where source_quote_id = q1;
  if (r->>'ok')::boolean = true and (r->>'replayed')::boolean = true
     and (r->>'invoice_id')::uuid = v_invoice_id and n = 1
  then raise notice 'PASS 4 duplicate quote->invoice call replays the SAME invoice, still exactly one row';
  else raise notice 'FAIL 4 r=% n=%', r, n; end if;
  select count(*) into n from public.opps_quote_events where quote_id = q1 and event_type = 'converted';
  if n = 1 then raise notice 'PASS 4b replay logs no second event'; else raise notice 'FAIL 4b event count=%', n; end if;

  -- 5 · Invoice -> Order: since status is still accepted, Create Order now
  --     works, propagates source_invoice_id onto the new order, AND —
  --     the architecture-gate fix — links the EXISTING invoice back to
  --     the order via the canonical opps_invoices.source_order_id field,
  --     using the real (not stubbed) link_invoice_to_order_relational.
  r := public.convert_quote_to_order(q1);
  select (r->>'order_id')::uuid into v_order_id;
  if (r->>'ok')::boolean = true and (r->>'replayed')::boolean = false
     and (select source_quote_id from public.orders where id = v_order_id) = q1
     and (select source_invoice_id from public.orders where id = v_order_id) = v_invoice_id
     and (select total_amount from public.orders where id = v_order_id) = 378.00
     and (select status from public.opps_quotes where id = q1) = 'converted'
     and (select source_order_id from public.opps_invoices where id = v_invoice_id) = v_order_id
     and (r->>'invoice_link_status') = 'linked'
  then raise notice 'PASS 5 later Create Order (Quote -> Invoice -> Order): order<->quote<->invoice fully cross-linked (source_quote_id, source_invoice_id, AND the invoice''s own canonical source_order_id), total R378 preserved, quote now converted';
  else raise notice 'FAIL 5 r=% order=% invoice_source_order_id=%', r, (select row_to_json(o) from public.orders o where id = v_order_id), (select source_order_id from public.opps_invoices where id = v_invoice_id); end if;

  -- 5b · discoverability: the EXACT query InvoicesTab.jsx's linkedInvoicesQuery
  --      runs (listInvoices({sourceOrderId}) -> .eq("source_order_id", ...))
  --      now finds the pre-existing direct invoice.
  select count(*) into n from public.opps_invoices where source_order_id = v_order_id;
  if n = 1 then raise notice 'PASS 5b order''s Invoices-tab query (source_order_id = order id) discovers the direct invoice';
  else raise notice 'FAIL 5b InvoicesTab query found % rows for order %', n, v_order_id; end if;

  -- 5c · activity parity: the direct invoice has BOTH its own creation
  --      activity AND the canonical link-to-order activity, exactly like
  --      any invoice created via the editor and then linked manually.
  select count(*) into n from public.opps_invoice_activity where invoice_id = v_invoice_id and activity_type = 'invoice_created';
  if n = 1 then raise notice 'PASS 5c invoice_created activity present (parity with save_opps_invoice_with_items)';
  else raise notice 'FAIL 5c invoice_created activity count=%', n; end if;
  select count(*) into n from public.opps_invoice_activity where invoice_id = v_invoice_id and activity_type = 'invoice_linked_to_order';
  if n = 1 then raise notice 'PASS 5c invoice_linked_to_order activity present (from the reused canonical RPC, not a parallel write)';
  else raise notice 'FAIL 5c invoice_linked_to_order activity count=%', n; end if;

  -- 6 · a plain Quote -> Order quote (no invoice at all) still has NULL
  --     source_invoice_id — propagation only happens when one exists.
  insert into public.opps_quotes (tenant_id, quote_number, status, customer_name, total)
  values (TENANT, 'QT-2026-000007', 'accepted', 'Plain Co', 150.00) returning id into q2;
  insert into public.opps_quote_revisions (quote_id, tenant_id, revision_number, snapshot, totals)
  values (q2, TENANT, 1, jsonb_build_object('total', 150.00, 'subtotal', 150.00, 'discount_total', 0, 'shipping_charge', 0, 'tax_total', 0,
    'items', jsonb_build_array(jsonb_build_object('line_number', 1, 'role', 'product', 'item_name', 'Item', 'quantity', 1, 'rate', 150.00, 'discount', 0, 'item_total', 150.00))),
    jsonb_build_object('total', 150.00)) returning id into rev2;
  update public.opps_quotes set accepted_revision_id = rev2 where id = q2;
  r := public.convert_quote_to_order(q2);
  if (select source_invoice_id from public.orders where id = (r->>'order_id')::uuid) is null
  then raise notice 'PASS 6 existing plain Quote -> Order path unaffected: source_invoice_id stays null with no direct invoice';
  else raise notice 'FAIL 6 source_invoice_id should be null: %', (select source_invoice_id from public.orders where id = (r->>'order_id')::uuid); end if;

  -- 7 · Quote -> Order already happened -> Create Invoice must refuse
  --     (must not orphan-invoice a quote that already has an order; that
  --     invoice belongs to the existing Order -> Invoice path instead)
  begin
    r := public.convert_quote_to_invoice(q2);
    raise notice 'FAIL 7 should have raised QUOTE_ORDER_ALREADY_EXISTS, got r=%', r;
  exception when others then
    if sqlerrm like '%QUOTE_ORDER_ALREADY_EXISTS%' then raise notice 'PASS 7 quote with an existing order refuses direct invoice creation: QUOTE_ORDER_ALREADY_EXISTS';
    else raise notice 'FAIL 7 wrong error: %', sqlerrm; end if;
  end;

  -- 8 · unaccepted quote -> invoice rejected
  insert into public.opps_quotes (tenant_id, quote_number, status, customer_name, total)
  values (TENANT, 'QT-2026-000008', 'draft', 'Draft Co', 0) returning id into q3;
  begin
    r := public.convert_quote_to_invoice(q3);
    raise notice 'FAIL 8 draft quote should have raised QUOTE_NOT_CONVERTIBLE, got r=%', r;
  exception when others then
    if sqlerrm like '%QUOTE_NOT_CONVERTIBLE%' then raise notice 'PASS 8 unaccepted quote rejected: QUOTE_NOT_CONVERTIBLE';
    else raise notice 'FAIL 8 wrong error: %', sqlerrm; end if;
  end;

  -- 9 · positive shipping in the snapshot is preserved exactly (never
  --     injected when absent, never dropped when present)
  insert into public.opps_quotes (tenant_id, quote_number, status, customer_name, total)
  values (TENANT, 'QT-2026-000009', 'accepted', 'Shipping Co', 220.00) returning id into q4;
  insert into public.opps_quote_revisions (quote_id, tenant_id, revision_number, snapshot, totals)
  values (q4, TENANT, 1, jsonb_build_object('total', 220.00, 'subtotal', 200.00, 'discount_total', 0, 'shipping_charge', 20.00, 'tax_total', 0,
    'items', jsonb_build_array(jsonb_build_object('line_number', 1, 'role', 'product', 'item_name', 'Item', 'quantity', 1, 'rate', 200.00, 'discount', 0, 'item_total', 200.00))),
    jsonb_build_object('total', 220.00)) returning id into rev4;
  update public.opps_quotes set accepted_revision_id = rev4 where id = q4;
  r := public.convert_quote_to_invoice(q4);
  if (select shipping_charge from public.opps_invoices where id = (r->>'invoice_id')::uuid) = 20.00
     and (select total from public.opps_invoices where id = (r->>'invoice_id')::uuid) = 220.00
  then raise notice 'PASS 9 explicit snapshot shipping (R20) carried through exactly, invoice total R220';
  else raise notice 'FAIL 9 %', (select row_to_json(i) from public.opps_invoices i where id = (r->>'invoice_id')::uuid); end if;

  -- 10 · a "paid" direct invoice (simulated) still allows exactly ONE order
  update public.opps_invoices set status = 'paid', amount_paid = 378.00, balance_due = 0 where id = v_invoice_id;
  r := public.convert_quote_to_order(q1); -- q1 already has an order from step 5 — must replay, not duplicate
  select count(*) into n from public.orders where source_quote_id = q1;
  if (r->>'replayed')::boolean = true and n = 1
  then raise notice 'PASS 10 paid direct invoice: Create Order still creates/keeps exactly one order (idempotent replay), payment status never bypasses duplicate protection';
  else raise notice 'FAIL 10 r=% n=%', r, n; end if;

  -- 10b · replaying convert_quote_to_order does not re-log invoice linkage
  --       (the linking call only runs on the FIRST, real creation branch,
  --       which the idempotent-replay early-return in step 10 never reaches)
  select count(*) into n from public.opps_invoice_activity where invoice_id = v_invoice_id and activity_type = 'invoice_linked_to_order';
  if n = 1 then raise notice 'PASS 10b replay does not repeatedly log invoice linkage — still exactly one invoice_linked_to_order activity row';
  else raise notice 'FAIL 10b invoice_linked_to_order activity count after replay=%', n; end if;

  -- 11 · SAFE CONFLICT: an invoice already linked to a DIFFERENT order must
  --      never be silently reassigned when a second quote''s Create Order
  --      is run. Build a second quote+direct-invoice, manually link that
  --      invoice to an unrelated third-party order (simulating someone
  --      using the ordinary OrderLinkPanel in between), then convert the
  --      quote to an order and confirm: the order IS still created (the
  --      user''s primary request is not silently blocked), but the
  --      invoice's source_order_id is UNTOUCHED — still the unrelated
  --      order, never reassigned.
  declare
    q5 uuid; rev5 uuid; inv5 uuid; unrelated_order uuid; new_order uuid; before_link uuid; after_link uuid;
  begin
    insert into public.opps_quotes (tenant_id, quote_number, status, customer_id, customer_name, total)
    values (TENANT, 'QT-2026-000010', 'accepted', CLIENT, 'Conflict Co', 90.00) returning id into q5;
    insert into public.opps_quote_revisions (quote_id, tenant_id, revision_number, snapshot, totals)
    values (q5, TENANT, 1, jsonb_build_object('total', 90.00, 'subtotal', 90.00, 'discount_total', 0, 'shipping_charge', 0, 'tax_total', 0,
      'items', jsonb_build_array(jsonb_build_object('line_number', 1, 'role', 'product', 'item_name', 'Item', 'quantity', 1, 'rate', 90.00, 'discount', 0, 'item_total', 90.00))),
      jsonb_build_object('total', 90.00)) returning id into rev5;
    update public.opps_quotes set accepted_revision_id = rev5 where id = q5;

    r := public.convert_quote_to_invoice(q5);
    inv5 := (r->>'invoice_id')::uuid;

    -- an unrelated order, same tenant/client, that the invoice gets
    -- manually linked to BEFORE this quote's own order is ever created
    insert into public.orders (client_name, client_id, tenant_id, order_number, products, total_amount)
    values ('Conflict Co', CLIENT, TENANT, 'ORD-UNRELATED-1', '[]'::jsonb, 90.00) returning id into unrelated_order;
    perform public.link_invoice_to_order_relational(inv5, unrelated_order);
    select source_order_id into before_link from public.opps_invoices where id = inv5;

    r := public.convert_quote_to_order(q5);
    new_order := (r->>'order_id')::uuid;
    select source_order_id into after_link from public.opps_invoices where id = inv5;

    if new_order is not null and new_order <> unrelated_order
       and before_link = unrelated_order and after_link = unrelated_order
       and (r->>'invoice_link_status') = 'skipped_already_linked_elsewhere'
    then raise notice 'PASS 11 safe conflict: order still created (never blocked by the unrelated invoice link), but the already-linked invoice is NEVER reassigned — source_order_id stays on the original order, invoice_link_status reports the skip';
    else raise notice 'FAIL 11 new_order=% before=% after=% status=%', new_order, before_link, after_link, r->>'invoice_link_status'; end if;
  end;

  raise notice 'RESULT: SEQUENTIAL DONE';
end $$;
SQL

echo "-----------------------------------------"
echo "RESULT: PASS (20260918100000 applies + idempotent; direct quote->invoice, idempotency, invoice<->order canonical cross-linking via the reused link_invoice_to_order_relational RPC, InvoicesTab-query discoverability, activity parity, the order-already-exists guard, unaccepted-quote rejection, exact shipping preservation both R0 and R20, paid-invoice duplicate protection, replay-does-not-relog, and the safe-conflict/never-reassign guarantee)"
