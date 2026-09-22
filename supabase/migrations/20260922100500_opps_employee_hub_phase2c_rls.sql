-- OPPS Employee Hub Phase 2C — tenant-aware RLS for user_roles, qbrs,
-- weekly_scores.
--
-- Replaces the single broad policy these three tables have carried since
-- 20260817173002_xos_table_api_perimeter.sql:
--
--   create policy xos1_opps_staff_only on public.<table>
--     for all to authenticated
--     using (public.is_opps_staff()) with check (public.is_opps_staff());
--
-- i.e. every active OPPS staff member could read/write EVERY row of every
-- employee's operational role, QBR, and weekly score — no row-owner or
-- tenant-row scoping at all. This migration follows the same per-action
-- policy split Phase 1 used for public.users
-- (20260921150000_opps_user_write_boundary.sql): a table's SELECT can be
-- broader than its INSERT/UPDATE/DELETE, which "for all"/one shared
-- policy can't express.
--
-- This is the SECOND draft of this migration (never applied to any
-- database — edited in place, not layered, since nothing had been
-- deployed yet). The first draft is superseded by two corrections below.
--
-- ── Authorization model ────────────────────────────────────────────────
-- Reuses the tenant_access_roles / tenant_access_role_permissions /
-- has_tenant_permission(tenant_id, permission_key) system already used
-- elsewhere in this codebase — no parallel authorization system is
-- introduced. New permission keys follow the existing '<domain>.<action>'
-- naming convention seen on live data (orders.read, tasks.write, etc.):
--   employee.team.read    — view another tenant member's role/QBR/score
--   employee.team.manage  — assign roles, correct another member's QBR/score
--
-- ── Correction 1: self-access on qbrs/weekly_scores now requires ACTIVE
--    tenant membership, not just row ownership ─────────────────────────
-- The first draft authorized self-access on qbrs/weekly_scores by
-- `auth_user_id = auth.uid()` alone. That's insufficient: a row can have
-- auth_user_id set (from the identity migration's backfill) while its
-- tenant_id is stale or the person's membership in that tenant has since
-- gone inactive (left the tenant, suspended, etc.) — auth_user_id = X
-- says "this row is about me", it does NOT say "I still belong to the
-- tenant this row lives in". Fixed: self read/write on qbrs/weekly_scores
-- now requires
--   auth_user_id = auth.uid() and tenant_id is not null
--   and public.can_access_tenant(tenant_id)
-- for SELECT, INSERT, UPDATE, and DELETE alike. user_roles' self-read
-- keeps plain `auth_user_id = auth.uid()` (unchanged, out of this
-- correction's stated scope) — see the "known asymmetry" note below.
--
-- ── Correction 2: unresolved (tenant_id is null) legacy rows are now
--    is_app_admin()-only, and are NEVER insertable ─────────────────────
-- The first draft fell back to `tenant_id is null and is_opps_staff()`
-- for legacy rows not yet resolved to a tenant — that's every active
-- OPPS staff member, far broader than reconciliation needs. Fixed:
--   * SELECT/UPDATE/DELETE on a tenant_id-null row: is_app_admin() only
--     (the same admin check used to lock down public.users in Phase 1/2A
--     — founder-level, not "any manager"). Rows stay recoverable (an
--     admin can still see and fix them); ordinary staff can no longer
--     read OR write anyone else's still-unresolved employee data.
--   * INSERT: the tenant_id-null branch is REMOVED ENTIRELY, including
--     for is_app_admin(). Every insert now requires tenant_id is not
--     null under either self or team.manage authorization. Reasoning:
--     there is no legitimate "insert a brand new row with an unknown
--     tenant" case — reconciliation fixes an EXISTING unresolved row via
--     UPDATE (backfilling its tenant_id), it does not need to create new
--     ones. Allowing ordinary staff to insert tenant-null rows would
--     just manufacture more unresolved data for admins to clean up.
--
-- ── Correction 3 (this round): user_roles self-read is now tenant-aware
--    too, closing the asymmetry flagged (and deliberately left open) in
--    the previous round ─────────────────────────────────────────────────
-- user_roles' SELECT policy previously authorized self-access by
-- `auth_user_id = auth.uid()` alone, unlike qbrs/weekly_scores above.
-- Same gap: a row can have auth_user_id set while its tenant_id is stale
-- or the person's membership in that tenant has since gone inactive.
-- Fixed to the same rule as qbrs/weekly_scores' self branches:
--   auth_user_id = auth.uid() and tenant_id is not null
--   and public.can_access_tenant(tenant_id)
-- user_roles still has no self-WRITE branch (role assignment remains
-- team.manage-only) - this only changes what a stale/foreign-tenant row
-- lets its own auth_user_id owner READ.
--
-- ── Known, disclosed limitation (not fixed by this migration) ──────────
-- Read directly from the linked staging project before writing this:
-- EVERY active joint-x tenant_access_role (owner, admin, member, staff)
-- currently holds a wildcard permission_key = '*' grant in
-- tenant_access_role_permissions. has_tenant_permission() treats '*' as
-- "matches any permission_key", so today employee.team.read/manage will
-- pass for every active joint-x member — not just owner/admin. This
-- migration does NOT narrow those pre-existing wildcard grants: doing so
-- would tighten authorization for every OTHER permission key (orders.*,
-- finance.*, tasks.*, ...) those roles already rely on across the whole
-- platform — a deliberate, cross-cutting decision for the tenant owner
-- to make separately, not something an Employee Hub migration should do
-- as a side effect.

begin;

alter table public.user_roles enable row level security;
alter table public.qbrs enable row level security;
alter table public.weekly_scores enable row level security;

drop policy if exists xos1_opps_staff_only on public.user_roles;
drop policy if exists xos1_opps_staff_only on public.qbrs;
drop policy if exists xos1_opps_staff_only on public.weekly_scores;

-- ── user_roles ───────────────────────────────────────────────────────
-- Role ASSIGNMENT is manager/admin-driven (RolesManagement.jsx), not
-- self-service — an employee can see their own operational role(s) but
-- does not self-assign them, so write access here is team.manage-only,
-- with no auth_user_id = auth.uid() write exception.

drop policy if exists opps_user_roles_read on public.user_roles;
create policy opps_user_roles_read
on public.user_roles
for select
to authenticated
using (
  (auth_user_id = auth.uid() and tenant_id is not null and public.can_access_tenant(tenant_id))
  or (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.read'))
  or (tenant_id is null and public.is_app_admin())
);

drop policy if exists opps_user_roles_insert on public.user_roles;
create policy opps_user_roles_insert
on public.user_roles
for insert
to authenticated
with check (
  tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.manage')
);

drop policy if exists opps_user_roles_update on public.user_roles;
create policy opps_user_roles_update
on public.user_roles
for update
to authenticated
using (
  (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.manage'))
  or (tenant_id is null and public.is_app_admin())
)
with check (
  (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.manage'))
  or (tenant_id is null and public.is_app_admin())
);

drop policy if exists opps_user_roles_delete on public.user_roles;
create policy opps_user_roles_delete
on public.user_roles
for delete
to authenticated
using (
  (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.manage'))
  or (tenant_id is null and public.is_app_admin())
);

-- ── qbrs ─────────────────────────────────────────────────────────────
-- Daily closeout is self-service by design, but self-access now also
-- requires ACTIVE tenant membership (can_access_tenant), not just row
-- ownership — see "Correction 1" above. employee.team.manage
-- additionally lets an authorized manager/admin correct another
-- member's entry. tenant_id-null rows are is_app_admin()-only for
-- read/update/delete, and are never insertable by anyone (Correction 2).

drop policy if exists opps_qbrs_read on public.qbrs;
create policy opps_qbrs_read
on public.qbrs
for select
to authenticated
using (
  (auth_user_id = auth.uid() and tenant_id is not null and public.can_access_tenant(tenant_id))
  or (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.read'))
  or (tenant_id is null and public.is_app_admin())
);

drop policy if exists opps_qbrs_insert on public.qbrs;
create policy opps_qbrs_insert
on public.qbrs
for insert
to authenticated
with check (
  (auth_user_id = auth.uid() and tenant_id is not null and public.can_access_tenant(tenant_id))
  or (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.manage'))
);

drop policy if exists opps_qbrs_update on public.qbrs;
create policy opps_qbrs_update
on public.qbrs
for update
to authenticated
using (
  (auth_user_id = auth.uid() and tenant_id is not null and public.can_access_tenant(tenant_id))
  or (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.manage'))
  or (tenant_id is null and public.is_app_admin())
)
with check (
  (auth_user_id = auth.uid() and tenant_id is not null and public.can_access_tenant(tenant_id))
  or (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.manage'))
  or (tenant_id is null and public.is_app_admin())
);

drop policy if exists opps_qbrs_delete on public.qbrs;
create policy opps_qbrs_delete
on public.qbrs
for delete
to authenticated
using (
  (auth_user_id = auth.uid() and tenant_id is not null and public.can_access_tenant(tenant_id))
  or (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.manage'))
  or (tenant_id is null and public.is_app_admin())
);

-- ── weekly_scores ────────────────────────────────────────────────────
-- Same self-service shape as qbrs.

drop policy if exists opps_weekly_scores_read on public.weekly_scores;
create policy opps_weekly_scores_read
on public.weekly_scores
for select
to authenticated
using (
  (auth_user_id = auth.uid() and tenant_id is not null and public.can_access_tenant(tenant_id))
  or (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.read'))
  or (tenant_id is null and public.is_app_admin())
);

drop policy if exists opps_weekly_scores_insert on public.weekly_scores;
create policy opps_weekly_scores_insert
on public.weekly_scores
for insert
to authenticated
with check (
  (auth_user_id = auth.uid() and tenant_id is not null and public.can_access_tenant(tenant_id))
  or (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.manage'))
);

drop policy if exists opps_weekly_scores_update on public.weekly_scores;
create policy opps_weekly_scores_update
on public.weekly_scores
for update
to authenticated
using (
  (auth_user_id = auth.uid() and tenant_id is not null and public.can_access_tenant(tenant_id))
  or (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.manage'))
  or (tenant_id is null and public.is_app_admin())
)
with check (
  (auth_user_id = auth.uid() and tenant_id is not null and public.can_access_tenant(tenant_id))
  or (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.manage'))
  or (tenant_id is null and public.is_app_admin())
);

drop policy if exists opps_weekly_scores_delete on public.weekly_scores;
create policy opps_weekly_scores_delete
on public.weekly_scores
for delete
to authenticated
using (
  (auth_user_id = auth.uid() and tenant_id is not null and public.can_access_tenant(tenant_id))
  or (tenant_id is not null and public.has_tenant_permission(tenant_id, 'employee.team.manage'))
  or (tenant_id is null and public.is_app_admin())
);

commit;
