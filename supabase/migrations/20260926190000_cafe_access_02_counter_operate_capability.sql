-- CAFE-ACCESS-02: add the narrow capability `cafe.counter.operate` to the role-derived
-- tenant capability primitive introduced by CAFE-ACCESS-01 (20260924232724), and make the
-- primitive fail closed for a NULL capability.
--
-- `cafe.counter.operate` means exactly one thing:
--   the authenticated actor may perform staff-assisted Cafe counter operations for the
--   given tenant.
-- It is a separate capability with its own rule. It is NOT an alias of
-- `cafe.operations.manage`, and it does not imply, and is not implied by: app admin, OPPS
-- staff, product admin, finance, production management, storefront access or deployment.
--
-- Baseline, deliberately fail-closed and least-privilege: an ACTIVE owner or admin
-- membership of an ACTIVE tenant, exactly like cafe.operations.manage today. A plain
-- `member` is denied. The two capabilities are separate CASE arms so they can diverge
-- (for example counter access for plain members, or per-actor grants) by a later forward
-- migration without touching the other. Nothing else changes for cafe.operations.manage:
-- its arm is byte-for-byte the CAFE-ACCESS-01 rule.
--
-- Authorization comes ONLY from tenant membership in the given tenant:
--   * no app-admin bypass and no OPPS-staff bypass (as in CAFE-ACCESS-01);
--   * a membership in another tenant never counts;
--   * a suspended membership, or an inactive tenant, never counts;
--   * an unknown, mis-cased, padded or NULL capability name is denied.
--
-- FIX (found by reasoning about three-valued logic, proven by the CAFE-ACCESS-02 test): the
-- CAFE-ACCESS-01 body was `... AND p_capability = 'cafe.operations.manage' AND EXISTS(...)`.
-- For a NULL p_capability that expression is NULL, not false, and a guard written
-- `IF NOT public.has_tenant_capability(...) THEN RAISE ...` does not raise on NULL - it would
-- let the caller through. The result is now wrapped so it is always exactly true or false.
--
-- Guidance for future counter RPCs (not built here): resolve the Cafe tenant by slug, then
-- require this capability SERVER-SIDE before doing anything:
--   if not public.has_tenant_capability(v_tenant_id, 'cafe.counter.operate') then
--     raise exception using errcode = '42501', message = '...';
--   end if;
-- The primitive is tenant-scoped, not module-aware: it does not know whether a tenant runs
-- the Cafe, so a counter RPC must resolve the Cafe tenant itself (and, like the public
-- catalogue, require the quick_solution module to be enabled for it).
--
-- Function properties, ACL and the search_path are unchanged from CAFE-ACCESS-01:
-- SECURITY DEFINER, STABLE, set search_path = '', EXECUTE for authenticated only.

do $preflight$
begin
  if to_regprocedure('public.has_tenant_capability(uuid,text)') is null then
    raise exception
      'CAFE_ACCESS_02_MIGRATION_PRECONDITION: public.has_tenant_capability(uuid,text) (CAFE-ACCESS-01) does not exist';
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
              when 'cafe.counter.operate' then membership.tenant_role in ('owner', 'admin')
              else false
            end
    ),
    false
  );
$$;

comment on function public.has_tenant_capability(uuid, text) is
  'Role-derived tenant authorization primitive. Recognizes cafe.operations.manage and cafe.counter.operate, each for an active owner/admin membership of the given active tenant; anything else (unknown, padded, mis-cased or NULL capability, NULL tenant, no identity) is exactly false. No app-admin or OPPS-staff bypass. Explicit actor grants can be incorporated behind this contract later.';

-- CREATE OR REPLACE keeps the existing ACL; it is reasserted so this file states the contract.
revoke all on function public.has_tenant_capability(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.has_tenant_capability(uuid, text)
  to authenticated;
