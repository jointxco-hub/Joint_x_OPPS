-- RBAC Remediation Phase 0 -- Source-of-truth restoration.
--
-- Purely additive/documentary. NO BEHAVIOR CHANGE. This migration restores
-- six live production authorization functions into tracked migration
-- history, byte-for-byte as captured directly from pg_proc (signature/
-- attributes from pg_get_functiondef(), body text from raw prosrc -- see
-- the hash-parity note below for why body text specifically comes from
-- prosrc, not pg_get_functiondef's rendering of it) against production
-- (project slhcvyeuqsduaglddqdb) on 2026-10-01. See
-- docs/OPPS_PERMISSION_MODEL_SOURCE_OF_TRUTH_RESTORATION_2026-09-27.md
-- (updated 2026-10-01) for the full verification record this migration
-- implements -- live hashes, ACL, the three newly-discovered admin_*
-- functions, full table structure for tenant_access_roles/
-- tenant_access_role_permissions, and the hash-parity proof.
--
-- CREATE OR REPLACE on an already-existing live function does not alter its
-- existing grants -- the GRANT statements below are included only so this
-- migration is correct and reproducible if ever run against a database
-- where these functions do not yet exist (this schema has
-- `alter default privileges ... revoke execute on functions from public,
-- anon` in effect -- see 20260817173001_xos_opps_staff_authority.sql --
-- so a freshly-created function here would otherwise get NO public/anon
-- execute by default). Every GRANT below mirrors the live ACL exactly, as
-- verified in the companion doc.
--
-- Not restored in this migration: public.user_finance_level() -- already
-- correctly tracked, body-identical, in
-- 20260523_finance_rls_tighten.sql:90-114 (verified in this pass; the
-- prior audit's claim that it was untracked was incorrect).
--
-- Hash-parity note: pg_get_functiondef()'s rendered body is NOT byte-
-- identical to the raw prosrc catalog value it's generated from -- it
-- silently drops a single leading newline that prosrc preserves verbatim
-- (confirmed empirically: extracting the body region straight out of
-- pg_get_functiondef() output and hashing it does NOT reproduce the live
-- body/prosrc md5 below; inserting that one leading blank line after each
-- `AS $function$` line below does). Every function body below is therefore
-- built from raw prosrc (queried directly, bypassing pg_get_functiondef's
-- body rendering), not from the pg_get_functiondef string itself, and has
-- been verified byte-for-byte (via local md5, not a live round-trip) to
-- match the live body hash listed above each function.
--
-- Not restored in this migration (deliberately out of scope for Phase 0):
-- public.tenant_access_roles / public.tenant_access_role_permissions table
-- definitions -- documented instead of emitted as DDL, per the "prefer
-- documentation-only restoration for table definitions if emitting DDL
-- could create any risk" instruction for this phase. Both tables already
-- exist live with FKs, composite PKs, RLS, policies and triggers in place;
-- see the companion doc for their full captured structure.

-- ---------------------------------------------------------------------
-- 1. public.has_tenant_permission(uuid, text)
-- Live hash (full definition): b7c9df19f951ebc4749d4aa036760106
-- Live hash (body only):       138d1867582099cb9580e43ee5e415ae
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_tenant_permission(p_tenant_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$

  select coalesce(exists(
    select 1
    from public.tenant_memberships tm
    join public.tenants t
      on t.id=tm.tenant_id
     and t.status='active'
    left join public.users u
      on u.auth_user_id=tm.auth_user_id
    where tm.auth_user_id=auth.uid()
      and tm.tenant_id=p_tenant_id
      and tm.status='active'
      and coalesce(u.is_active,true)
      and (
        public.is_app_admin()
        or exists(
          select 1
          from public.tenant_access_role_permissions rp
          join public.tenant_access_roles ar
            on ar.tenant_id=rp.tenant_id
           and ar.role_key=rp.role_key
           and ar.is_active=true
          where rp.tenant_id=tm.tenant_id
            and rp.role_key=tm.tenant_role
            and rp.allowed=true
            and rp.permission_key in ('*',p_permission_key)
        )
      )
  ),false);
$function$;

-- Live ACL: {=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- i.e. PUBLIC has EXECUTE (which anon inherits), plus authenticated/service_role explicitly.
revoke all on function public.has_tenant_permission(uuid, text) from public;
grant execute on function public.has_tenant_permission(uuid, text) to public;
grant execute on function public.has_tenant_permission(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. public.is_opps_staff()
-- Live hash (full definition): 4d0a70c336188670017c33dec9ec0fd2
-- Live hash (body only):       2767717a6fd60a202ba30343438e6f4e
--
-- NOTE: an older, materially different version of this function was
-- previously tracked (e.g. commit ba53023, "feat(quotes Q1): canonical
-- quote schema") -- that version checked only joint-x membership, with no
-- is_app_admin() bypass and no third opps_workspace-tenant branch. The
-- live body below has since evolved past that committed version via an
-- untracked path; this restoration captures the CURRENT live body, not
-- the historical one. Confirmed via targeted search across all branches/
-- history for this body's distinguishing marker
-- (`is_opps_workspace_tenant(tm.tenant_id)`), which returned zero hits
-- anywhere prior to this migration.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_opps_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$

  select coalesce(
    public.is_app_admin()
    or exists(
      select 1
      from public.users u
      join public.tenant_memberships tm
        on tm.auth_user_id=u.auth_user_id
       and tm.status='active'
      join public.tenants t
        on t.id=tm.tenant_id
       and t.status='active'
       and t.slug='joint-x'
      where u.auth_user_id=auth.uid()
        and coalesce(u.is_active,true)
    )
    or exists(
      select 1
      from public.tenant_memberships tm
      join public.tenants t
        on t.id=tm.tenant_id
       and t.status='active'
      where tm.auth_user_id=auth.uid()
        and tm.status='active'
        and public.is_opps_workspace_tenant(tm.tenant_id)
        and public.has_tenant_permission(tm.tenant_id,'opps.access')
    ),
    false
  );
$function$;

-- Live ACL: {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- i.e. NOT granted to public/anon.
revoke all on function public.is_opps_staff() from public;
grant execute on function public.is_opps_staff() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. public.is_opps_workspace_tenant(uuid)
-- Live hash (full definition): d4eeb5e828f923a5e56ba465bfca0eab
-- Live hash (body only):       0edde73cde7c0d15c452bf6e82a75f84
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_opps_workspace_tenant(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$

  select coalesce(exists(
    select 1
    from public.tenant_capabilities tc
    join public.tenants t on t.id=tc.tenant_id
    where tc.tenant_id=p_tenant_id
      and tc.capability_key='opps_workspace'
      and tc.enabled=true
      and t.status='active'
  ),false);
$function$;

-- Live ACL: {=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- i.e. PUBLIC has EXECUTE (which anon inherits), plus authenticated/service_role explicitly.
revoke all on function public.is_opps_workspace_tenant(uuid) from public;
grant execute on function public.is_opps_workspace_tenant(uuid) to public;
grant execute on function public.is_opps_workspace_tenant(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. public.admin_list_workspace_members(uuid)
-- Live hash (full definition): 6ad42b6911ad9f762bb8cb645a99c584
-- Live hash (body only):       9c536d030f06b5c1948a6ca0ed237881
--
-- NOTE: gates on has_tenant_permission(p_tenant_id, 'staff.manage') OR
-- is_app_admin() -- 'staff.manage' is a permission_key not previously
-- identified in the has_tenant_permission usage inventory, since this
-- function itself was untracked. It inherits the same joint-x wildcard
-- exposure as every other permission_key checked via has_tenant_permission
-- for any role holding a '*' row there.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_workspace_members(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

begin
  if not public.has_tenant_permission(p_tenant_id,'staff.manage')
     and not public.is_app_admin() then
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

-- Live ACL: {postgres=X/postgres, service_role=X/postgres, authenticated=X/postgres}
-- i.e. NOT granted to public/anon.
revoke all on function public.admin_list_workspace_members(uuid) from public;
grant execute on function public.admin_list_workspace_members(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. public.admin_list_workspace_roles(uuid)
-- Live hash (full definition): aec5b5daaffa08049b59f4415f870b2d
-- Live hash (body only):       14cbca95db2fd8e0cbc0f0d6241d5338
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_workspace_roles(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

begin
  if not public.has_tenant_permission(p_tenant_id,'staff.manage')
     and not public.is_app_admin() then
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

-- Live ACL: {postgres=X/postgres, service_role=X/postgres, authenticated=X/postgres}
-- i.e. NOT granted to public/anon.
revoke all on function public.admin_list_workspace_roles(uuid) from public;
grant execute on function public.admin_list_workspace_roles(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. public.admin_set_workspace_member_role(uuid, text)
-- Live hash (full definition): c87cf5bb28a402eb08826fdd5ecde9ae
-- Live hash (body only):       d264543fc3452bfc9b6eb50edfa1ff33
--
-- NOTE: this is the mutating member of the three admin_* functions --
-- VOLATILE (the default; not STABLE like the other five), and the only
-- one of the six that writes anything. It writes two places:
-- public.tenant_memberships.tenant_role (the actual role change) and
-- public.tenant_access_audit_log (an audit-trail insert) -- the latter
-- table was not previously known to exist in the prior audit's "audit
-- trail: unknown" finding for tenant-role changes; it is now confirmed to
-- exist and to be written on every role change via this function. Its own
-- structure is not captured in this Phase 0 pass (out of the stated
-- 2-table scope) -- flagged as a candidate for a future restoration pass.
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

-- Live ACL: {postgres=X/postgres, service_role=X/postgres, authenticated=X/postgres}
-- i.e. NOT granted to public/anon.
revoke all on function public.admin_set_workspace_member_role(uuid, text) from public;
grant execute on function public.admin_set_workspace_member_role(uuid, text) to authenticated, service_role;
