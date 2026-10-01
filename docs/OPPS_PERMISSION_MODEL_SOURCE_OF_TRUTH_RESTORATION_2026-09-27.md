# OPPS Permission-Model Source-of-Truth Restoration — 2026-09-27

## Status

**Original 2026-09-27 pass: documentation only, nothing applied.**

**Update — 2026-10-01 (RBAC Remediation Phase 0):** this document's own
Disposition section (below) prescribed exactly this — a future
restoration migration, created in its own time. That migration now
exists: `supabase/migrations/20261001100000_opps_rbac_source_of_truth_restoration.sql`.
It is **prepared but not yet applied to production** as of this update
(Phase 0 is additive/documentary only, per its own scope — see that
migration's header). It restores the three functions below byte-for-byte
(verified via local hash parity, not yet via a live round-trip), plus
three more functions discovered while auditing the wider RBAC system
(`admin_list_workspace_roles`, `admin_list_workspace_members`,
`admin_set_workspace_member_role` — see new section below) that have the
same "live but untracked" characteristic as the original three. It does
**not** emit `CREATE TABLE` for `tenant_access_roles` /
`tenant_access_role_permissions` — their full live structure (previously
unknown, flagged below as a gap in the original pass) has now been
captured and is documented in full further down, but DDL restoration for
these two tables was deliberately deferred as lower-priority/higher-risk
than the function restoration. No wildcard, permission row, tenant
membership, or RLS behavior has been changed by this update — this
remains a documentation-plus-tracked-definition exercise, not a
behavior change.

**Update — 2026-10-01/02 (RBAC Remediation Slice 1):** the first actual
behavior change following this restoration — hardens
`admin_set_workspace_member_role` against a self-promotion/role-hierarchy
gap. Production transaction rehearsal passed (23/23 cases); migration
prepared but **not yet applied to production**. See the dedicated section
near the end of this document for the full record. No wildcard row was
touched.

**Update — 2026-10-02 (RBAC Remediation Phase 0 — applied, reconciled):**
`20261001100000_opps_rbac_source_of_truth_restoration.sql` was applied to
production. The apply itself succeeded cleanly (preflight hash guard
passed, all six `CREATE OR REPLACE FUNCTION` statements ran, transaction
committed). Post-apply verification then found all six functions'
recorded hashes had changed from both the pre-apply baseline and the
pre-commit local verification. Root cause, confirmed by direct
inspection and a byte-for-byte semantic diff (not assumed from the hash
mismatch alone): the migration's own body text has a blank line
immediately after each `AS $function$` delimiter; since the newline
ending that line is already the first character inside the dollar-quoted
string, the blank line adds a *second* leading newline rather than
reproducing the original single one. All six functions now carry two
leading newlines in `prosrc` instead of one. This was accepted as the new
canonical baseline rather than corrected with a follow-up migration — see
the dedicated "Phase 0 — production apply + reconciliation" section below
for the full old/new hash table and semantic-diff proof. No executable
SQL, permission row, wildcard row, tenant membership, or RLS behavior
changed. Slice 1 remains unapplied.

This is kept deliberately separate from the Café
authorization security patch
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

*Hashes added 2026-10-01, re-verified against production
(`slhcvyeuqsduaglddqdb`) only (not re-checked against staging in this
pass). Full-definition hash = `md5(pg_get_functiondef(...))`; body hash =
`md5(prosrc)`, the two can legitimately differ for reasons that have
nothing to do with the function's behavior — see "Hash-parity note"
below.*

### `public.is_opps_staff()`

Full-definition hash: `4d0a70c336188670017c33dec9ec0fd2`
Body-only hash: `2767717a6fd60a202ba30343438e6f4e`
ACL: `authenticated, service_role` (not granted to `public`/`anon`)

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

Full-definition hash: `d4eeb5e828f923a5e56ba465bfca0eab`
Body-only hash: `0edde73cde7c0d15c452bf6e82a75f84`
ACL: `public` (covers `anon`), `authenticated`, `service_role`

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

Full-definition hash: `b7c9df19f951ebc4749d4aa036760106`
Body-only hash: `138d1867582099cb9580e43ee5e415ae`
ACL: `public` (covers `anon`), `authenticated`, `service_role`

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

**Update — 2026-10-01: full table structure now captured** (previously
unknown; this replaces the column-inference-only note below it). Neither
table's `create table` statement was found in git — confirmed again in
this pass via `git log --all --oneline -S"tenant_access_roles"` /
`-S"tenant_access_role_permissions"` (2 and 2 hits respectively, both
reference-only, not `CREATE TABLE`). Both tables exist live with the
following structure:

**`public.tenant_access_roles`**
```sql
tenant_id    uuid NOT NULL,
role_key     text NOT NULL,
name         text NOT NULL,
description  text,
rank         integer NOT NULL DEFAULT 100,
is_system    boolean NOT NULL DEFAULT true,
is_active    boolean NOT NULL DEFAULT true,
created_at   timestamptz NOT NULL DEFAULT now(),
updated_at   timestamptz NOT NULL DEFAULT now(),
PRIMARY KEY (tenant_id, role_key),
FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
```
RLS: enabled, not forced. One policy: `tenant_members_read_access_roles`
— `SELECT` for `authenticated`, `USING (can_access_tenant(tenant_id))`.
No INSERT/UPDATE/DELETE policy exists for any application role — writes
are only possible as `postgres`/`service_role` (direct grants), or via a
`SECURITY DEFINER` function running as the function owner (`postgres`).
There is no app-reachable direct write path to this table.
Trigger: `trg_tenant_access_roles_updated_at` (`BEFORE UPDATE`, calls
`handle_updated_at()`).
Grants: `authenticated` → `SELECT` only; `postgres`/`service_role` →
full (INSERT/SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER).

**`public.tenant_access_role_permissions`**
```sql
tenant_id      uuid NOT NULL,
role_key       text NOT NULL,
permission_key text NOT NULL,
allowed        boolean NOT NULL DEFAULT true,
created_at     timestamptz NOT NULL DEFAULT now(),
updated_at     timestamptz NOT NULL DEFAULT now(),
PRIMARY KEY (tenant_id, role_key, permission_key),
FOREIGN KEY (tenant_id, role_key) REFERENCES tenant_access_roles(tenant_id, role_key) ON DELETE CASCADE
```
RLS: enabled, not forced. One policy: `tenant_members_read_access_role_permissions`
— identical shape, `SELECT` for `authenticated`, `USING (can_access_tenant(tenant_id))`.
Same no-app-write-path posture as above.
Trigger: `trg_tenant_access_role_permissions_updated_at` (`BEFORE UPDATE`,
same `handle_updated_at()`).
Grants: same pattern as `tenant_access_roles`.

Note the composite FK: `tenant_access_role_permissions(tenant_id,
role_key)` references `tenant_access_roles(tenant_id, role_key)`, not a
plain surrogate key — a permission row cannot exist for a
(tenant, role) pair that isn't itself a registered row in
`tenant_access_roles`. This is why `has_tenant_permission`'s join
requires `ar.is_active=true` on that registration row, not just a
matching `tenant_access_role_permissions` row.

<details>
<summary>Original 2026-09-27 column-inference note (superseded above, kept for history)</summary>

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

</details>

## Three more live-but-untracked functions (discovered 2026-10-01)

While auditing the wider RBAC system (Slice 02B-1 follow-up), three more
functions were found referenced from the frontend
(`src/lib/workspaceApi.js:135-161`) with no `CREATE FUNCTION` anywhere in
git history — the same pattern as the three functions above. All three
gate on `has_tenant_permission(tenant_id, 'staff.manage')` **OR**
`is_app_admin()` — `staff.manage` is a permission_key not previously
identified in any usage inventory, since these functions themselves were
untracked; it inherits the same `joint-x` wildcard exposure as every
other permission_key checked via `has_tenant_permission` for a role
holding a `'*'` row there.

### `public.admin_list_workspace_roles(uuid)`

Full-definition hash: `aec5b5daaffa08049b59f4415f870b2d`
Body-only hash: `14cbca95db2fd8e0cbc0f0d6241d5338`
ACL: `authenticated, service_role` (not granted to `public`/`anon`)
Volatility: `STABLE`

```sql
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
$function$
```

Note: returns the raw `permission_key` list per role, including the
literal string `'*'` if a role has a wildcard row — an admin inspecting
a role via whatever UI calls this RPC would see `"*"` as a literal
permission in the list, not an expanded/resolved set.

### `public.admin_list_workspace_members(uuid)`

Full-definition hash: `6ad42b6911ad9f762bb8cb645a99c584`
Body-only hash: `9c536d030f06b5c1948a6ca0ed237881`
ACL: `authenticated, service_role` (not granted to `public`/`anon`)
Volatility: `STABLE`

```sql
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
$function$
```

### `public.admin_set_workspace_member_role(uuid, text)`

Full-definition hash: `c87cf5bb28a402eb08826fdd5ecde9ae`
Body-only hash: `d264543fc3452bfc9b6eb50edfa1ff33`
ACL: `authenticated, service_role` (not granted to `public`/`anon`)
Volatility: `VOLATILE` (the default — this is the only one of the six
that mutates anything; the other five are read-only/`STABLE`)

```sql
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
$function$
```

**Important correction to prior assumption:** before this pass, "changing
tenant roles" had no known audit trail (flagged `Unknown` in the RBAC
audit that preceded this restoration). This function proves otherwise —
every role change writes a row to `public.tenant_access_audit_log`
(`tenant_id, actor_auth_user_id, membership_id, action, previous_role,
new_role, metadata`). That table's own full structure was not captured
in this pass (out of the stated 2-table scope for Phase 0) and is
flagged as a candidate for a future restoration pass.

It also enforces a real safety invariant worth noting: if the role being
changed FROM currently grants `staff.manage` (directly or via `'*'`) and
the role being changed TO does not, the function refuses the change
(`'A workspace must keep at least one owner or staff manager.'`) unless
at least one other active member of that tenant still holds
`staff.manage` — a workspace can never be left with zero staff managers
via this path.

## Correction: `public.user_finance_level()` is already correctly tracked

A fourth function (`public.user_finance_level()`) was initially suspected
of having the same "live but untracked" gap (it was flagged as such in
the RBAC audit that preceded this restoration pass). That was **incorrect**.
It is already defined, byte-identical to the live body, in
`supabase/migrations/20260523_finance_rls_tighten.sql:90-114` — verified
by direct comparison in this pass. No restoration is needed or proposed
for this function.

## Hash-parity note

`pg_get_functiondef()`'s rendered function body is **not byte-identical**
to the raw `prosrc` catalog value it's generated from — empirically, it
silently drops a leading newline that `prosrc` preserves verbatim. This
has no effect on behavior whatsoever — it's purely a decompiler rendering
quirk. The migration in this restoration pass
(`20261001100000_opps_rbac_source_of_truth_restoration.sql`) is built
from raw `prosrc` (queried directly) for this reason, not from
`pg_get_functiondef()`'s rendering.

**Correction (2026-10-02):** the paragraph above originally also claimed
that re-inserting one blank line after `AS $function$` reproduces this
dropped newline, and that local pre-commit verification confirmed exact
hash parity against the live `prosrc`. Both claims were wrong. The
newline ending the `AS $function$` line is *itself* the dropped newline
`pg_get_functiondef()` loses — the original live `prosrc` for all six
functions begins with exactly one leading newline, already supplied by
that line ending alone, with no blank line needed below it. Adding a
blank line there supplies a *second* leading newline, not a reproduction
of the first. This was not caught before the production apply. See
"Phase 0 — production apply + reconciliation" below for the resulting
hash drift, its confirmed harmlessness, and the decision to accept it as
the new canonical baseline.

## Disposition

**Original 2026-09-27 disposition (superseded by the 2026-10-01 update
above — kept for history):**

No action is taken here. A future restoration migration, if and when
undertaken, should:

1. `create or replace function` all three functions above, verbatim,
   as its entire body (no behavior change — these already run live).
   — **Done 2026-10-01**: `20261001100000_opps_rbac_source_of_truth_restoration.sql`,
   prepared, not yet applied to production.
2. Either author real `create table` statements for
   `tenant_access_roles` / `tenant_access_role_permissions` guarded by
   `if not exists`, or explicitly document them as pre-existing and out
   of scope if a fuller definition (RLS, indexes, defaults) is obtained
   first — that fuller definition has not been pulled in this pass and
   should be, before any such migration is written.
   — **Fuller definition obtained 2026-10-01** (see table section above).
   DDL restoration deliberately deferred — documented instead, per this
   phase's explicit preference for documentation-only table restoration
   where emitting DDL could carry any risk (composite FK, RLS policies,
   and triggers all add real failure surface a `CREATE OR REPLACE
   FUNCTION` doesn't have).
3. Be reviewed and applied entirely independently of the Café
   authorization security patch, and independently of the
   CAFE-ACCESS-01..04 rollout — none of them depend on this restoration
   landing; they only depend on the functions continuing to exist and
   behave as they already do. — Still true; unchanged by this update.

**Remaining open items after this update:**
- Apply `20261001100000_opps_rbac_source_of_truth_restoration.sql` to
  production (not done in this pass — Phase 0 is preparation only).
- Decide whether `tenant_access_roles` / `tenant_access_role_permissions`
  should eventually get real tracked `CREATE TABLE IF NOT EXISTS` +
  constraint statements, now that their full structure is known and the
  risk is better understood.
- Capture `public.tenant_access_audit_log`'s structure in a future pass
  (discovered via `admin_set_workspace_member_role`, not yet documented).
- This document still does not address the `joint-x` `'*'` wildcard
  itself, or any of the broader RBAC remediation phases — this is Phase
  0 (source-of-truth restoration) only. See the full RBAC audit report
  for Phases 1-7.

## Cross-reference

- The escalation this gap enabled, and the Café-side fix, are described
  in `supabase/migrations/20260927120000_qs_administration_capability_authorization.sql`
  (Café repo) and in `supabase/tests/cafe_access_03_counter_operate_members.sql`
  (this repo).
- The 2026-10-01 update above was produced during RBAC Remediation Phase
  0 (source-of-truth restoration), itself following a full read-only RBAC
  audit (`joint-x` `'*'` wildcard, My Hub, Directory, frontend/backend
  consistency — not reproduced here). See
  `supabase/migrations/20261001100000_opps_rbac_source_of_truth_restoration.sql`
  for the migration this update describes.
- See the next section for RBAC Remediation Slice 1 (the first actual
  behavior change, not just restoration), including its production
  transaction rehearsal result.

## RBAC Remediation Phase 0 — production apply + reconciliation (2026-10-02)

**Status: applied to production. Hash drift found, root-caused, and
reconciled as a documentation-only correction. No corrective SQL issued.
No executable behavior changed.**

`20261001100000_opps_rbac_source_of_truth_restoration.sql` was applied to
production inside a transaction with a preflight hash guard
(`BEGIN; <preflight>; <migration>; COMMIT;`). The preflight passed against
the pre-apply baseline below, all six `CREATE OR REPLACE FUNCTION`
statements ran without error, and the transaction committed.

Post-apply verification then found every one of the six functions'
`full_hash` / `body_hash` had changed from both the pre-apply baseline and
the pre-commit local verification recorded in this migration's own header
comments. Owner (`postgres`), `SECURITY DEFINER` (`true` for all six),
volatility (`STABLE` for five, `VOLATILE` for `admin_set_workspace_member_role`),
`search_path`, and ACL all matched the migration's declared values exactly
— the drift was confined to the hash columns.

**Root cause (confirmed, not inferred):** every function body in the
migration file reads:

```sql
AS $function$
                                 ← blank line
  select ...                    ← body
```

The newline ending the `AS $function$` line is already the first
character inside the dollar-quoted string. The blank line immediately
below it is a **second**, additional newline — not a reproduction of the
one `pg_get_functiondef()` drops. The original live `prosrc` for all six
functions began with exactly one leading newline; the migration as
written and applied produces two. This pattern was confirmed present for
all six functions in the committed file (not an isolated typo), and the
live post-apply `prosrc` for all six was confirmed to begin with two
leading newlines, matching the file exactly.

**Semantic-diff proof (not hash-mismatch inference alone):** the body
text of each function was extracted from the migration file between its
`AS $function$` / `$function$;` delimiters and compared directly,
character-for-character, against the live `prosrc` pulled from production
after the apply. Result for all six functions: the file's body and the
live body are **byte-for-byte identical** (confirming the apply itself
transported the file's content exactly, with no corruption in transit),
and the only difference between that body and the pre-restoration
original is the leading-newline count (2 vs. 1). No other character
differs anywhere in any of the six bodies.

**Old → new hash table:**

| Function | Original full hash | Original body hash | Current full hash | Current body hash |
|---|---|---|---|---|
| `has_tenant_permission(uuid,text)` | `b7c9df19f951ebc4749d4aa036760106` | `138d1867582099cb9580e43ee5e415ae` | `1c4f8ddedbbe7d774cf8d422891b92cb` | `f00f15045f6212cc88bbbb074a58c575` |
| `is_opps_staff()` | `4d0a70c336188670017c33dec9ec0fd2` | `2767717a6fd60a202ba30343438e6f4e` | `83ed4016cafa795f7a0231a9e7bf0784` | `37331b76e4651a385581989e4b9655be` |
| `is_opps_workspace_tenant(uuid)` | `d4eeb5e828f923a5e56ba465bfca0eab` | `0edde73cde7c0d15c452bf6e82a75f84` | `92253b36777450d70b61481e9ba29d80` | `88f75c8ed5f69dba9df2c934e9ece326` |
| `admin_list_workspace_members(uuid)` | `6ad42b6911ad9f762bb8cb645a99c584` | `9c536d030f06b5c1948a6ca0ed237881` | `6f594df925c27a0c09e12e52ab05c07d` | `60ead26b04fdb3c882c0c66a702de2ef` |
| `admin_list_workspace_roles(uuid)` | `aec5b5daaffa08049b59f4415f870b2d` | `14cbca95db2fd8e0cbc0f0d6241d5338` | `0c722331e7c1c2ade8fb7323581dcf11` | `ac1f42a4ec60a09ce52a94ba270c51fd` |
| `admin_set_workspace_member_role(uuid,text)` | `c87cf5bb28a402eb08826fdd5ecde9ae` | `d264543fc3452bfc9b6eb50edfa1ff33` | `e113e45cf6b019e271b2a20678a3dc21` | `1e0db63ffa60c0cd5f2d029996ae30a2` |

**Decision:** the extra leading blank line is confirmed behavior-neutral —
it has no effect on SQL/PL-pgSQL parsing or execution. Issuing a
corrective migration purely to restore single-leading-newline byte parity
was judged not worth a further production write. The current
(double-leading-newline) state is accepted as the new canonical baseline.
These "current post-restoration hash" values are now also recorded in the
migration file's own header comments, next to the original
pre-restoration values, for each of the six functions.

**Confirmed unchanged by this apply or this reconciliation:** no row in
`tenant_access_role_permissions` or `tenant_access_roles` was touched; no
`'*'` wildcard grant changed; no `tenant_memberships` row changed; no RLS
policy changed; Slice 1
(`20261001110000_rbac_slice1_harden_workspace_role_change.sql`) remains
unapplied, with no bookkeeping row for its version.

**Note for Slice 1:** the "pre-Slice live baseline" hash recorded in the
Slice 1 section below (`c87cf5bb28a402eb08826fdd5ecde9ae` /
`d264543fc3452bfc9b6eb50edfa1ff33`) is the *original* pre-restoration
hash for `admin_set_workspace_member_role`, not the current live hash
(`e113e45cf6b019e271b2a20678a3dc21` / `1e0db63ffa60c0cd5f2d029996ae30a2`).
Any future preflight hash check run before applying Slice 1 must use the
current value, not the one recorded at the time Slice 1 was written. This
is a bookkeeping note only — Slice 1's own migration SQL is untouched by
this reconciliation.

## RBAC Remediation Slice 1 — workspace-role hardening (2026-10-01/02)

**Status: migration and rehearsal prepared, production transaction
rehearsal passed, migration NOT yet applied to production, nothing
committed as of this note's own writing.**

Builds on Phase 0 above. Hardens `public.admin_set_workspace_member_role`
against two issues found while auditing the wider RBAC system (not
restoration-scope — see the main RBAC audit report for the full context):
the function had no guard comparing the caller to the target (any
authorized caller could change their own role, including self-promoting
to `'owner'` on a tenant where the wildcard makes `staff.manage`
universally available), and no role-hierarchy ceiling at all (an `admin`
caller could promote anyone, including themselves, to `'owner'`).

Migration: `supabase/migrations/20261001110000_rbac_slice1_harden_workspace_role_change.sql`.
Pre-Slice live baseline (confirmed unchanged immediately before writing
this migration, and reconfirmed immediately before this note): full
definition hash `c87cf5bb28a402eb08826fdd5ecde9ae`, body hash
`d264543fc3452bfc9b6eb50edfa1ff33`. Only this one function is touched —
signature, owner, `SECURITY DEFINER`, `search_path`, and ACL all
unchanged; the existing primary authorization gate, role validation, and
`tenant_access_audit_log` insert are all preserved verbatim. **No
wildcard row, `tenant_access_role_permissions` data, Employee Hub RLS, or
frontend code was touched by this slice.**

Guards added (confirmed by the product owner, with one correction before
rehearsal — see the migration's own header comment for the full
interpretive history):
- Self-role-change is rejected unconditionally, including for
  `is_app_admin()` callers.
- Only an app admin may assign the `'owner'` role to anyone, or modify a
  target whose current role is `'owner'` — true for both owner and admin
  callers.
- A tenant admin's authority is strictly below admin: may not touch or
  assign the `'admin'` role itself. A tenant owner has no such ceiling
  against admin (may manage admin and everything below).
- The final active owner in a tenant cannot be demoted through this RPC,
  unconditionally, including for app-admin callers.
- A caller with no real owner/admin standing in the target tenant is
  rejected outright, even if `has_tenant_permission()` would have
  returned true for them via a wildcard — closing the specific exposure
  this slice was written for.

**Production transaction rehearsal (this session, against production,
`slhcvyeuqsduaglddqdb`, `BEGIN...ROLLBACK`, run via the Supabase CLI's
`db query --linked`, not via Studio):**
- All 23 rehearsal cases passed — 6 successful mutations (owner managing
  staff/member/admin targets, app-admin demoting a non-last owner, app-
  admin promoting an existing admin straight to owner, admin managing a
  member target) and 12 correctly-rejected cases (every hierarchy
  violation, both self-role-change paths, cross-tenant, invalid role,
  nonexistent target), plus audit-log count/content/negative checks and
  an unrelated-membership spot-check.
- Two real bugs were found and fixed during this rehearsal attempt before
  it could pass, neither a wildcard or permission issue:
  1. The fixture-setup `public.users.role='admin'` insert needed a
     temporary, transaction-scoped admin JWT claim to pass
     `enforce_approved_admin_role_change()` — the same requirement
     already documented for the Phase 0/Slice 02B-1 rehearsals above.
     This fix is **wrapper-only** (needed only when running via a
     connection without an already-approved-admin session) and is
     deliberately **not** present in the tracked
     `supabase/tests/rbac_slice1_rehearsal.sql` — consistent with how
     the Slice 02B-1 rehearsal wrapper was handled.
  2. A genuine bug in the rehearsal's own fixture design: disposable
     target memberships used a bare `gen_random_uuid()` as
     `auth_user_id` with no matching `auth.users` row, violating
     `tenant_memberships`' foreign key. This fix **is** in the tracked
     rehearsal script — it was a real defect in the reusable test, not
     wrapper scaffolding.
- Post-rollback, read-only verification confirmed: `admin_set_workspace_member_role`'s
  live hash restored to the exact pre-rehearsal baseline (both full and
  body hash), zero residue across disposable tenants / `auth.users` /
  `public.users` / `tenant_memberships` / `tenant_access_audit_log` rows,
  and no migration bookkeeping entry for `20261001110000`.
- `tenant_access_audit_log` finding (confirmed, not previously known):
  only `admin_set_workspace_member_role` writes to it; it has RLS enabled
  with **zero policies**, so it's unreadable by `authenticated` entirely
  (only `postgres`/`service_role`) — role changes are correctly logged
  but there is currently no way for an admin to view this history through
  the app.
- **No wildcard behavior was changed by this slice.** `joint-x`
  `owner`/`admin`/`member`/`staff` still all hold `'*'` in
  `tenant_access_role_permissions`, exactly as before — this slice only
  hardens the one RPC's own internal logic, independent of that broader,
  still-open remediation question.
