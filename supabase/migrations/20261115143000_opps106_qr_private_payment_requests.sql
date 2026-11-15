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
