-- Issue #107: PRIVATE notification event/outbox DRAFT. Not deployed.
-- Test on disposable PostgreSQL before applying to staging.
begin;
create schema if not exists opps_private;
revoke all on schema opps_private from public,anon,authenticated;
create table if not exists opps_private.notification_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  source_id uuid not null,
  event_type text not null check (event_type in
    ('INVOICE_APPROVED','INVOICE_PAID','INVOICE_VOIDED',
     'QUOTE_SENT','QUOTE_ACCEPTED','QUOTE_DECLINED','INVENTORY_LOW')),
  event_key text not null check (length(event_key) between 8 and 256),
  occurred_at timestamptz not null default now(),
  unique (tenant_id,event_key),
  unique (id,tenant_id)
);
create table if not exists opps_private.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  tenant_id uuid not null,
  recipient_auth_user_id uuid not null,
  status text not null default 'pending' check
    (status in ('pending','processing','sent','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_until timestamptz,
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id,tenant_id)
    references opps_private.notification_events(id,tenant_id) on delete restrict,
  unique (event_id,recipient_auth_user_id)
);
create index if not exists notification_deliveries_due
  on opps_private.notification_deliveries(next_attempt_at,id)
  where status in ('pending','failed','processing');
create index if not exists notification_events_tenant_time
  on opps_private.notification_events(tenant_id,occurred_at desc);

alter table opps_private.notification_events enable row level security;
alter table opps_private.notification_events force row level security;
alter table opps_private.notification_deliveries enable row level security;
alter table opps_private.notification_deliveries force row level security;
revoke all on opps_private.notification_events from public,anon,authenticated;
revoke all on opps_private.notification_deliveries from public,anon,authenticated;

-- This is not a browser-facing API; only the reviewed backend can enqueue.
do $$
begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant usage on schema opps_private to service_role;
    grant select,insert,update on opps_private.notification_events to service_role;
    grant select,insert,update on opps_private.notification_deliveries to service_role;
  end if;
end $$;
commit;
