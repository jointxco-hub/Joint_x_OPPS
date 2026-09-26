-- CAFE-ACCESS-04: let an active `counter_staff` membership hold `cafe.counter.operate`.
--
-- Why: the real Cafe workspace already uses the tenant role `counter_staff` for the people who work the
-- counter (public.tenant_memberships.tenant_role admits owner, admin, member, staff, manager, counter_staff,
-- production_staff, finance and partner_viewer). CAFE-ACCESS-03 made plain `member` a counter operator but
-- left `counter_staff` out, so a real counter member could not use the counter.
--
--   active owner         -> cafe.counter.operate + cafe.operations.manage   (unchanged)
--   active admin         -> cafe.counter.operate + cafe.operations.manage   (unchanged)
--   active member        -> cafe.counter.operate                            (unchanged)
--   active counter_staff -> cafe.counter.operate                            (NEW)
--   every other role     -> neither capability                              (unchanged)
--
-- cafe.operations.manage is NOT broadened: its arm is byte-for-byte the CAFE-ACCESS-01/03 rule (active
-- owner or admin). counter_staff can operate the counter (create, pay, read) but cannot cancel an order,
-- review cancellations or list handoffs. Nothing else changes: authority comes only from a membership in
-- THE asked tenant, which must be active, in an active tenant; no app-admin bypass, no OPPS-staff bypass;
-- a suspended membership, an inactive or archived tenant, another tenant's membership, an unknown / padded /
-- mis-cased / NULL capability and a NULL tenant are all exactly false (never NULL).
--
-- This is a forward CREATE OR REPLACE of the primitive; CAFE-ACCESS-01, -02 and -03 are not edited. The
-- properties and ACL are unchanged: SECURITY DEFINER, STABLE, set search_path = '', EXECUTE for
-- authenticated only. It is ordered after CAFE-ACCESS-03 and before the Cafe counter migrations.

do $preflight$
begin
  if to_regprocedure('public.has_tenant_capability(uuid,text)') is null then
    raise exception
      'CAFE_ACCESS_04_MIGRATION_PRECONDITION: public.has_tenant_capability(uuid,text) (CAFE-ACCESS-01..03) does not exist';
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
              when 'cafe.counter.operate' then membership.tenant_role in ('owner', 'admin', 'member', 'counter_staff')
              else false
            end
    ),
    false
  );
$$;

comment on function public.has_tenant_capability(uuid, text) is
  'Role-derived tenant authorization primitive. cafe.operations.manage: active owner/admin membership of the given active tenant. cafe.counter.operate: any active owner/admin/member/counter_staff membership of it. Any other role, a suspended membership, an inactive tenant, another tenant, an unknown or NULL capability or a NULL tenant is exactly false. No app-admin or OPPS-staff bypass.';

-- CREATE OR REPLACE keeps the existing ACL; it is reasserted so this file states the contract.
revoke all on function public.has_tenant_capability(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.has_tenant_capability(uuid, text)
  to authenticated;
