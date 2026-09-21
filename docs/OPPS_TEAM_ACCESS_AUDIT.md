# OPPS Team & Access — Phase 1 audit

## Confirmed production problem

Read-only inspection of the live OPPS Supabase project confirmed the user's concern is real at the database boundary, not only in the UI.

### public.users
- RLS is enabled.
- The current `xos1_opps_staff_only` policy is `FOR ALL` and allows any identity for which `is_opps_staff()` is true.
- `authenticated` has SELECT, INSERT, UPDATE and DELETE table privileges.
- Therefore an ordinary OPPS staff identity that passes `is_opps_staff()` can currently mutate `public.users` rows unless another application path prevents it.

### Why `is_opps_staff()` is too broad for user management
`is_opps_staff()` returns true for:
- app admins;
- active Joint X users with an active Joint X tenant membership;
- OPPS workspace members who have `opps.access`.

That predicate is appropriate as an "may enter OPPS" gate. It is NOT an appropriate "may manage users" gate.

### Frontend compounds the problem
`src/pages/Directory.jsx` currently:
- loads up to 300 users through `dataClient.entities.User.list(...)`;
- prints each user's email in the directory card;
- decides management UI using client-side `isAdmin(me)`;
- `isAdmin` also contains a hard-coded email allow-list.

`dataClient.entities.User` maps directly to `public.users` and is not tenant-scoped.

Many operational screens also call `User.list` for assignee pickers, so immediately blocking all cross-user SELECT would break Orders, Tasks, Goals, Calendar, PO and file mention workflows.

## Phase 1 recommendation implemented in this pack

Lock writes first without breaking assignment flows:
- keep OPPS-staff read temporarily;
- direct public.users writes are management-only; ordinary users do not receive a blanket self-write policy because RLS cannot restrict that policy to safe profile columns;
- app admin can manage users;
- tenant owner/admin can manage only users sharing an active tenant membership;
- ordinary staff cannot insert/update/delete somebody else's profile;
- safe self-profile editing should be restored later through a dedicated RPC that allow-lists non-privileged fields.

This closes the high-risk mutation problem with minimal operational blast radius.

## Phase 2 — next
Build a server RPC such as `list_opps_team_directory(tenant_id)` that returns only:
- auth/user id needed for assignment,
- preferred/full display name,
- avatar,
- department,
- operational role label,
- active state.

Do NOT return email/phone/private bio/skills unless caller has `team.manage`.

Then replace the `User.list(...)` calls used only for assignee pickers with that RPC and tighten the `public.users` SELECT policy to self + team managers/app admins.

## Permission model
Use the existing `tenant_access_roles` + `tenant_access_role_permissions` system rather than inventing a parallel role store.

Suggested capabilities:
- `team.directory.read`
- `team.manage`
- `orders.read`
- `orders.write`
- `production.update`
- `finance.read`
- `finance.write`
- `clients.read`
- `clients.write`
- `settings.manage`

Important: the live Joint X `member` and `staff` access roles currently have wildcard `*`. That should be replaced with explicit permissions in a separate, tested migration. Do not remove `*` blindly in production because it can break existing OPPS modules.
