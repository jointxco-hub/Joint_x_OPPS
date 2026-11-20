-- Disposable PostgreSQL-16 bootstrap for the QR PHASE A schema candidate.
-- Deliberately NOT a copy of real tenant/order/customer/payment data.
do $roles$
begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end $roles$;
create schema if not exists commerce;
create table public.tenants(id uuid primary key);
create table commerce.service_order_payments(id uuid primary key);
