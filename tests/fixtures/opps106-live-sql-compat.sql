-- Disposable Postgres compatibility shim ONLY, never run on Supabase.
-- Extend the existing OPPS-106 race fixture so PostgreSQL can parse the
-- review-only candidate schema and PL/pgSQL definitions.
alter table qr_payments.payment_requests
 add column amount_cents bigint default 6000,
 add column expires_at timestamptz default (now()+interval '2 minutes'),
 add column checkout_intent_id uuid,
 add column checkout_environment text,
 add column checkout_merchant_id text,
 add column checkout_gateway_reference text,
 add column checkout_contract_version text,
 add column gateway_payment_id text,
 add column gateway_environment text,
 add column gateway_environment_evidence text,
 add column checkout_url text,
 add column updated_at timestamptz default now(),
 add column currency_code text default 'ZAR';
alter table qr_payments.payment_requests
 add constraint qr_payment_environment_evidence_pair check (
   (gateway_environment is null and gateway_environment_evidence is null)
   or (gateway_environment='sandbox' and gateway_environment_evidence='sandbox_only_verified_itn')
 );
create function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')
$$;
alter table public.tenants add column settings jsonb default '{}'::jsonb;
alter table commerce.service_orders
 add column customer_name text,add column customer_email text,
 add column fulfilment_type text default 'collection';
alter table commerce.service_order_payments
 add column pf_payment_id text,add column raw_itn jsonb default '{}'::jsonb;
create table commerce.service_order_items(order_id uuid,tenant_id uuid,product_id uuid);
create table commerce.service_product_configs(tenant_id uuid,product_id uuid,customer_definition jsonb);
create table qr_payments.issuance_controls(target_type text primary key,
 enabled boolean not null default false,allowed_order_id uuid,active_until timestamptz);
insert into qr_payments.issuance_controls(target_type,enabled) values('cafe_order',false);
create table qr_payments.payment_exceptions(
 id uuid primary key default gen_random_uuid(),
 payment_request_id uuid,gateway_payment_id text,reason text,amount_cents bigint,
 unique(payment_request_id,gateway_payment_id,reason));
create table qr_payments.unmatched_captures(
 id uuid primary key default gen_random_uuid(),
 gateway_payment_id text unique,claimed_request_id text,claimed_tenant_id text,
 claimed_target_id text,claimed_type text,amount_cents bigint,reason text);
create table qr_payments.noncomplete_events(
 id uuid primary key default gen_random_uuid(),
 gateway_payment_id text,event_status text,claimed_request_id uuid,
 claimed_order_id uuid,claimed_tenant_id uuid,amount_cents bigint,handling text,
 unique(gateway_payment_id,event_status,claimed_request_id));
create function commerce.qs_apply_payfast_payment(uuid,numeric,text,jsonb)
 returns jsonb language sql as $$ select '{"ok":false}'::jsonb $$;
