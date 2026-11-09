-- ISSUE 106 / DRAFT ONLY — NOT DEPLOYED. Requires isolated Postgres validation.
-- Private, server-only storage. Never grant direct browser Data API access.
begin;
create schema if not exists qr_payments;
revoke all on schema qr_payments from public, anon, authenticated;

create table if not exists qr_payments.payment_requests (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  target_type text not null check (target_type in ('cafe_order','opps_invoice')),
  target_id uuid not null,
  operation_key text not null check (operation_key ~ '^[a-zA-Z0-9_-]{8,128}$'),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  status text not null check (status in ('active','expired','revoked','settled')),
  checkout_url text,
  gateway_payment_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint qr_active_has_url check (status <> 'active' or (checkout_url is not null and length(checkout_url)>0)),
  constraint qr_inactive_no_url check (status = 'active' or checkout_url is null),
  constraint qr_settled_has_reference check (status <> 'settled' or gateway_payment_id is not null),
  constraint qr_expiry_after_creation check (expires_at > created_at),
  unique (tenant_id,target_type,target_id,operation_key)
);
create unique index if not exists qr_one_active_per_target
  on qr_payments.payment_requests(tenant_id,target_type,target_id) where status='active';
create unique index if not exists qr_gateway_reference_unique
  on qr_payments.payment_requests(gateway_payment_id) where gateway_payment_id is not null;
create index if not exists qr_requests_target_lookup
  on qr_payments.payment_requests(target_type,target_id,created_at desc);
alter table qr_payments.payment_requests enable row level security;
alter table qr_payments.payment_requests force row level security;
revoke all on qr_payments.payment_requests from public,anon,authenticated;

create table if not exists qr_payments.payment_exceptions (
  id bigint generated always as identity primary key,
  payment_request_id uuid not null references qr_payments.payment_requests(id),
  gateway_payment_id text not null check (length(gateway_payment_id)>0),
  reason text not null check (reason in ('ADDITIONAL_CAPTURE','CAPTURE_REQUIRES_RECONCILIATION')),
  amount_cents bigint check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique(payment_request_id,gateway_payment_id,reason)
);
alter table qr_payments.payment_exceptions enable row level security;
alter table qr_payments.payment_exceptions force row level security;
revoke all on qr_payments.payment_exceptions from public,anon,authenticated;
-- No policies. Only a carefully reviewed, isolated privileged backend
-- (or specifically granted dedicated DB role) can manipulate these rows.
-- FORCE RLS also applies to the owner; provisioning a BYPASSRLS backend role
-- must be reviewed explicitly rather than assumed.

-- Verified PayFast captures that cannot be related to an existing request
-- MUST still be retained for finance. This table intentionally has no FK.
create table if not exists qr_payments.unmatched_captures (
  id bigint generated always as identity primary key,
  gateway_payment_id text not null unique,
  claimed_request_id text,
  claimed_tenant_id text,
  claimed_target_id text,
  claimed_type text,
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null,
  created_at timestamptz not null default now()
);
alter table qr_payments.unmatched_captures enable row level security;
alter table qr_payments.unmatched_captures force row level security;
revoke all on qr_payments.unmatched_captures from public,anon,authenticated;

commit;
