-- Disposable PostgreSQL fixture ONLY. Never run against any Supabase project.
\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
create schema auth;
create schema commerce;
create schema qr_payments;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;

create table public.tenants(id uuid primary key,slug text,status text);
create table public.tenant_capabilities(tenant_id uuid,capability_key text,enabled boolean);
create function public.has_tenant_capability(p_tenant uuid,p_capability text)
returns boolean language sql stable as $$
 select auth.uid() is not null and exists(
   select 1 from public.tenant_capabilities
   where tenant_id=p_tenant and capability_key=p_capability and enabled)
$$;

create table commerce.service_orders(
 id uuid primary key,tenant_id uuid not null,channel text not null,
 payment_status text not null,status text not null,total_amount numeric not null,
 order_number text,opps_order_id uuid,source_metadata jsonb default '{}'::jsonb,
 updated_at timestamptz default now()
);
create table commerce.service_order_payments(
 id uuid primary key default gen_random_uuid(),tenant_id uuid,service_order_id uuid,
 provider text,status text,amount numeric,initiated_at timestamptz,
 completed_at timestamptz,recorded_by uuid,idempotency_key text unique,
 updated_at timestamptz default now()
);
create table commerce.service_order_handoffs(service_order_id uuid,status text);
create table qr_payments.payment_requests(
 id uuid primary key default gen_random_uuid(),tenant_id uuid,
 target_type text,target_id uuid,status text,
 checkout_started_at timestamptz
);
create function commerce._qs_order_amount_paid(p_order uuid)
returns numeric language sql stable as $$
 select coalesce(sum(amount),0) from commerce.service_order_payments
 where service_order_id=p_order and status='completed'
$$;
create function commerce._qs_counter_payment_block(p commerce.service_orders)
returns text language plpgsql stable as $$
begin
 if p.payment_status='paid' then return 'already_paid'; end if;
 if p.payment_status<>'unpaid' or p.status in ('draft','cancelled','completed')
 then return 'not_payable'; end if;
 if p.opps_order_id is not null or exists(
   select 1 from commerce.service_order_handoffs h
   where h.service_order_id=p.id and h.status in ('sending','sent'))
 then return 'sent_to_production'; end if;
 if p.total_amount<=0 or round(p.total_amount-commerce._qs_order_amount_paid(p.id),2)<=0
 then return 'nothing_outstanding'; end if;
 return null;
end $$;
create function commerce.qs_project_manual_receipt(p_order_id uuid)
returns void language plpgsql as $$begin return; end$$;

insert into public.tenants values
 ('11111111-1111-4111-8111-111111111111','quick-solution','active');
insert into public.tenant_capabilities values
 ('11111111-1111-4111-8111-111111111111','cafe.counter.operate',true),
 ('11111111-1111-4111-8111-111111111111','quick_solution',true);

insert into commerce.service_orders(id,tenant_id,channel,payment_status,status,total_amount,order_number)
select ('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
 '11111111-1111-4111-8111-111111111111','counter','unpaid','submitted',60,
 'QS-ISOLATED-'||i
from generate_series(1,5) i;
-- A: QR will be issued concurrently by the first transaction.
-- B: two manual devices compete to settle.
-- C: expired QR with checkout begun, still manual-blocked.
-- D: expired QR never checked out, manual-safe.
-- E: pending PayFast intent, manual-blocked.
insert into qr_payments.payment_requests(tenant_id,target_type,target_id,status,checkout_started_at)
values
 ('11111111-1111-4111-8111-111111111111','cafe_order','00000000-0000-4000-8000-000000000003','expired',now()-interval '2 hours'),
 ('11111111-1111-4111-8111-111111111111','cafe_order','00000000-0000-4000-8000-000000000004','expired',null);
insert into commerce.service_order_payments(tenant_id,service_order_id,provider,status,amount)
values
 ('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000005','payfast','pending',60);
