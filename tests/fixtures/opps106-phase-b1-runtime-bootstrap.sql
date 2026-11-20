-- Phase B isolated functional environment; fake synthetic data only.
-- Run after Phase A clean schema, before real production manual-payment snapshot.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
$$;
alter table public.tenants add column slug text, add column status text default 'active',add column settings jsonb default '{}'::jsonb;
create table public.tenant_capabilities(
 tenant_id uuid,capability_key text,enabled boolean default true
);
create table public.tenant_memberships(
 tenant_id uuid,auth_user_id uuid,status text,tenant_role text
);
create or replace function public.has_tenant_capability(t uuid,c text)
 returns boolean language sql stable as $$
 select exists(select 1 from public.tenant_capabilities
 where tenant_id=t and capability_key=c and enabled)
$$;
create table commerce.service_orders(
 id uuid primary key,tenant_id uuid not null,channel text default 'counter',
 status text default 'submitted',payment_status text default 'unpaid',
 total_amount numeric not null,order_number text,
 opps_order_id uuid,fulfilment_type text default 'collection',
 source_metadata jsonb default '{}'::jsonb,
 updated_at timestamptz default now()
);
create table commerce.service_order_items(order_id uuid,tenant_id uuid,product_id uuid);
create table commerce.service_product_configs(tenant_id uuid,product_id uuid,customer_definition jsonb default '{}'::jsonb);
alter table commerce.service_order_payments add column tenant_id uuid,
 add column service_order_id uuid,
 add column provider text default 'counter',
 add column status text default 'pending',
 add column amount numeric,
 add column idempotency_key text,
 add column recorded_by uuid,
 add column initiated_at timestamptz,
 add column completed_at timestamptz,
 add column updated_at timestamptz default now();
create unique index qs106_fake_payment_key on commerce.service_order_payments(tenant_id,idempotency_key)
 where idempotency_key is not null;
create or replace function commerce._qs_order_amount_paid(p uuid)
returns numeric language sql stable as $$
 select coalesce(sum(amount) filter(where status='completed'),0)
 from commerce.service_order_payments where service_order_id=p
$$;
create or replace function commerce._qs_counter_payment_block(p commerce.service_orders)
returns text language plpgsql stable as $$
begin
 if p.payment_status='paid' then return 'already_paid';end if;
 if p.status in('draft','cancelled','completed') then return 'not_payable';end if;
 if p.opps_order_id is not null then return 'sent_to_production';end if;
 if p.total_amount<=0 or p.total_amount<=commerce._qs_order_amount_paid(p.id)
 then return 'nothing_outstanding';end if;
 return null;
end $$;
create or replace function commerce.qs_project_manual_receipt(p uuid)
 returns void language plpgsql as $$ begin return; end $$;

-- Baseline production Counter function imported as a separate exact snapshot.
-- The tested Phase B upgrade will verify its pg_get_functiondef checksum.
