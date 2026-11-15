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
