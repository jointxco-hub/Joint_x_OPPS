-- OPPS-106 data-free rehearsal compatibility for Phase B3.
-- Existing Phase A/B1/B2 and live-candidate SQL are already installed in
-- the disposable database. No actual customer, merchant or payment data.
create table public.orders(
 id uuid primary key, tenant_id uuid not null,
 source text default 'quick_solution',
 payment_method text, payment_environment text not null default 'live',
 payment_reference text, payment_status text default 'pending',
 total_amount numeric not null default 60, deposit_paid numeric default 0,
 is_test boolean not null default false,
 excluded_from_reports boolean not null default false,
 updated_at timestamptz default now()
);
create table public.transactions(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
 type text,order_id uuid,order_number text,client_name text,
 amount numeric,payment_method text,payment_status text,payment_date date,
 source text,qs_service_order_id uuid,notes text,reference text,
 is_test boolean default false,excluded_from_reports boolean default false
);
create unique index qs106_clean_finance_unique on public.transactions(qs_service_order_id);
create function commerce.qs_project_invoice_receipts(uuid)
returns void language plpgsql as $mock$ begin return;end $mock$;
create function commerce._qs_sync_opps_payment_ledger_legacy(uuid,uuid)
returns void language plpgsql as $mock$ begin return;end $mock$;

-- The original production function bodies are loaded from the pinned snapshot
-- in a separate CI step, *before* the guarded B3 replacement.
