-- OPPS Access Control Phase 1
-- Stop ordinary OPPS users from mutating public.users profiles, including
-- their own.
--
-- This is intentionally a narrow first security boundary:
--   * OPPS staff can keep reading the directory for existing assignment flows.
--   * direct writes (insert/update/delete) are management-only: app admins,
--     or a tenant owner/admin acting on a user who shares an ACTIVE
--     membership with them in that tenant.
--   * there is no self-write exception - RLS is row-based, not column-based,
--     so a generic "user may write their own row" policy would let a signed-
--     in person change any column on that row, including sensitive fields
--     such as role or active state, if ever exposed through the API. Self
--     profile editing, if needed, must go through a dedicated RPC that
--     allow-lists which columns a user may change about themselves - not a
--     blanket row-level write policy.
--   * ordinary member/staff/counter/production/finance/viewer roles cannot
--     insert/update/delete another user's profile.
--
-- Phase 2 should replace broad users SELECT with a safe tenant-directory RPC
-- returning display-only fields, so email/phone/private profile fields are
-- not exposed merely to support assignee pickers.

begin;

create or replace function public.can_manage_opps_user(p_target_auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'pg_catalog','public'
as $$
  select coalesce(
    public.is_app_admin()
    or (
      p_target_auth_user_id is not null
      and exists (
        select 1
        from public.tenant_memberships actor
        join public.tenant_memberships target
          on target.tenant_id = actor.tenant_id
         and target.auth_user_id = p_target_auth_user_id
         and target.status = 'active'
        join public.tenants t
          on t.id = actor.tenant_id
         and t.status = 'active'
        where actor.auth_user_id = auth.uid()
          and actor.status = 'active'
          and actor.tenant_role in ('owner','admin')
      )
    ),
    false
  );
$$;

revoke all on function public.can_manage_opps_user(uuid) from public;
grant execute on function public.can_manage_opps_user(uuid) to authenticated;

alter table public.users enable row level security;

drop policy if exists xos1_opps_staff_only on public.users;
drop policy if exists opps_users_read on public.users;
drop policy if exists opps_users_insert on public.users;
drop policy if exists opps_users_update on public.users;
drop policy if exists opps_users_delete on public.users;

-- Preserve current read behavior temporarily so task/order assignment screens
-- do not break during Phase 1.
create policy opps_users_read
on public.users
for select
to authenticated
using (public.is_opps_staff());

-- Direct writes are management-only: app admin, or a tenant owner/admin
-- acting on a user who shares an ACTIVE membership with them in that
-- tenant. No self-write exception - see header comment for why.
create policy opps_users_insert
on public.users
for insert
to authenticated
with check (
  public.can_manage_opps_user(auth_user_id)
);

create policy opps_users_update
on public.users
for update
to authenticated
using (
  public.can_manage_opps_user(auth_user_id)
)
with check (
  public.can_manage_opps_user(auth_user_id)
);

create policy opps_users_delete
on public.users
for delete
to authenticated
using (public.can_manage_opps_user(auth_user_id));

commit;
