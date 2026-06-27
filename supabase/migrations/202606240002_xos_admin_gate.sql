-- Phase 3 XOS host gate foundation.
-- Resolves a client-facing XOS admin host without exposing tenant details unless
-- the signed-in user has active membership in the resolved tenant.

create or replace function public.resolve_xos_admin_gate(p_hostname text)
returns table (
  allowed boolean,
  reason text,
  tenant_slug text,
  tenant_name text,
  hostname text
)
language sql
security definer
stable
set search_path = public
as $$
  with normalized as (
    select public.normalize_tenant_hostname(p_hostname) as hostname
  ),
  configured_host as (
    select domain_row.hostname
    from public.tenant_domains domain_row
    join public.tenants tenant on tenant.id = domain_row.tenant_id
    join normalized on normalized.hostname = domain_row.hostname
    where domain_row.surface = 'xos_admin'
      and domain_row.status = 'active'
      and tenant.status = 'active'
    limit 1
  ),
  authorized_host as (
    select tenant_slug, tenant_name, hostname
    from public.resolve_authenticated_tenant_host(p_hostname, 'xos_admin')
    limit 1
  )
  select
    authorized_host.tenant_slug is not null as allowed,
    case
      when configured_host.hostname is null then 'site_not_configured'
      when authorized_host.tenant_slug is not null then 'allowed'
      else 'access_denied'
    end as reason,
    authorized_host.tenant_slug,
    authorized_host.tenant_name,
    coalesce(authorized_host.hostname, configured_host.hostname, normalized.hostname) as hostname
  from normalized
  left join configured_host on true
  left join authorized_host on true;
$$;

grant execute on function public.resolve_xos_admin_gate(text) to anon, authenticated;
