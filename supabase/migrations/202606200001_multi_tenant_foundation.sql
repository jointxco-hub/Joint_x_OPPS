-- Multi-tenant foundation for Joint X, OPPS, and X LAB.
-- This migration is intentionally non-breaking: it establishes ownership and
-- backfills the existing Joint X data before tenant-scoped RLS is introduced.

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_tenants_updated_at on public.tenants;
create trigger trg_tenants_updated_at
  before update on public.tenants
  for each row execute function public.opps_invoicing_touch_updated_at();

create table if not exists public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  tenant_role text not null default 'member' check (tenant_role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, auth_user_id)
);

drop trigger if exists trg_tenant_memberships_updated_at on public.tenant_memberships;
create trigger trg_tenant_memberships_updated_at
  before update on public.tenant_memberships
  for each row execute function public.opps_invoicing_touch_updated_at();

create index if not exists idx_tenant_memberships_auth_user_id
  on public.tenant_memberships(auth_user_id, tenant_id)
  where status = 'active';

insert into public.tenants (slug, name)
values ('joint-x', 'Joint X')
on conflict (slug) do update set name = excluded.name;

insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role)
select
  tenant.id,
  internal_user.auth_user_id,
  case when internal_user.role = 'admin' then 'owner' else 'member' end
from public.tenants tenant
join public.users internal_user on internal_user.is_active = true
where tenant.slug = 'joint-x'
  and internal_user.auth_user_id is not null
on conflict (tenant_id, auth_user_id) do nothing;

create or replace function public.current_user_tenant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select membership.tenant_id
  from public.tenant_memberships membership
  where membership.auth_user_id = auth.uid()
    and membership.status = 'active';
$$;

create or replace function public.can_access_tenant(p_tenant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.current_user_tenant_ids() as membership_tenant(tenant_id)
    where membership_tenant.tenant_id = p_tenant_id
  );
$$;

grant execute on function public.current_user_tenant_ids() to authenticated;
grant execute on function public.can_access_tenant(uuid) to authenticated;
revoke execute on function public.current_user_tenant_ids() from anon;
revoke execute on function public.can_access_tenant(uuid) from anon;

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;

drop policy if exists tenant_members_read on public.tenants;
create policy tenant_members_read on public.tenants
  for select to authenticated
  using (public.is_app_admin() or public.can_access_tenant(id));

drop policy if exists app_admin_manage_tenants on public.tenants;
create policy app_admin_manage_tenants on public.tenants
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists members_read_own_memberships on public.tenant_memberships;
create policy members_read_own_memberships on public.tenant_memberships
  for select to authenticated
  using (public.is_app_admin() or auth_user_id = auth.uid());

drop policy if exists app_admin_manage_tenant_memberships on public.tenant_memberships;
create policy app_admin_manage_tenant_memberships on public.tenant_memberships
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

do $$
declare
  v_table_name text;
  v_index_name text;
begin
  foreach v_table_name in array array[
    'clients',
    'orders',
    'products',
    'transactions',
    'xlab_orders',
    'client_file_folders',
    'client_file_links',
    'client_quote_requests',
    'client_messages',
    'client_profile_requests',
    'opps_invoices',
    'opps_invoice_items',
    'opps_invoice_exports',
    'opps_invoice_export_settings',
    'opps_invoice_activity'
  ]
  loop
    if to_regclass('public.' || v_table_name) is not null then
      execute format(
        'alter table public.%I add column if not exists tenant_id uuid references public.tenants(id) on delete restrict',
        v_table_name
      );
      execute format(
        'update public.%I set tenant_id = (select id from public.tenants where slug = ''joint-x'') where tenant_id is null',
        v_table_name
      );
      v_index_name := 'idx_' || v_table_name || '_tenant_id';
      execute format(
        'create index if not exists %I on public.%I (tenant_id)',
        v_index_name,
        v_table_name
      );
    end if;
  end loop;
end$$;
