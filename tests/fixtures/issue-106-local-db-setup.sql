-- Disposable local PostgreSQL ONLY. Never apply to a Supabase project.
\set ON_ERROR_STOP on
create schema if not exists auth;
do $$
begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;

create table public.tenants (id uuid primary key, slug text not null, status text not null);
create table public.tenant_memberships (
  tenant_id uuid not null, auth_user_id uuid not null,
  tenant_role text not null, status text not null
);
create table public.tenant_capabilities (
  tenant_id uuid not null, capability_key text not null, enabled boolean not null
);
create table public.orders (
  id uuid primary key, tenant_id uuid not null, order_number text,
  client_name text, status text, total_amount numeric, updated_at timestamptz
);
create table public.opps_invoices (
  id uuid primary key, tenant_id uuid not null, invoice_number text,
  source_order_id uuid, customer_name text, status text,
  total numeric, balance_due numeric, updated_at timestamptz
);

-- Mirrors the tested Cafe access rule; not a production migration.
create or replace function public.has_tenant_capability(
 p_tenant_id uuid, p_capability text
) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(
   auth.uid() is not null and p_tenant_id is not null
   and p_capability in ('cafe.operations.manage','cafe.counter.operate')
   and exists (
     select 1 from public.tenant_memberships m
     join public.tenants t on t.id=m.tenant_id and t.status='active'
     where m.tenant_id=p_tenant_id and m.auth_user_id=auth.uid()
       and m.status='active'
       and case p_capability
         when 'cafe.operations.manage' then m.tenant_role in ('owner','admin')
         when 'cafe.counter.operate' then m.tenant_role in ('owner','admin','member')
         else false end
   ), false)
$$;
revoke all on function public.has_tenant_capability(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.has_tenant_capability(uuid,text) to authenticated;

insert into public.tenants values
 ('11111111-1111-4111-8111-111111111111','quick-solution','active'),
 ('22222222-2222-4222-8222-222222222222','other-tenant','active');
insert into public.tenant_capabilities values
 ('11111111-1111-4111-8111-111111111111','quick_solution',true);
insert into public.tenant_memberships values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','member','active'),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','admin','active'),
 ('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','member','suspended');

insert into public.orders values
 ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','QS-ORDER-1','Test Cafe Customer','processing',125,'2026-11-05T12:00:00Z'),
 ('10000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','OTHER-ORDER-1','Secret Other Customer','processing',800,'2026-11-05T12:30:00Z');
insert into public.opps_invoices values
 ('20000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','QS-PAID-1',null,'Test Paid','paid',90,0,'2026-11-05T12:10:00Z'),
 ('20000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','QS-DRAFT-1',null,'Test Draft','draft',50,50,'2026-11-05T12:20:00Z'),
 ('20000000-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222','OTHER-INV-1',null,'Secret Other Invoice','sent',1000,1000,'2026-11-05T12:40:00Z');

-- The function is owned by postgres; these grants exercise only EXECUTE.
grant usage on schema public to authenticated, anon;
