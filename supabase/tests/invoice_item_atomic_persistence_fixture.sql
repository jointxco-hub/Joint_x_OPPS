\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;

do $$ begin
  create role authenticated;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role anon;
exception when duplicate_object then null;
end $$;

do $fixture$
begin
  if to_regprocedure('auth.uid()') is null then
    execute $sql$
      create function auth.uid()
      returns uuid language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid'
    $sql$;
  end if;
end
$fixture$;

create table public.tenants (
  id uuid primary key,
  slug text not null unique,
  status text not null default 'active'
);

create table public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id),
  auth_user_id uuid not null,
  status text not null default 'active',
  primary key (tenant_id, auth_user_id)
);

create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  user_email text,
  full_name text,
  role text,
  is_active boolean not null default true
);

create table public.test_tenant_memberships (
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null,
  finance_level integer,
  is_admin boolean not null default false,
  primary key (tenant_id, user_id)
);

create or replace function public.can_access_tenant(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.test_tenant_memberships
    where tenant_id = p_tenant_id and user_id = auth.uid()
  )
$$;

create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((
    select bool_or(is_admin) from public.test_tenant_memberships where user_id = auth.uid()
  ), false)
$$;

create or replace function public.user_finance_level()
returns integer language sql stable security definer set search_path = public
as $$
  select max(finance_level) from public.test_tenant_memberships where user_id = auth.uid()
$$;

create table public.products (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id)
);

create table public.inventory (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id)
);

create table public.opps_invoice_item_templates (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id)
);

create table public.opps_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text,
  customer_id uuid,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  customer_billing_address text,
  source_order_id uuid,
  invoice_date date not null,
  due_date date,
  payment_terms text,
  currency_code text not null default 'ZAR',
  status text not null default 'draft' check (status in ('draft', 'approved', 'exported', 'imported_to_zoho', 'paid', 'cancelled')),
  reference_number text,
  salesperson_name text,
  subtotal numeric not null default 0,
  discount_total numeric not null default 0,
  shipping_charge numeric not null default 0,
  adjustment numeric not null default 0,
  tax_total numeric not null default 0,
  total numeric not null default 0,
  amount_paid numeric not null default 0,
  balance_due numeric not null default 0,
  zoho_exported_at timestamptz,
  zoho_imported_at timestamptz,
  notes text,
  terms text,
  internal_notes text,
  tenant_id uuid not null references public.tenants(id),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create or replace function public.test_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger test_invoice_updated_at
before update on public.opps_invoices
for each row execute function public.test_touch_updated_at();

create table public.opps_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.opps_invoices(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  line_number integer not null,
  item_name text not null,
  item_description text,
  item_type text not null default 'goods',
  quantity numeric not null check (quantity > 0),
  unit text,
  rate numeric not null check (rate >= 0),
  discount numeric not null default 0,
  tax_name text,
  tax_percentage numeric not null default 0,
  account_name text,
  item_total numeric not null,
  source_order_item_id uuid,
  invoice_item_template_id uuid,
  catalog_item_id uuid,
  inventory_item_id uuid,
  source_metadata jsonb not null default '{}'::jsonb,
  line_key text,
  image_url text,
  specifications jsonb not null default '{}'::jsonb,
  proofs jsonb not null default '[]'::jsonb
);

create table public.opps_invoice_activity (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.opps_invoices(id) on delete cascade,
  activity_type text not null,
  activity_label text not null,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  tenant_id uuid not null references public.tenants(id),
  created_by uuid,
  created_at timestamptz not null default clock_timestamp()
);

create table public.opps_invoice_item_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid,
  invoice_id uuid,
  invoice_item_template_id uuid,
  line_key text not null,
  version_number integer not null,
  change_reason text,
  snapshot jsonb not null default '{}'::jsonb,
  changed_by uuid
);

alter table public.opps_invoices enable row level security;
alter table public.opps_invoice_items enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.users enable row level security;
alter table public.opps_invoice_item_versions enable row level security;

create policy test_invoice_read on public.opps_invoices
for select to authenticated using (public.can_access_tenant(tenant_id));

create policy test_invoice_item_read on public.opps_invoice_items
for select to authenticated using (public.can_access_tenant(tenant_id));

create policy test_tenant_read on public.tenants
for select to authenticated using (public.can_access_tenant(id));

create policy test_membership_read on public.tenant_memberships
for select to authenticated using (auth_user_id = auth.uid());

create policy test_user_read on public.users
for select to authenticated using (auth_user_id = auth.uid());

create policy test_invoice_version_manage on public.opps_invoice_item_versions
for all to authenticated using (public.can_access_tenant(tenant_id)) with check (public.can_access_tenant(tenant_id));

grant usage on schema public, auth to authenticated, anon;
grant select on public.opps_invoices, public.opps_invoice_items, public.opps_invoice_activity, public.tenants, public.tenant_memberships, public.users to authenticated;
grant select, insert on public.opps_invoice_item_versions to authenticated;
