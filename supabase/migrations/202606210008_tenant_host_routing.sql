-- Phase 1 tenant/host routing foundation.
-- Additive only: no existing public route uses these resolvers yet.

create table if not exists public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  hostname text not null,
  surface text not null check (surface in ('ops', 'xos_admin', 'public_tracking', 'storefront')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'active', 'disabled')),
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hostname, surface)
);

create index if not exists idx_tenant_domains_tenant_id
  on public.tenant_domains(tenant_id, surface)
  where status = 'active';

create unique index if not exists idx_tenant_domains_one_primary_per_surface
  on public.tenant_domains(tenant_id, surface)
  where is_primary and status = 'active';

create or replace function public.normalize_tenant_hostname(p_hostname text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized text := lower(trim(coalesce(p_hostname, '')));
begin
  if normalized = ''
    or length(normalized) > 253
    or normalized like '%://%'
    or normalized like '%/%'
    or normalized like '%?%'
    or normalized like '%#%'
    or normalized like '%:%'
    or right(normalized, 1) = '.'
    or normalized !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
  then
    return null;
  end if;

  return normalized;
end;
$$;

create or replace function public.enforce_tenant_domain_hostname()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  normalized text;
begin
  normalized := public.normalize_tenant_hostname(new.hostname);
  if normalized is null then
    raise exception 'Tenant domain hostname must be a normalized ASCII hostname.';
  end if;

  new.hostname := normalized;

  if exists (
    select 1
    from public.tenant_domains domain_row
    where domain_row.hostname = new.hostname
      and domain_row.tenant_id <> new.tenant_id
  ) then
    raise exception 'A hostname cannot belong to more than one tenant.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tenant_domains_normalize_hostname on public.tenant_domains;
create trigger trg_tenant_domains_normalize_hostname
  before insert or update of tenant_id, hostname on public.tenant_domains
  for each row execute function public.enforce_tenant_domain_hostname();

drop trigger if exists trg_tenant_domains_updated_at on public.tenant_domains;
create trigger trg_tenant_domains_updated_at
  before update on public.tenant_domains
  for each row execute function public.opps_invoicing_touch_updated_at();

alter table public.tenant_domains enable row level security;

drop policy if exists app_admin_manage_tenant_domains on public.tenant_domains;
create policy app_admin_manage_tenant_domains on public.tenant_domains
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- Public tracking will use this resolver in the next phase. It deliberately
-- exposes no tenant UUID, membership details, or other domain mappings.
create or replace function public.resolve_public_tracking_tenant(p_hostname text)
returns table (
  tenant_slug text,
  hostname text
)
language sql
security definer
stable
set search_path = public
as $$
  select tenant.slug, domain_row.hostname
  from public.tenant_domains domain_row
  join public.tenants tenant on tenant.id = domain_row.tenant_id
  where domain_row.hostname = public.normalize_tenant_hostname(p_hostname)
    and domain_row.surface = 'public_tracking'
    and domain_row.status = 'active'
    and tenant.status = 'active'
  limit 1;
$$;

-- XOS will use this resolver before protected host-scoped pages load. It is
-- membership-aware, so local storage and a host alone cannot grant access.
create or replace function public.resolve_authenticated_tenant_host(
  p_hostname text,
  p_surface text default 'xos_admin'
)
returns table (
  tenant_id uuid,
  tenant_slug text,
  tenant_name text,
  hostname text,
  surface text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    tenant.id,
    tenant.slug,
    tenant.name,
    domain_row.hostname,
    domain_row.surface
  from public.tenant_domains domain_row
  join public.tenants tenant on tenant.id = domain_row.tenant_id
  where auth.uid() is not null
    and domain_row.hostname = public.normalize_tenant_hostname(p_hostname)
    and domain_row.surface = lower(trim(coalesce(p_surface, '')))
    and domain_row.status = 'active'
    and tenant.status = 'active'
    and public.can_access_tenant(tenant.id)
  limit 1;
$$;

revoke all on function public.normalize_tenant_hostname(text) from public, anon, authenticated;
grant execute on function public.resolve_public_tracking_tenant(text) to anon, authenticated;
grant execute on function public.resolve_authenticated_tenant_host(text, text) to authenticated;
revoke execute on function public.resolve_authenticated_tenant_host(text, text) from anon;

insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at)
select tenant.id, seed.hostname, seed.surface, 'active', seed.is_primary, now()
from public.tenants tenant
cross join (
  values
    ('ops.jointx.co.za'::text, 'ops'::text, true),
    ('ops.jointx.co.za'::text, 'public_tracking'::text, true),
    ('xlab.jointx.co.za'::text, 'storefront'::text, true),
    ('xlab.jointx.co.za'::text, 'public_tracking'::text, false)
) as seed(hostname, surface, is_primary)
where tenant.slug = 'joint-x'
on conflict (hostname, surface) do update
set tenant_id = excluded.tenant_id,
    status = excluded.status,
    is_primary = excluded.is_primary,
    verified_at = coalesce(public.tenant_domains.verified_at, excluded.verified_at);
