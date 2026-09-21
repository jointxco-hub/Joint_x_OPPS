-- OPPS Access Control Phase 2A — safe team directory + tightened users
-- SELECT/INSERT/UPDATE/DELETE
--
-- Phase 1 (20260921150000) closed direct public.users WRITES to
-- can_manage_opps_user(auth_user_id) - true for app admins, and for a
-- tenant owner/admin acting on a user who shares an ACTIVE membership
-- with them in that tenant. Ordinary OPPS staff could still SELECT every
-- column of every user via the Phase 1 opps_users_read policy
-- (using (public.is_opps_staff())) - that's exactly what every
-- assignment picker (Tasks, Goals, Calendar, Orders, mentions, ...)
-- relies on today via dataClient.entities.User.list(), which runs
-- `select('*') from users` client-side. Phase 2A closes that read-side
-- gap without breaking those pickers, AND closes a privilege-escalation
-- gap found in Phase 1's write policies during Phase 2 review:
--
--   1. A new SECURITY DEFINER RPC, public.list_opps_team_directory(p_tenant_id),
--      returns only the display/assignment-relevant columns for users with
--      an ACTIVE membership in the requested tenant - never phone, bio,
--      skills, or raw timestamps. Assignment/directory screens call this
--      instead of reading the table directly. Unchanged from the first
--      cut of this migration.
--   2. Direct public.users SELECT is tightened to a user's own row, or
--      public.is_app_admin() - see point 4 below for why
--      can_manage_opps_user() is no longer used here either.
--   3. Direct public.users INSERT/UPDATE/DELETE are tightened to
--      public.is_app_admin() only, REPLACING Phase 1's
--      can_manage_opps_user()-based policies (Phase 1's own migration file
--      is left untouched - this is a Phase 2A policy replacement, not an
--      edit to Phase 1's file).
--
-- ── Why can_manage_opps_user() had to be removed from every direct
--    public.users write/read-all path (found during Phase 2 review) ──
-- public.users.role is a GLOBAL, privilege-bearing field:
-- public.is_app_admin() -> public.current_user_app_role() reads it
-- directly (`select role from public.users where auth_user_id = auth.uid()`)
-- and treats role = 'admin' as global app-admin authority. Phase 1's
-- can_manage_opps_user() grants a TENANT owner/admin authority to
-- directly UPDATE another user's ENTIRE row - including that global
-- `role` column - for anyone sharing an active membership with them in
-- that tenant. RLS is row-based, not column-based, so that predicate
-- could not be scoped to "manage tenant membership, but not the global
-- role column": a tenant owner/admin could set a shared-tenant member's
-- role to 'admin' and grant them (or, via can_manage_opps_user()'s
-- actor/target self-match, THEMSELVES) global app-admin authority. Tenant
-- role management belongs in tenant_memberships / workspace role RPCs,
-- which only ever touch tenant_role, never public.users.role - it must
-- never be reachable through a direct table policy on public.users. A
-- tenant owner/admin must not gain direct mutation authority over global
-- user rows; only public.is_app_admin() may write directly to
-- public.users now. can_manage_opps_user() itself is left unchanged in
-- this pass, since other code may still depend on it for narrower,
-- non-public.users purposes - it is simply no longer used as a gate on
-- this table.
--
-- Email is intentionally still returned by the RPC (as `email`, sourced
-- from users.user_email). Legacy assignment fields across this codebase
-- (task/goal/calendar assignees, mention targets) currently store a
-- user's EMAIL as the assignment key, not auth_user_id - removing email
-- here would silently break every existing assignment relationship.
-- Phase 2B is the planned migration of assignment storage to
-- auth_user_id, at which point this RPC's email field can be dropped.
--
-- RPC authorization mirrors Phase 1: use the existing is_opps_staff() /
-- tenant-membership / is_app_admin() mechanisms, not a new authority
-- model. Direct-table authorization (SELECT own row aside) is now
-- is_app_admin() only, for the reason above.

begin;

create or replace function public.list_opps_team_directory(p_tenant_id uuid)
returns table (
  id uuid,
  auth_user_id uuid,
  email text,
  full_name text,
  preferred_name text,
  avatar_url text,
  department text,
  role text,
  is_active boolean,
  tenant_role text,
  role_name text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_tenant_id is null then
    raise exception using errcode = '22023', message = 'Tenant is required.';
  end if;

  -- App admins may view any active tenant's directory. Everyone else must
  -- both qualify for OPPS access at all (is_opps_staff() - the same gate
  -- Phase 1 already relies on) AND hold an ACTIVE membership in THIS
  -- specific tenant - staff status alone does not imply access to every
  -- tenant's directory.
  if not public.is_app_admin() then
    if not public.is_opps_staff() then
      raise exception using errcode = '42501', message = 'OPPS access is required.';
    end if;

    if not exists (
      select 1
      from public.tenant_memberships m
      where m.auth_user_id = auth.uid()
        and m.tenant_id = p_tenant_id
        and m.status = 'active'
    ) then
      raise exception using errcode = '42501', message = 'You do not have access to this tenant.';
    end if;
  end if;

  if not exists (
    select 1 from public.tenants t
    where t.id = p_tenant_id and t.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'Tenant was not found.';
  end if;

  return query
  select
    u.id,
    u.auth_user_id,
    u.user_email as email,
    u.full_name,
    u.preferred_name,
    u.avatar_url,
    u.department,
    u.role,
    u.is_active,
    m.tenant_role,
    tar.name as role_name
  from public.users u
  join public.tenant_memberships m
    on m.auth_user_id = u.auth_user_id
   and m.tenant_id = p_tenant_id
   and m.status = 'active'
  left join public.tenant_access_roles tar
    on tar.tenant_id = m.tenant_id
   and tar.role_key = m.tenant_role
   and tar.is_active = true
  order by u.full_name;
end;
$$;

revoke all on function public.list_opps_team_directory(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.list_opps_team_directory(uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- Tighten direct public.users SELECT. Was (Phase 1): using
-- (public.is_opps_staff()) - any OPPS-qualified identity could read
-- every column of every user. This migration's first cut then changed it
-- to auth_user_id = auth.uid() OR can_manage_opps_user(auth_user_id) -
-- but can_manage_opps_user() is a TENANT-scoped predicate being used to
-- gate a GLOBAL row (see header comment), so it's removed from here too:
-- a tenant owner/admin has no legitimate reason to read another user's
-- complete row (email, department, role, ...) through this table - the
-- tenant-scoped, column-limited list_opps_team_directory() RPC above is
-- the correct read path for tenant/team purposes. Direct SELECT is now:
-- a user's own row, or public.is_app_admin(). Assignment/directory UI
-- must use list_opps_team_directory() instead of direct SELECT either way.
-- ---------------------------------------------------------------------
drop policy if exists opps_users_read on public.users;

create policy opps_users_read
on public.users
for select
to authenticated
using (
  auth_user_id = auth.uid()
  or public.is_app_admin()
);

-- ---------------------------------------------------------------------
-- Replace Phase 1's direct public.users INSERT/UPDATE/DELETE policies
-- (defined in 20260921150000_opps_user_write_boundary.sql, left
-- untouched - this is a Phase 2A policy replacement, not an edit to that
-- file). Phase 1 gated these on can_manage_opps_user(auth_user_id),
-- which returns true for a tenant owner/admin sharing an active
-- membership with the target - including, via that predicate's own
-- actor/target matching, the caller's OWN membership row. Because RLS is
-- row-based, that granted UPDATE authority over the target's ENTIRE row,
-- including the GLOBAL, privilege-bearing public.users.role column that
-- public.is_app_admin() trusts - letting a tenant owner/admin grant
-- themselves or another shared-tenant member global app-admin authority
-- by setting role = 'admin'. Tenant role management belongs in
-- tenant_memberships / workspace role RPCs (which only ever touch
-- tenant_role, never public.users.role); a tenant owner/admin must not
-- gain direct mutation authority over global user rows through this
-- table. Direct INSERT/UPDATE/DELETE on public.users are therefore
-- public.is_app_admin()-only now. can_manage_opps_user() itself is left
-- unchanged - other code may still depend on it - it is simply no longer
-- used as a gate on this table.
-- ---------------------------------------------------------------------
drop policy if exists opps_users_insert on public.users;
drop policy if exists opps_users_update on public.users;
drop policy if exists opps_users_delete on public.users;

create policy opps_users_insert
on public.users
for insert
to authenticated
with check (public.is_app_admin());

create policy opps_users_update
on public.users
for update
to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

create policy opps_users_delete
on public.users
for delete
to authenticated
using (public.is_app_admin());

commit;
