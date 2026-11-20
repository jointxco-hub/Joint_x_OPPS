-- OPPS-106 production base, PHASE A, REVIEW ONLY. NOT AN AUTO-MIGRATION.
-- Derived exclusively from five inspected QR private-schema migrations.
-- NO issuer, scanner, settlement, PayFast calls, Finance mutations, or live switches.
-- Absolutely do not copy staging migration data or browser endpoint URLs.
-- Precheck: abort on preexisting QR objects instead of silently masking drift.
do $preflight$
begin
 if to_regclass('public.tenants') is null
   or to_regclass('commerce.service_order_payments') is null
 then raise exception 'OPPS106_MISSING_PRODUCTION_DEPENDENCY';end if;
 if to_regclass('qr_payments.payment_requests') is not null
   or to_regclass('qr_payments.issuance_controls') is not null
 then raise exception 'OPPS106_QR_SCHEMA_ALREADY_EXISTS_RECONCILE_FIRST';end if;
end $preflight$;


-- Source 1: supabase/migrations/20261115143000_opps106_qr_private_payment_requests.sql
-- OPPS-106 QR payment requests: private durable storage, not an API or checkout.
-- This migration does not issue a QR, initiate a PayFast checkout, or move money.
-- Only the service role may use these tables; application staff authorization
-- and verified gateway settlement must be implemented in a separate adapter.
create schema if not exists qr_payments;
revoke all on schema qr_payments from public, anon, authenticated;
grant usage on schema qr_payments to service_role;

create table if not exists qr_payments.payment_requests (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  target_type text not null check (target_type in ('cafe_order','opps_invoice')),
  target_id uuid not null,
  operation_key text not null check (operation_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  amount_cents bigint not null check (amount_cents > 0),
  currency_code text not null default 'ZAR' check (currency_code='ZAR'),
  status text not null check (status in ('active','expired','revoked','settled')),
  checkout_url text,
  gateway_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint qr_payment_request_expiry check (expires_at > created_at),
  constraint qr_payment_request_active_url check (
    (status='active' and checkout_url is not null and length(checkout_url)>0
      and gateway_payment_id is null)
    or (status in ('expired','revoked') and checkout_url is null
      and gateway_payment_id is null)
    or (status='settled' and checkout_url is null
      and gateway_payment_id is not null and length(gateway_payment_id)>0)
  ),
  constraint qr_payment_request_operation unique (target_type,target_id,operation_key)
);
-- A target may have one outstanding QR across all operator devices.
create unique index if not exists qr_payment_requests_one_active
  on qr_payments.payment_requests (tenant_id,target_type,target_id)
  where status='active';
-- Repeated signed callbacks cannot attach one provider capture to two requests.
create unique index if not exists qr_payment_requests_unique_gateway_payment
  on qr_payments.payment_requests (gateway_payment_id)
  where gateway_payment_id is not null;
create index if not exists qr_payment_requests_target_lookup
  on qr_payments.payment_requests (tenant_id,target_type,target_id,created_at desc);

create table if not exists qr_payments.payment_exceptions (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references qr_payments.payment_requests(id),
  gateway_payment_id text not null check (length(gateway_payment_id)>0),
  reason text not null check (reason in (
    'ADDITIONAL_CAPTURE','CAPTURE_REQUIRES_RECONCILIATION'
  )),
  amount_cents bigint check (amount_cents is null or amount_cents > 0),
  created_at timestamptz not null default now(),
  constraint qr_payment_exception_once unique (payment_request_id,gateway_payment_id,reason)
);
create index if not exists qr_payment_exceptions_recent
  on qr_payments.payment_exceptions (created_at desc);

alter table qr_payments.payment_requests enable row level security;
alter table qr_payments.payment_exceptions enable row level security;
revoke all on qr_payments.payment_requests from public, anon, authenticated;
revoke all on qr_payments.payment_exceptions from public, anon, authenticated;
grant select,insert,update on qr_payments.payment_requests to service_role;
grant select,insert on qr_payments.payment_exceptions to service_role;
-- No RLS policies for browser roles: this schema is not a Data API surface.
comment on table qr_payments.payment_requests is
  'Private QR checkout contract. Staff authorization and verified gateway callbacks are required before use.';


-- Source 2: supabase/migrations/20261115144500_opps106_qr_unmatched_capture_quarantine.sql
-- OPPS-106 QR: retain VERIFIED but unmatchable gateway captures for Finance review.
-- This does not call the gateway or change order/payment statuses.
create table if not exists qr_payments.unmatched_captures (
  id uuid primary key default gen_random_uuid(),
  gateway_payment_id text not null unique check (length(gateway_payment_id)>0),
  claimed_request_id text,
  claimed_tenant_id text,
  claimed_target_id text,
  claimed_type text,
  amount_cents bigint not null check (amount_cents>0),
  reason text not null check (length(reason)>0),
  created_at timestamptz not null default now()
);
create index if not exists qr_unmatched_captures_recent
  on qr_payments.unmatched_captures (created_at desc);
alter table qr_payments.unmatched_captures enable row level security;
revoke all on qr_payments.unmatched_captures from public,anon,authenticated;
grant select,insert on qr_payments.unmatched_captures to service_role;
comment on table qr_payments.unmatched_captures is
  'Verified gateway capture requiring manual Finance reconciliation. No browser access.';


-- Source 3: supabase/migrations/20261115163500_opps106_counter_qr_issuance_disabled.sql
-- OPPS-106 counter QR issuance gate. DISABLED unless explicitly enabled
-- after reviewed scan/PayFast reconciliation adapter is deployed.
-- Private configuration; no browser role can enable payments.
create table if not exists qr_payments.issuance_controls (
  target_type text primary key check (target_type in ('cafe_order','opps_invoice')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into qr_payments.issuance_controls(target_type,enabled)
values ('cafe_order',false),('opps_invoice',false)
on conflict (target_type) do nothing;
alter table qr_payments.issuance_controls enable row level security;
revoke all on qr_payments.issuance_controls from public,anon,authenticated,service_role;
grant select on qr_payments.issuance_controls to service_role;


-- Source 4: supabase/migrations/20261115171500_opps106_qr_scan_payfast_intent.sql
-- OPPS-106: private sandbox QR scan → canonical Café PayFast intent.
-- The existing issuance flag remains FALSE. No checkout is enabled by this migration.
alter table qr_payments.payment_requests
  add column if not exists checkout_intent_id uuid
    references commerce.service_order_payments(id),
  add column if not exists checkout_started_at timestamptz;

create unique index if not exists qr_payment_request_unique_checkout_intent
  on qr_payments.payment_requests(checkout_intent_id)
  where checkout_intent_id is not null;

alter table qr_payments.payment_requests
  add constraint qr_checkout_intent_pair
  check ((checkout_intent_id is null and checkout_started_at is null)
      or (checkout_intent_id is not null and checkout_started_at is not null));


-- Source 5: supabase/migrations/20261115181500_opps106_qr_noncomplete_events.sql
-- OPPS-106: record verified non-complete QR gateway notifications safely.
-- Service-only canonical closure: never uses a browser payment status.
create table if not exists qr_payments.noncomplete_events (
  id uuid primary key default gen_random_uuid(),
  gateway_payment_id text not null check(length(gateway_payment_id)>0),
  event_status text not null check(event_status in ('failed','cancelled')),
  claimed_request_id uuid not null,
  claimed_order_id uuid not null,
  claimed_tenant_id uuid not null,
  amount_cents bigint not null check(amount_cents>0),
  handling text not null check(handling in
    ('closed','replayed','mismatched','already_settled','late_or_stale')),
  created_at timestamptz not null default now(),
  unique(gateway_payment_id,event_status,claimed_request_id)
);
alter table qr_payments.noncomplete_events enable row level security;
revoke all on qr_payments.noncomplete_events from public,anon,authenticated;
grant select,insert on qr_payments.noncomplete_events to service_role;
create index if not exists qr_noncomplete_recent
  on qr_payments.noncomplete_events(created_at desc);

-- Future issuance (separate reviewed release) must always be order-scoped.
alter table qr_payments.issuance_controls
 add column allowed_order_id uuid,
 add column active_until timestamptz,
 add constraint qr_issuance_requires_scope check
   (not enabled or (allowed_order_id is not null and active_until is not null));

-- Persist the real provider checkout identity; nullable on base-only installs.
alter table qr_payments.payment_requests
 add column checkout_environment text,
 add column checkout_merchant_id text,
 add column checkout_gateway_reference text,
 add column checkout_contract_version text,
 add column gateway_environment text,
 add column gateway_environment_evidence text,
 add constraint qs106_checkout_provenance_bundle check (
   (checkout_environment is null and checkout_merchant_id is null
    and checkout_gateway_reference is null and checkout_contract_version is null)
   or (checkout_environment in ('sandbox','live')
    and checkout_merchant_id ~ '^[0-9]{6,20}$'
    and checkout_gateway_reference is not null
    and checkout_contract_version='jointx_qr_v2')),
 add constraint qr_payment_environment_evidence_pair check (
   (gateway_environment is null and gateway_environment_evidence is null)
   or (gateway_environment='sandbox' and gateway_environment_evidence='sandbox_only_verified_itn')
   or (gateway_environment='live' and gateway_environment_evidence='payfast_itn_validated_live')
 );

-- All tables are private and deny browser DML. Preserve explicit OFF on install.
do $check$
begin
 if exists(select 1 from qr_payments.issuance_controls where enabled) then
  raise exception 'OPPS106_BASE_CANNOT_ENABLE_ISSUANCE';end if;
 if exists (
   select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='qr_payments' and c.relkind='r' and not c.relrowsecurity
 ) then raise exception 'OPPS106_PRIVATE_RLS_MISSING';end if;
end $check$;
-- Never grant browser access to these private payment tables.
-- NO permissions to issue payments, capture funds or change financial records.
