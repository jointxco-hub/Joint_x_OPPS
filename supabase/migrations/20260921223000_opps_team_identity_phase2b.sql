-- OPPS Team Identity Phase 2B — canonical auth_user_id assignment columns
--
-- Phase 2A (PR #91, merge fc5d6233a48b905e63565a8b25e8ce3d1ed2ce30) gave
-- every tenant directory member a stable auth_user_id alongside their
-- legacy email. Phase 2B is the compatibility migration that lets team
-- assignment/mention identity move onto that auth_user_id instead of
-- email, WITHOUT dropping the email columns or breaking existing rows.
--
-- Scope: team ASSIGNMENT and MENTION identity only - task/goal/idea/
-- bug-report/order assignees, and (pending the note below) file-comment
-- mentions. NOT customer/client email, invoice/quote contact email,
-- supplier email, expense submitter history, archived_by, created_by
-- attribution, or any other audit/history text - those are explicitly
-- out of scope for this migration even though some of them are also
-- "an email column on a row assigned to a person."
--
-- ── Why no foreign key ──────────────────────────────────────────────
-- Checked first, per instruction: public.users.auth_user_id has NO
-- unique constraint anywhere in this repo's migration history (the only
-- unique constraint found is tenant_memberships' `unique (tenant_id,
-- auth_user_id)`, a different table). public.users' own unique column is
-- user_email, not auth_user_id. A foreign key requires a unique target,
-- so these new columns are added as plain `uuid` with NO REFERENCES
-- clause this phase - adding one now would either fail outright or
-- silently rely on an uniqueness assumption nothing actually enforces.
--
-- ── Why file-comment mentions are NOT included in this migration ────
-- dataClient.entities.FileComment has no ENTITY_CONFIG entry in
-- src/api/dataClient.js - unlike every other entity touched here, it
-- resolves through handleLocalEntity() (the browser-local/offline
-- fallback), not a real Supabase table read/write. No migration file in
-- this repository (supabase/migrations/ or the src/api/supabase/
-- reference copies) creates a comments/mentions table, and no
-- mentioned_user or comment_text column turned up in any migration
-- search. Per instruction, the deployed table name/schema must be
-- verified before adding mentioned_auth_user_id - guessing it from
-- Base44-era JSON (none of which exists in this repo either) is exactly
-- what was ruled out. This migration deliberately stops short of that
-- one column; see the Phase 2B report for the concrete next step needed
-- to unblock it (a live, authorised schema check against the real
-- Supabase project before writing that piece).
--
-- ── Compatibility strategy ───────────────────────────────────────────
-- Every new column is nullable / defaults to an empty array and is
-- purely ADDITIVE - no existing column is renamed, retyped, or dropped.
-- tasks.assigned_user_id (references public.users.id, NOT auth_user_id)
-- is untouched and NOT repurposed; assigned_auth_user_id is a new,
-- separately-named column precisely so its semantics stay unambiguous.
-- Backfill only ever SETS a new column from a matched legacy value; it
-- never clears, rewrites, or invents a match for a legacy email that
-- doesn't resolve to a known user - those rows simply keep their new
-- column (or, for arrays, that position) null, detectable via the manual
-- verification queries at the bottom of this file (deliberately not a
-- persistent view - see that section for why). Every backfill statement
-- is idempotent (guarded so it only fills currently-empty new columns),
-- so this file is safe to run once on staging now and again, unchanged,
-- on production later.

begin;

-- ── 1. New canonical columns ─────────────────────────────────────────
alter table public.tasks
  add column if not exists assigned_auth_user_id uuid;

alter table public.goals
  add column if not exists assigned_auth_user_id uuid;

alter table public.ideas
  add column if not exists assigned_auth_user_id uuid;

alter table public.bug_reports
  add column if not exists assigned_auth_user_id uuid;

alter table public.orders
  add column if not exists assigned_to_auth_user_id uuid,
  add column if not exists assigned_team_auth_user_ids uuid[] not null default '{}';

alter table public.ops_tasks
  add column if not exists assigned_auth_user_ids uuid[] not null default '{}';

alter table public.weekly_tasks
  add column if not exists assigned_auth_user_ids uuid[] not null default '{}';

-- ── 2. Backfill: single-value email assignments ──────────────────────
-- lower(public.users.user_email) = lower(<table>.assigned_to). Idempotent:
-- only fills rows where the new column is still null, so re-running this
-- file changes nothing once a row has already been resolved.

update public.tasks t
set assigned_auth_user_id = u.auth_user_id
from public.users u
where t.assigned_auth_user_id is null
  and t.assigned_to is not null
  and u.auth_user_id is not null
  and lower(u.user_email) = lower(t.assigned_to);

update public.goals g
set assigned_auth_user_id = u.auth_user_id
from public.users u
where g.assigned_auth_user_id is null
  and g.assigned_to is not null
  and u.auth_user_id is not null
  and lower(u.user_email) = lower(g.assigned_to);

update public.ideas i
set assigned_auth_user_id = u.auth_user_id
from public.users u
where i.assigned_auth_user_id is null
  and i.assigned_to is not null
  and u.auth_user_id is not null
  and lower(u.user_email) = lower(i.assigned_to);

update public.bug_reports b
set assigned_auth_user_id = u.auth_user_id
from public.users u
where b.assigned_auth_user_id is null
  and b.assigned_to is not null
  and u.auth_user_id is not null
  and lower(u.user_email) = lower(b.assigned_to);

update public.orders o
set assigned_to_auth_user_id = u.auth_user_id
from public.users u
where o.assigned_to_auth_user_id is null
  and o.assigned_to is not null
  and u.auth_user_id is not null
  and lower(u.user_email) = lower(o.assigned_to);

-- ── 3. Backfill: array email assignments ─────────────────────────────
-- CORRECTNESS-CRITICAL: this must build the canonical array in the SAME
-- LENGTH and POSITION as the legacy array, with an explicit NULL at any
-- position that doesn't resolve - never a shorter, silently-compacted
-- array. An earlier version of this migration used an INNER join, which
-- drops any unresolved element instead of leaving a gap: for a 2-person
-- legacy assignment where only the first person resolves, that produced
-- a 1-element canonical array - and resolveAssignedTeamUsers() (see
-- src/lib/teamUsers.js), on seeing ANY non-empty canonical array, trusted
-- it wholesale and never looked at the legacy array again, so the second
-- (unresolved) person silently vanished from every display and selection
-- surface. Confirmed against production data before this was found:
-- ops_tasks alone has 19 legacy assignee entries, 16 resolving, with at
-- least one task where 2 legacy assignees have only 1 resolving.
--
-- Fixed with a LEFT join: array_agg(..., order by e.ord) over a LEFT
-- join produces NULL at exactly the positions that don't match, so
-- assigned_auth_user_ids[i] and assigned_to[i] always describe the same
-- person, resolved or not. resolveAssignedTeamUsers() (updated in this
-- same change) walks both arrays position-by-position - id first, legacy
-- email at that same position as fallback - so an unresolved id no
-- longer causes that person to disappear; it falls back to their email
-- instead of being dropped. Still idempotent (only fills currently-empty
-- arrays), still never invents an id for an unmatched email.

update public.ops_tasks t
set assigned_auth_user_ids = coalesce((
  select array_agg(u.auth_user_id order by e.ord)
  from unnest(t.assigned_to) with ordinality as e(email, ord)
  left join public.users u
    on u.auth_user_id is not null
   and lower(u.user_email) = lower(e.email)
), '{}'::uuid[])
where t.assigned_auth_user_ids = '{}'::uuid[]
  and t.assigned_to is not null
  and array_length(t.assigned_to, 1) > 0;

update public.weekly_tasks t
set assigned_auth_user_ids = coalesce((
  select array_agg(u.auth_user_id order by e.ord)
  from unnest(t.assigned_to) with ordinality as e(email, ord)
  left join public.users u
    on u.auth_user_id is not null
   and lower(u.user_email) = lower(e.email)
), '{}'::uuid[])
where t.assigned_auth_user_ids = '{}'::uuid[]
  and t.assigned_to is not null
  and array_length(t.assigned_to, 1) > 0;

update public.orders o
set assigned_team_auth_user_ids = coalesce((
  select array_agg(u.auth_user_id order by e.ord)
  from unnest(o.assigned_team) with ordinality as e(email, ord)
  left join public.users u
    on u.auth_user_id is not null
   and lower(u.user_email) = lower(e.email)
), '{}'::uuid[])
where o.assigned_team_auth_user_ids = '{}'::uuid[]
  and o.assigned_team is not null
  and array_length(o.assigned_team, 1) > 0;

commit;

-- ── Manual verification only - deliberately NOT a persistent view ────
-- An earlier version of this migration created
-- public.opps_team_identity_phase2b_unresolved as a real view. Removed:
-- a view's default execution context in Postgres runs with the DEFINER's
-- (migration runner's) privileges unless security_invoker is explicitly
-- set, and nothing in this file granted or restricted SELECT on it - so
-- depending on whatever role ended up with default access, it risked
-- becoming an unrestricted, CROSS-TENANT surface exposing every tenant's
-- unresolved legacy assignment emails to any authenticated OPPS user,
-- not just admins. That risk isn't worth a permanent database object for
-- what is fundamentally a one-off/occasional verification need. If a
-- persistent version is ever wanted, it must be security_invoker = true
-- with explicit `revoke all ... from public, anon, authenticated,
-- service_role` and a scoped grant to whatever role this codebase
-- already treats as admin-only (see can_manage_opps_user()/
-- is_app_admin() from Phase 1/2A) - not created here.
--
-- Run these manually in Studio when checking backfill completeness
-- before ever considering dropping the legacy email columns. The array
-- queries report the EXACT unresolved (email, position) pairs - not just
-- "the whole array whenever lengths differ" - since after the LEFT JOIN
-- fix above, assigned_auth_user_ids[i] being null with assigned_to[i]
-- non-null IS the precise unresolved case, position by position:

-- select 'tasks' as table_name, id, assigned_to as unresolved_email
--   from public.tasks where assigned_to is not null and assigned_auth_user_id is null
-- union all
-- select 'goals', id, assigned_to
--   from public.goals where assigned_to is not null and assigned_auth_user_id is null
-- union all
-- select 'ideas', id, assigned_to
--   from public.ideas where assigned_to is not null and assigned_auth_user_id is null
-- union all
-- select 'bug_reports', id, assigned_to
--   from public.bug_reports where assigned_to is not null and assigned_auth_user_id is null
-- union all
-- select 'orders.assigned_to', id, assigned_to
--   from public.orders where assigned_to is not null and assigned_to_auth_user_id is null
-- union all
-- select 'ops_tasks.assigned_to', t.id, e.email
--   from public.ops_tasks t, unnest(t.assigned_to) with ordinality as e(email, ord)
--   where e.email is not null and (t.assigned_auth_user_ids[e.ord] is null)
-- union all
-- select 'weekly_tasks.assigned_to', t.id, e.email
--   from public.weekly_tasks t, unnest(t.assigned_to) with ordinality as e(email, ord)
--   where e.email is not null and (t.assigned_auth_user_ids[e.ord] is null)
-- union all
-- select 'orders.assigned_team', o.id, e.email
--   from public.orders o, unnest(o.assigned_team) with ordinality as e(email, ord)
--   where e.email is not null and (o.assigned_team_auth_user_ids[e.ord] is null)
-- order by table_name;

-- Count-only summary of the same, for a quick "are we done yet" check:
-- select table_name, count(*) from ( <the query above> ) x group by table_name order by table_name;
