-- Minimal disposable prelude for the QUOTES Q1 migration.
-- Recreates ONLY the production objects the Q1 migration references, with
-- production-equivalent semantics. Throwaway container only.
\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;

create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
grant usage on schema auth to anon, authenticated;

create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb
  language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), '')::jsonb, '{}'::jsonb) $$;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text,
  status text not null default 'active'
);

create table public.users (
  auth_user_id uuid primary key,
  user_email text,
  full_name text,
  role text,
  is_active boolean not null default true
);

create table public.tenant_memberships (
  auth_user_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'active',
  primary key (auth_user_id, tenant_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  name text,
  email text
);

-- stub: the Q1 migration only needs opps_invoices(id) for a SET NULL FK
create table public.opps_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  status text default 'draft'
    check (status in ('draft','approved','exported','imported_to_zoho','paid','partially_paid','overdue','void'))
);

-- ── RLS helpers — production-equivalent semantics ──────────────────
-- production semantics: membership-only. Being an app admin does NOT grant
-- access to a tenant you are not a member of.
create or replace function public.can_access_tenant(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(exists (
    select 1 from public.tenant_memberships m
    where m.auth_user_id = auth.uid() and m.tenant_id = p_tenant_id and m.status = 'active'
  ), false)
$$;

create or replace function public.is_app_admin() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select role in ('admin','owner') from public.users where auth_user_id = auth.uid()), false)
$$;

create or replace function public.is_opps_staff() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(exists (
    select 1
    from public.users u
    join public.tenant_memberships membership
      on membership.auth_user_id = u.auth_user_id and membership.status = 'active'
    join public.tenants tenant
      on tenant.id = membership.tenant_id and tenant.status = 'active' and tenant.slug = 'joint-x'
    where u.auth_user_id = auth.uid() and coalesce(u.is_active, true)
  ), false)
$$;

create or replace function public.user_finance_level() returns int
  language sql stable security definer set search_path = pg_catalog, public as $$
  select case (select role from public.users where auth_user_id = auth.uid())
    when 'admin' then 1
    when 'owner' then 1
    when 'finance_admin' then 2
    when 'finance' then 2
    when 'manager' then 2
    else 0
  end
$$;

grant execute on function public.can_access_tenant(uuid), public.is_app_admin(),
  public.is_opps_staff(), public.user_finance_level() to anon, authenticated;

create or replace function public.opps_invoicing_touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
