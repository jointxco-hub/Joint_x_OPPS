-- RBAC Remediation Slice 2 -- harden staff.manage + employee.team.read/
-- employee.team.manage against joint-x's '*' wildcard, WITHOUT widening
-- any other tenant's current effective authorization.
--
-- Builds on Phase 0 (20261001100000) and Slice 1 (20261001110000), both
-- already live. Confirmed read-only against production before writing
-- this migration (2026-10-02):
--   - joint-x's ONLY permission rows are '*' for owner/admin/member/staff
--     (rank 10/20/50/50). No tenant, anywhere in production, has an
--     EXPLICIT (non-wildcard) grant of 'staff.manage', 'employee.team.read',
--     or 'employee.team.manage' to any role. The only rows that make these
--     keys resolve true today are the six '*' rows on joint-x and
--     quick-solution (owner/admin only on quick-solution).
--   - admin_list_workspace_roles(uuid) and admin_list_workspace_members(uuid)
--     are gated ONLY by has_tenant_permission(p_tenant_id,'staff.manage')
--     OR is_app_admin() -- no secondary guard. On joint-x this currently
--     lets member/staff successfully list every member's name/email/role
--     and every role's permission set, via the wildcard alone.
--   - admin_set_workspace_member_role(uuid,text) has the SAME first-gate
--     predicate, but Slice 1's hierarchy guard (unconditional, runs
--     immediately after) already rejects any caller whose own tenant_role
--     isn't 'owner'/'admin' before any mutation -- so this function does
--     NOT currently leak data or allow mutation to member/staff. This
--     migration tightens its first gate anyway, for consistency with the
--     other two RPCs; Slice 1's hierarchy guard block is NOT touched.
--   - employee.team.read / employee.team.manage gate exactly three tables
--     (confirmed via a full pg_policies scan, not assumed): public.qbrs,
--     public.user_roles, public.weekly_scores. Each already has a
--     self-row branch fully separate from the team-wide
--     has_tenant_permission(...) branch. No other table references
--     either permission key.
--   - FOUR other tenants (demo-xos, gsb, tenant-a-qa, tenant-b-qa) each
--     have an active owner/admin membership but ZERO rows in
--     tenant_access_role_permissions. A tenant-agnostic "owner/admin
--     always passes" helper would have newly granted them access they
--     do not have today -- an unintended widening outside joint-x,
--     rejected as a design (see prior turn). quick-solution's owner/admin
--     pass today via an explicit '*' row on quick-solution itself (NOT
--     joint-x's wildcard) -- that must keep working exactly as it does
--     today, through has_tenant_permission(), not through a hardcoded
--     tenant_role check.
--
-- HYBRID PRESERVATION MODEL (confirmed product decision): the new helper
-- is NOT tenant-agnostic. It hardcodes the owner/admin-only rule ONLY for
-- the tenant whose slug is literally 'joint-x' (the one tenant confirmed
-- to have the wildcard-driven exposure). Every other tenant's behavior
-- for these permission keys is preserved EXACTLY by delegating to the
-- existing public.has_tenant_permission(p_tenant_id, p_permission_key) --
-- unchanged, byte-for-byte, for every tenant except joint-x. The joint-x
-- '*' row is never consulted by this helper for joint-x (branch 2 below
-- short-circuits before has_tenant_permission/branch 3 is ever reached);
-- it is still consulted, unchanged, for every other tenant via branch 3.

-- ---------------------------------------------------------------------
-- New helper: public.has_high_trust_workspace_permission(uuid, text)
--
-- SECURITY DEFINER (matching has_tenant_permission/is_opps_staff/
-- is_opps_workspace_tenant's existing pattern) so correctness never
-- depends on the caller's own RLS visibility into tenant_memberships or
-- tenants. search_path pinned. Not granted to public/anon (matching the
-- ACL of the three RPCs it backs). No recursive call: it calls
-- public.has_tenant_permission() for the non-joint-x branch, but
-- has_tenant_permission() itself never calls back into this function.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_high_trust_workspace_permission(p_tenant_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$

  select case
    when public.is_app_admin() then true
    when (select t.slug from public.tenants t where t.id = p_tenant_id) = 'joint-x' then
      exists(
        select 1
        from public.tenant_memberships tm
        where tm.auth_user_id = auth.uid()
          and tm.tenant_id = p_tenant_id
          and tm.status = 'active'
          and tm.tenant_role in ('owner','admin')
      )
    else
      public.has_tenant_permission(p_tenant_id, p_permission_key)
  end;
$function$;

revoke all on function public.has_high_trust_workspace_permission(uuid, text) from public;
grant execute on function public.has_high_trust_workspace_permission(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- admin_list_workspace_roles(uuid) -- first gate hardened. Everything
-- else (the jsonb_agg query, search_path, ACL, signature) unchanged.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_workspace_roles(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

begin
  if not public.has_high_trust_workspace_permission(p_tenant_id, 'staff.manage') then
    raise exception using errcode='42501',
      message='Workspace staff management access is required.';
  end if;

  return (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'roleKey',r.role_key,
        'name',r.name,
        'description',r.description,
        'rank',r.rank,
        'permissions',coalesce((
          select jsonb_agg(p.permission_key order by p.permission_key)
          from public.tenant_access_role_permissions p
          where p.tenant_id=r.tenant_id
            and p.role_key=r.role_key
            and p.allowed=true
        ),'[]'::jsonb)
      )
      order by r.rank,r.name
    ),'[]'::jsonb)
    from public.tenant_access_roles r
    where r.tenant_id=p_tenant_id
      and r.is_active=true
  );
end
$function$;

revoke all on function public.admin_list_workspace_roles(uuid) from public;
grant execute on function public.admin_list_workspace_roles(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- admin_list_workspace_members(uuid) -- first gate hardened. Everything
-- else unchanged.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_workspace_members(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

begin
  if not public.has_high_trust_workspace_permission(p_tenant_id, 'staff.manage') then
    raise exception using errcode='42501',
      message='Workspace staff management access is required.';
  end if;

  return (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'membershipId',tm.id,
        'authUserId',tm.auth_user_id,
        'email',coalesce(au.email,u.user_email),
        'name',coalesce(
          u.preferred_name,
          u.full_name,
          split_part(coalesce(au.email,u.user_email,'Team member'),'@',1)
        ),
        'roleKey',tm.tenant_role,
        'roleName',coalesce(r.name,initcap(replace(tm.tenant_role,'_',' '))),
        'status',tm.status,
        'createdAt',tm.created_at
      )
      order by coalesce(u.preferred_name,u.full_name,au.email,u.user_email)
    ),'[]'::jsonb)
    from public.tenant_memberships tm
    left join auth.users au on au.id=tm.auth_user_id
    left join public.users u on u.auth_user_id=tm.auth_user_id
    left join public.tenant_access_roles r
      on r.tenant_id=tm.tenant_id
     and r.role_key=tm.tenant_role
    where tm.tenant_id=p_tenant_id
  );
end
$function$;

revoke all on function public.admin_list_workspace_members(uuid) from public;
grant execute on function public.admin_list_workspace_members(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- admin_set_workspace_member_role(uuid,text) -- ONLY the first gate
-- changes (same predicate swap as the two functions above). Slice 1's
-- entire guard block (self-role-change, owner/admin hierarchy ceiling,
-- last-owner protection) is byte-for-byte unchanged below, as is the
-- pre-existing role validation, last-staff.manage-holder protection,
-- the update, the audit insert, and the return value.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_workspace_member_role(p_membership_id uuid, p_role_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare
  v_membership public.tenant_memberships;
  v_old_role text;
  v_role public.tenant_access_roles;
  v_old_manage boolean := false;
  v_new_manage boolean := false;
  v_other_managers integer := 0;
  v_caller_is_app_admin boolean;
  v_caller_role text;
  v_other_owners integer := 0;
begin
  select * into v_membership
  from public.tenant_memberships tm
  where tm.id=p_membership_id
  for update;

  if v_membership.id is null then
    raise exception using errcode='22023',
      message='Workspace member was not found.';
  end if;

  if not public.has_high_trust_workspace_permission(v_membership.tenant_id, 'staff.manage') then
    raise exception using errcode='42501',
      message='Workspace staff management access is required.';
  end if;

  -- ======================================================================
  -- NEW GUARD BLOCK (Slice 1) -- everything in this block is new; nothing
  -- above or below it (other than the two new declarations above) is
  -- changed from the live/restored body.
  -- ======================================================================

  v_caller_is_app_admin := public.is_app_admin();

  select tm2.tenant_role into v_caller_role
  from public.tenant_memberships tm2
  where tm2.auth_user_id = auth.uid()
    and tm2.tenant_id = v_membership.tenant_id
    and tm2.status = 'active'
  limit 1;

  -- Guard 1: no self-role-change through this RPC, for anyone (see
  -- interpretive note 3 above).
  if v_membership.auth_user_id = auth.uid() then
    raise exception using errcode='42501',
      message='You cannot change your own workspace role.';
  end if;

  -- Guard 2: hierarchy enforcement for non-app-admin callers only.
  if not v_caller_is_app_admin then
    -- 2a. Caller must have real owner/admin standing in THIS tenant --
    -- rejects member/staff/any other role even if has_tenant_permission
    -- returned true for them via a wildcard (product decision 5).
    if v_caller_role is distinct from 'owner' and v_caller_role is distinct from 'admin' then
      raise exception using errcode='42501',
        message='Workspace role changes require owner or admin standing in this tenant.';
    end if;

    -- 2b. Only an app admin may touch anyone currently holding the owner
    -- role, or assign the owner role to anyone -- true for BOTH owner and
    -- admin callers (product decision 1: owner may manage admin and
    -- everything below, but may not create another owner or modify an
    -- existing one through this RPC).
    if v_membership.tenant_role = 'owner' then
      raise exception using errcode='42501',
        message='Only an app administrator can modify a workspace owner.';
    end if;
    if trim(p_role_key) = 'owner' then
      raise exception using errcode='42501',
        message='Only an app administrator can grant the owner role.';
    end if;

    -- 2c. A tenant admin's ceiling is strictly below admin: may not touch
    -- a target whose current role is 'admin', nor assign 'admin' as a
    -- destination. A tenant owner has no such ceiling against admin
    -- specifically (product decision 2).
    if v_caller_role = 'admin' then
      if v_membership.tenant_role = 'admin' then
        raise exception using errcode='42501',
          message='An admin may only modify roles below admin.';
      end if;
      if trim(p_role_key) = 'admin' then
        raise exception using errcode='42501',
          message='An admin may only assign roles below admin.';
      end if;
    end if;
  end if;

  -- ======================================================================
  -- END NEW GUARD BLOCK. Everything below, down to the last-owner check,
  -- is UNCHANGED from the live/restored body.
  -- ======================================================================

  select * into v_role
  from public.tenant_access_roles r
  where r.tenant_id=v_membership.tenant_id
    and r.role_key=trim(p_role_key)
    and r.is_active=true
  limit 1;

  if v_role.role_key is null then
    raise exception using errcode='22023',
      message='That workspace role is not available.';
  end if;

  v_old_role := v_membership.tenant_role;

  -- ======================================================================
  -- NEW GUARD 3 (Slice 1): last-owner protection. Placed here (after role
  -- validation, before the pre-existing last-staff.manage-holder check)
  -- so it fires with a clear, specific error before the generic manager-
  -- count check would otherwise apply. Unconditional, including for
  -- app-admin callers (see interpretive note 3 above).
  -- ======================================================================
  if v_old_role = 'owner' and v_role.role_key <> 'owner' then
    select count(*)::int into v_other_owners
    from public.tenant_memberships tm
    where tm.tenant_id = v_membership.tenant_id
      and tm.status = 'active'
      and tm.tenant_role = 'owner'
      and tm.id <> v_membership.id;

    if v_other_owners = 0 then
      raise exception using errcode='22023',
        message='A workspace must keep at least one owner.';
    end if;
  end if;

  -- ======================================================================
  -- Everything from here to the end is UNCHANGED from the live/restored
  -- body (the pre-existing last-staff.manage-holder protection, the
  -- update, the audit log insert, and the return value).
  -- ======================================================================

  select exists(
    select 1
    from public.tenant_access_role_permissions rp
    where rp.tenant_id=v_membership.tenant_id
      and rp.role_key=v_old_role
      and rp.allowed=true
      and rp.permission_key in ('*','staff.manage')
  ) into v_old_manage;

  select exists(
    select 1
    from public.tenant_access_role_permissions rp
    where rp.tenant_id=v_membership.tenant_id
      and rp.role_key=v_role.role_key
      and rp.allowed=true
      and rp.permission_key in ('*','staff.manage')
  ) into v_new_manage;

  if v_old_manage and not v_new_manage then
    select count(*)::int into v_other_managers
    from public.tenant_memberships tm
    where tm.tenant_id=v_membership.tenant_id
      and tm.status='active'
      and tm.id<>v_membership.id
      and exists(
        select 1
        from public.tenant_access_role_permissions rp
        where rp.tenant_id=tm.tenant_id
          and rp.role_key=tm.tenant_role
          and rp.allowed=true
          and rp.permission_key in ('*','staff.manage')
      );

    if v_other_managers=0 then
      raise exception using errcode='22023',
        message='A workspace must keep at least one owner or staff manager.';
    end if;
  end if;

  update public.tenant_memberships
  set tenant_role=v_role.role_key,
      updated_at=now()
  where id=v_membership.id;

  insert into public.tenant_access_audit_log(
    tenant_id,
    actor_auth_user_id,
    membership_id,
    action,
    previous_role,
    new_role,
    metadata
  )
  values(
    v_membership.tenant_id,
    auth.uid(),
    v_membership.id,
    'member_role_changed',
    v_old_role,
    v_role.role_key,
    jsonb_build_object('targetAuthUserId',v_membership.auth_user_id)
  );

  return jsonb_build_object(
    'ok',true,
    'membershipId',v_membership.id,
    'previousRole',v_old_role,
    'roleKey',v_role.role_key,
    'roleName',v_role.name
  );
end
$function$;

revoke all on function public.admin_set_workspace_member_role(uuid, text) from public;
grant execute on function public.admin_set_workspace_member_role(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Employee Hub RLS: replace the team-wide has_tenant_permission(...,
-- 'employee.team.read'/'employee.team.manage') branch on each of the
-- three affected tables with the new helper, passing the SAME
-- permission_key string through (so non-joint-x tenants' behavior is
-- preserved exactly via the helper's branch-3 delegation). The self-row
-- branch and the NULL-tenant app-admin branch are untouched on every
-- policy -- ALTER POLICY only changes the USING/WITH CHECK expression
-- given here, roles (all {authenticated}, confirmed live) are left as-is.
-- ---------------------------------------------------------------------

-- public.qbrs
ALTER POLICY opps_qbrs_read ON public.qbrs
  USING (
    ((auth_user_id = auth.uid()) AND (tenant_id IS NOT NULL) AND can_access_tenant(tenant_id))
    OR ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.read'))
    OR ((tenant_id IS NULL) AND is_app_admin())
  );

ALTER POLICY opps_qbrs_insert ON public.qbrs
  WITH CHECK (
    ((auth_user_id = auth.uid()) AND (tenant_id IS NOT NULL) AND can_access_tenant(tenant_id))
    OR ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.manage'))
  );

ALTER POLICY opps_qbrs_update ON public.qbrs
  USING (
    ((auth_user_id = auth.uid()) AND (tenant_id IS NOT NULL) AND can_access_tenant(tenant_id))
    OR ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.manage'))
    OR ((tenant_id IS NULL) AND is_app_admin())
  )
  WITH CHECK (
    ((auth_user_id = auth.uid()) AND (tenant_id IS NOT NULL) AND can_access_tenant(tenant_id))
    OR ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.manage'))
    OR ((tenant_id IS NULL) AND is_app_admin())
  );

ALTER POLICY opps_qbrs_delete ON public.qbrs
  USING (
    ((auth_user_id = auth.uid()) AND (tenant_id IS NOT NULL) AND can_access_tenant(tenant_id))
    OR ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.manage'))
    OR ((tenant_id IS NULL) AND is_app_admin())
  );

-- public.user_roles (no self-row INSERT/UPDATE/DELETE branch -- unchanged,
-- confirmed live; only the read policy has a self-row branch)
ALTER POLICY opps_user_roles_read ON public.user_roles
  USING (
    ((auth_user_id = auth.uid()) AND (tenant_id IS NOT NULL) AND can_access_tenant(tenant_id))
    OR ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.read'))
    OR ((tenant_id IS NULL) AND is_app_admin())
  );

ALTER POLICY opps_user_roles_insert ON public.user_roles
  WITH CHECK (
    (tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.manage')
  );

ALTER POLICY opps_user_roles_update ON public.user_roles
  USING (
    ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.manage'))
    OR ((tenant_id IS NULL) AND is_app_admin())
  )
  WITH CHECK (
    ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.manage'))
    OR ((tenant_id IS NULL) AND is_app_admin())
  );

ALTER POLICY opps_user_roles_delete ON public.user_roles
  USING (
    ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.manage'))
    OR ((tenant_id IS NULL) AND is_app_admin())
  );

-- public.weekly_scores
ALTER POLICY opps_weekly_scores_read ON public.weekly_scores
  USING (
    ((auth_user_id = auth.uid()) AND (tenant_id IS NOT NULL) AND can_access_tenant(tenant_id))
    OR ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.read'))
    OR ((tenant_id IS NULL) AND is_app_admin())
  );

ALTER POLICY opps_weekly_scores_insert ON public.weekly_scores
  WITH CHECK (
    ((auth_user_id = auth.uid()) AND (tenant_id IS NOT NULL) AND can_access_tenant(tenant_id))
    OR ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.manage'))
  );

ALTER POLICY opps_weekly_scores_update ON public.weekly_scores
  USING (
    ((auth_user_id = auth.uid()) AND (tenant_id IS NOT NULL) AND can_access_tenant(tenant_id))
    OR ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.manage'))
    OR ((tenant_id IS NULL) AND is_app_admin())
  )
  WITH CHECK (
    ((auth_user_id = auth.uid()) AND (tenant_id IS NOT NULL) AND can_access_tenant(tenant_id))
    OR ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.manage'))
    OR ((tenant_id IS NULL) AND is_app_admin())
  );

ALTER POLICY opps_weekly_scores_delete ON public.weekly_scores
  USING (
    ((auth_user_id = auth.uid()) AND (tenant_id IS NOT NULL) AND can_access_tenant(tenant_id))
    OR ((tenant_id IS NOT NULL) AND public.has_high_trust_workspace_permission(tenant_id, 'employee.team.manage'))
    OR ((tenant_id IS NULL) AND is_app_admin())
  );
