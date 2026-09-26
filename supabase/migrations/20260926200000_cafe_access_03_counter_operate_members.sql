-- CAFE-ACCESS-03: let plain ACTIVE Cafe members hold `cafe.counter.operate`.
--
-- Decision (confirmed by the business owner): counter staff are ordinary tenant
-- members, so the counter capability must not require an admin role. The two
-- capabilities stay separate and the separation is the point:
--
--   active member -> cafe.counter.operate
--   active admin  -> cafe.counter.operate + cafe.operations.manage
--   active owner  -> cafe.counter.operate + cafe.operations.manage
--
-- cafe.operations.manage is NOT broadened: its rule is byte-for-byte the CAFE-ACCESS-01
-- rule (active owner or admin), so a member still cannot list handoffs. Holding
-- cafe.counter.operate does not imply, and grants nothing towards: product or pricing
-- administration, finance, tenant administration, user or role administration, general
-- OPPS access, or app-admin behavior. Those are governed elsewhere; this function only
-- answers "may this actor operate the counter of this tenant".
--
-- Everything fail-closed is unchanged and re-proven by the CAFE-ACCESS SQL tests:
-- authority comes only from a membership in THE asked tenant; it must be active, in an
-- active tenant; no app-admin bypass, no OPPS-staff bypass (an app admin or OPPS staff
-- member WITHOUT a Cafe membership is denied); a suspended membership, an inactive or
-- archived tenant, another tenant's membership, an unknown / padded / mis-cased / NULL
-- capability and a NULL tenant are all exactly false (never NULL).
--
-- This migration is the smallest change: only the counter arm's role list changes, in a
-- forward CREATE OR REPLACE of the primitive. CAFE-ACCESS-01 and CAFE-ACCESS-02 are not
-- edited. The properties and ACL are unchanged: SECURITY DEFINER, STABLE,
-- set search_path = '', EXECUTE for authenticated only.

do $preflight$
begin
  if to_regprocedure('public.has_tenant_capability(uuid,text)') is null then
    raise exception
      'CAFE_ACCESS_03_MIGRATION_PRECONDITION: public.has_tenant_capability(uuid,text) (CAFE-ACCESS-01/02) does not exist';
  end if;
end
$preflight$;

create or replace function public.has_tenant_capability(
  p_tenant_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and p_tenant_id is not null
    and p_capability in ('cafe.operations.manage', 'cafe.counter.operate')
    and exists (
      select 1
      from public.tenant_memberships membership
      join public.tenants tenant
        on tenant.id = membership.tenant_id
       and tenant.status = 'active'
      where membership.tenant_id = p_tenant_id
        and membership.auth_user_id = auth.uid()
        and membership.status = 'active'
        and case p_capability
              when 'cafe.operations.manage' then membership.tenant_role in ('owner', 'admin')
              when 'cafe.counter.operate' then membership.tenant_role in ('owner', 'admin', 'member')
              else false
            end
    ),
    false
  );
$$;

comment on function public.has_tenant_capability(uuid, text) is
  'Role-derived tenant authorization primitive. cafe.operations.manage: active owner/admin membership of the given active tenant. cafe.counter.operate: any active owner/admin/member membership of it. Anything else (unknown, padded, mis-cased or NULL capability, NULL tenant, no identity, another tenant, suspended membership, inactive tenant) is exactly false. No app-admin or OPPS-staff bypass. Explicit actor grants can be incorporated behind this contract later.';

-- CREATE OR REPLACE keeps the existing ACL; it is reasserted so this file states the contract.
revoke all on function public.has_tenant_capability(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.has_tenant_capability(uuid, text)
  to authenticated;
