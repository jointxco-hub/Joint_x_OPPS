# OPPS Permission-Model Source-of-Truth Restoration — 2026-09-27

## Status

**Documentation only. Nothing in this file has been applied anywhere.**
No migration is created by this document, no ledger row is touched, and
no live function is modified. This is kept deliberately separate from
the Café authorization security patch
(`20260927120000_qs_administration_capability_authorization.sql`, Café
repo) — that patch closes an authorization gap in six *Café* RPCs and
does not touch, narrow, or depend on committing any of the functions
below; it only depends on them **existing**, which they already do,
live, on both staging and production.

## Background

Three functions that back the wider OPPS tenant-permission model are
live, byte-identical, on both staging (`tijiamrfnxrbitafiflj`) and
production (`slhcvyeuqsduaglddqdb`), and predate/exceed everything
this repository's git history defines for them:

- `public.is_opps_staff()`
- `public.is_opps_workspace_tenant(uuid)`
- `public.has_tenant_permission(uuid, text)`

along with the two tables they read:

- `public.tenant_access_roles`
- `public.tenant_access_role_permissions`

None of these five objects has a `create table` / `create or replace
function` statement anywhere in this repository's git history, on any
branch, local or remote (`git log --all -S"<name>" -- '*.sql'`, run
against a full `git fetch origin '+refs/heads/*:refs/remotes/origin/*'`
first). A small number of *other* migrations reference or call them —
`20260915130000_qs10_staff_new_order_rpc.sql` calls
`has_tenant_permission`, and `20260921210000_opps_team_directory_phase2.sql`
joins `tenant_access_roles` — proving these objects were already
expected to exist by the time those migrations shipped, but no commit
anywhere *creates* them.

This was discovered while investigating why
`cafe_access_03_counter_operate_members.sql` failed against staging:
`is_opps_staff()` was found to be broader, live, than any git-committed
definition — the third branch below is what caused the escalation that
the Café security patch closes.

## Verified canonical bodies (read-only, staging and production, byte-identical)

### `public.is_opps_staff()`

```sql
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
$function$
```

The third `exists(...)` branch (any active member of any
`opps_workspace`-flagged tenant holding an `opps.access` permission) is
the one absent from every git-committed version of this function
(`is_app_admin() OR joint-x staff` only). It is intentional and
canonical for the wider permission model — not a bug, and not something
this restoration proposes to remove or narrow.

### `public.is_opps_workspace_tenant(uuid)`

```sql
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
$function$
```

### `public.has_tenant_permission(uuid, text)`

```sql
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
$function$
```

`tenant_access_roles` columns (as read by the joins above and by
`20260921210000_opps_team_directory_phase2.sql`):
`tenant_id, role_key, name, description, rank, is_system, is_active`.
`tenant_access_role_permissions` columns:
`tenant_id, role_key, permission_key, allowed`.
Neither table's `create table` statement was found in git; both are
inferred here only from column usage in the functions above and in the
one other migration that joins them. **This document does not assert
these are the complete table definitions** (constraints, indexes,
defaults, RLS policies are unknown) — only the columns actually read.

## Disposition

No action is taken here. A future restoration migration, if and when
undertaken, should:

1. `create or replace function` all three functions above, verbatim,
   as its entire body (no behavior change — these already run live).
2. Either author real `create table` statements for
   `tenant_access_roles` / `tenant_access_role_permissions` guarded by
   `if not exists`, or explicitly document them as pre-existing and out
   of scope if a fuller definition (RLS, indexes, defaults) is obtained
   first — that fuller definition has not been pulled in this pass and
   should be, before any such migration is written.
3. Be reviewed and applied entirely independently of the Café
   authorization security patch, and independently of the
   CAFE-ACCESS-01..04 rollout — none of them depend on this restoration
   landing; they only depend on the functions continuing to exist and
   behave as they already do.

## Cross-reference

- The escalation this gap enabled, and the Café-side fix, are described
  in `supabase/migrations/20260927120000_qs_administration_capability_authorization.sql`
  (Café repo) and in `supabase/tests/cafe_access_03_counter_operate_members.sql`
  (this repo).
