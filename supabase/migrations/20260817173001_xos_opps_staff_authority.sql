-- XOS 1: distinguish Joint X operational staff from external tenant members.
-- Additive only. This intentionally does not change tenant role values.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.is_opps_staff()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(exists (
    select 1
    from public.users u
    join public.tenant_memberships membership
      on membership.auth_user_id = u.auth_user_id
     and membership.status = 'active'
    join public.tenants tenant
      on tenant.id = membership.tenant_id
     and tenant.status = 'active'
     and tenant.slug = 'joint-x'
    where u.auth_user_id = auth.uid()
      and coalesce(u.is_active, true)
  ), false)
$$;

comment on function public.is_opps_staff() is
  'True only for an active public.users identity with an active membership in the active joint-x tenant. Tenant membership alone is not OPPS staff authority.';

revoke all on function public.is_opps_staff() from public, anon, authenticated, service_role;
grant execute on function public.is_opps_staff() to authenticated, service_role;

revoke execute on function public.current_user_tenant_ids() from public, anon;
revoke execute on function public.can_access_tenant(uuid) from public, anon;
revoke execute on function public.current_user_app_role() from public, anon;
revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.current_user_tenant_ids() to authenticated, service_role;
grant execute on function public.can_access_tenant(uuid) to authenticated, service_role;
grant execute on function public.current_user_app_role() to authenticated, service_role;
grant execute on function public.is_app_admin() to authenticated, service_role;
alter function public.current_user_tenant_ids() set search_path = pg_catalog, public;
alter function public.can_access_tenant(uuid) set search_path = pg_catalog, public;
alter function public.current_user_app_role() set search_path = pg_catalog, public;
alter function public.is_app_admin() set search_path = pg_catalog, public;

-- Future public-schema objects start closed. Each migration must grant only
-- the named API roles required by its contract.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

commit;
