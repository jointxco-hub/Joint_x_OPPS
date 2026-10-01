-- RBAC Remediation Slice 1 -- harden admin_set_workspace_member_role
-- against self-promotion / role-hierarchy abuse.
--
-- Builds on 20261001100000_opps_rbac_source_of_truth_restoration.sql
-- (that migration restores the function's CURRENT live body unchanged;
-- this one is the first actual behavior change). Current live full/body
-- hashes re-verified immediately before writing this migration:
--   full definition: c87cf5bb28a402eb08826fdd5ecde9ae
--   body only:       d264543fc3452bfc9b6eb50edfa1ff33
-- (identical to the hashes recorded in Phase 0 -- confirms no drift since
-- that restoration pass.)
--
-- Does NOT touch: wildcard permission rows, tenant_access_role_permissions,
-- Employee Hub RLS, frontend code, Orders behavior, any other role or
-- function. Signature, return type, language, SECURITY DEFINER status,
-- search_path, ACL, and every pre-existing check/behavior are unchanged --
-- the entire change is four new guard blocks inserted into the body,
-- clearly delimited below.
--
-- Product decisions, as explicitly confirmed (with one correction to the
-- first draft of this migration -- admin's ceiling was tightened before
-- any rehearsal ran):
--
-- 1. Granting 'owner' to anyone is app-admin-only, including when the
--    caller is themselves an owner. A tenant owner may manage admin and
--    everything below it, but may NOT create another owner through this
--    generic RPC -- ownership transfer/co-owner creation is a separate,
--    future, more deliberate workflow. CONFIRMED.
--
-- 2. A tenant admin's authority is strictly BELOW admin: an admin may
--    neither modify a target whose CURRENT role is 'owner' or 'admin',
--    nor assign 'owner' or 'admin' as a destination. A tenant owner has
--    no such ceiling against admin specifically -- an owner may modify an
--    existing admin (or anyone below) and may assign 'admin' as a
--    destination; the owner's only ceiling is the 'owner' role itself
--    (item 1). CONFIRMED, tightened from this migration's first draft,
--    which had incorrectly left admin-to-admin unrestricted and had
--    incorrectly allowed a plain owner to modify another owner directly.
--
-- 3. Self-role-change is blocked UNCONDITIONALLY, including for
--    is_app_admin() callers. CONFIRMED.
--
-- 4. Last-owner protection applies UNCONDITIONALLY, including for
--    is_app_admin() callers. CONFIRMED.
--
-- 5. A caller with no real owner/admin standing in the target tenant --
--    the only way this is reachable today is via joint-x's wildcard
--    granting 'staff.manage' to member/staff -- is rejected outright from
--    this RPC entirely, regardless of what has_tenant_permission() said.
--    Explicitly CONFIRMED as deliberate: "staff.manage alone does NOT
--    confer tenant-role mutation authority. The caller must still be: app
--    admin, tenant owner, tenant admin." This also means that if a FUTURE
--    tenant explicitly (not via wildcard) grants 'staff.manage' to some
--    other role, that role would still be rejected by this function until
--    this guard is deliberately revisited -- a known, accepted
--    forward-compatibility tradeoff of the conservative choice, not
--    something this slice needs to solve.

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

  if not public.has_tenant_permission(v_membership.tenant_id,'staff.manage')
     and not public.is_app_admin() then
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

-- ACL unchanged from live/Phase 0 -- re-asserted for reproducibility only
-- (CREATE OR REPLACE on an already-existing function does not alter
-- existing grants).
revoke all on function public.admin_set_workspace_member_role(uuid, text) from public;
grant execute on function public.admin_set_workspace_member_role(uuid, text) to authenticated, service_role;
