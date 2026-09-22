-- OPPS Employee Hub Phase 2C — canonical auth_user_id/tenant_id identity
-- for operational-role/QBR/weekly-score tables.
--
-- Builds on Phase 2A (public.users locked to admin-only direct access) and
-- Phase 2B (team assignment/mention identity moved to auth_user_id). This
-- migration does the same compatibility move for the three tables behind
-- OPPS's "My Hub" employee system: user_roles (operational role
-- assignment), qbrs (daily closeout), weekly_scores (12-week execution
-- tracking). order_tags is deliberately NOT touched here — live data shows
-- 0 of 282 rows have user_email populated; tagging is role_key-based, not
-- person-based, so there is no email identity to migrate on that table.
--
-- ── Why no foreign key ────────────────────────────────────────────────
-- Same reasoning as Phase 2B: public.users.auth_user_id has no unique
-- constraint anywhere in this repo's migration history, so a FK target
-- isn't available. New columns are plain uuid, no REFERENCES clause.
--
-- ── Compatibility strategy ───────────────────────────────────────────
-- Purely additive: every new column is nullable, no existing column is
-- renamed, retyped, or dropped (user_email stays on all three tables).
-- Backfill only ever SETS a column from an unambiguous match; it never
-- invents an identity for a row that doesn't resolve. Every backfill
-- statement is idempotent (guarded to only fill currently-null columns),
-- safe to run again unchanged.
--
-- ── tenant_id backfill scope ─────────────────────────────────────────
-- These three tables have exactly one tenant using them today (joint-x —
-- see public.is_opps_staff()'s hardcoded tenant.slug = 'joint-x'). Backfill
-- resolves tenant_id ONLY to the joint-x tenant, and ONLY when the
-- resolved person has an ACTIVE membership there. A legacy row whose
-- email resolves to a person with no active joint-x membership is left
-- with tenant_id null rather than guessed — this is deliberate per
-- instruction not to guess tenant ownership for legacy rows.
--
-- ── The two exceptions to "never touch a unique constraint" ────────────
-- weekly_scores has 0 production rows (confirmed before writing this) —
-- the one uncomplicated case, safe to replace its unique constraint
-- outright before any real history accumulates. user_email is also
-- relaxed to nullable there (loosening NOT NULL is backward-compatible
-- and affects no existing row, since there are none).
--
-- user_roles is the second, harder exception (added in a correction to
-- this migration, AFTER staging had already verified the first draft's
-- columns/backfill/RLS behaviorally — this section is the only part
-- edited since then; everything else in this file is unchanged from what
-- staging already tested). Its original unique(user_email, role_key) —
-- named user_roles_user_email_role_key_key, confirmed against the live
-- schema — now actively CONFLICTS with the tenant-aware model: it
-- prevents the same person from holding the same operational role in two
-- different tenants, which the whole point of adding tenant_id was to
-- allow. Unlike weekly_scores this table has live data (production: 10
-- rows, 8 resolving to a canonical auth_user_id+tenant_id, 2 unresolved —
-- known before writing this), so replacing its constraint needs the same
-- care as the array-backfill fix in Phase 2B: reason through the actual
-- data before changing what the database enforces, not just before
-- writing the SQL. See step 4 below for the full reasoning and the
-- pre-flight verification query to run before this migration reaches
-- production.

begin;

-- ── 1. New canonical columns ─────────────────────────────────────────
alter table public.user_roles
  add column if not exists auth_user_id uuid,
  add column if not exists tenant_id uuid;

alter table public.qbrs
  add column if not exists auth_user_id uuid,
  add column if not exists tenant_id uuid;

alter table public.weekly_scores
  add column if not exists auth_user_id uuid,
  add column if not exists tenant_id uuid;

alter table public.weekly_scores
  alter column user_email drop not null;

create index if not exists idx_user_roles_auth_user_id on public.user_roles(auth_user_id) where auth_user_id is not null;
create index if not exists idx_user_roles_tenant_id on public.user_roles(tenant_id) where tenant_id is not null;

create index if not exists idx_qbrs_auth_user_date on public.qbrs(auth_user_id, date desc) where auth_user_id is not null;
create index if not exists idx_qbrs_tenant_id on public.qbrs(tenant_id) where tenant_id is not null;

create index if not exists idx_weekly_scores_auth_user_id on public.weekly_scores(auth_user_id) where auth_user_id is not null;
create index if not exists idx_weekly_scores_tenant_id on public.weekly_scores(tenant_id) where tenant_id is not null;

-- ── 2. Backfill: auth_user_id via email match to public.users ─────────
-- Idempotent: only fills rows where auth_user_id is still null.

update public.user_roles ur
set auth_user_id = u.auth_user_id
from public.users u
where ur.auth_user_id is null
  and ur.user_email is not null
  and u.auth_user_id is not null
  and lower(u.user_email) = lower(ur.user_email);

update public.qbrs q
set auth_user_id = u.auth_user_id
from public.users u
where q.auth_user_id is null
  and q.user_email is not null
  and u.auth_user_id is not null
  and lower(u.user_email) = lower(q.user_email);

update public.weekly_scores ws
set auth_user_id = u.auth_user_id
from public.users u
where ws.auth_user_id is null
  and ws.user_email is not null
  and u.auth_user_id is not null
  and lower(u.user_email) = lower(ws.user_email);

-- ── 3. Backfill: tenant_id — joint-x only, active membership required ──
-- Deliberately NOT "whichever tenant they happen to belong to" — scoped
-- to the one tenant that actually uses these tables, and only when that
-- membership is active. A resolved auth_user_id with no active joint-x
-- membership keeps tenant_id null rather than a guessed value.

update public.user_roles ur
set tenant_id = tm.tenant_id
from public.tenant_memberships tm
join public.tenants t on t.id = tm.tenant_id and t.slug = 'joint-x'
where ur.tenant_id is null
  and ur.auth_user_id is not null
  and tm.auth_user_id = ur.auth_user_id
  and tm.status = 'active';

update public.qbrs q
set tenant_id = tm.tenant_id
from public.tenant_memberships tm
join public.tenants t on t.id = tm.tenant_id and t.slug = 'joint-x'
where q.tenant_id is null
  and q.auth_user_id is not null
  and tm.auth_user_id = q.auth_user_id
  and tm.status = 'active';

update public.weekly_scores ws
set tenant_id = tm.tenant_id
from public.tenant_memberships tm
join public.tenants t on t.id = tm.tenant_id and t.slug = 'joint-x'
where ws.tenant_id is null
  and ws.auth_user_id is not null
  and tm.auth_user_id = ws.auth_user_id
  and tm.status = 'active';

-- ── 4. user_roles: replace the global unique constraint with a
--    tenant-aware one, plus a narrow compatibility index for what's
--    left unresolved ────────────────────────────────────────────────
--
-- The original constraint (still in place until this statement runs):
--   unique (user_email, role_key)   -- named user_roles_user_email_role_key_key
-- is GLOBAL - it does not know about tenants at all, so it blocks the
-- same person from holding the same role_key in two different tenants,
-- which the tenant_id column exists specifically to allow. It has to go;
-- the question is only whether dropping it is safe against the 10 rows
-- that currently depend on it.
--
-- Canonical rows (auth_user_id + tenant_id both set): already governed
-- by user_roles_tenant_auth_role_key_key (added just above, unchanged
-- from the first draft of this migration) - unaffected by this drop.
--
-- The 2 unresolved rows: dropping the global constraint with nothing to
-- replace it would let a future insert create an accidental duplicate
-- unresolved row for the same legacy email+role. A narrow partial unique
-- index closes that gap without reintroducing the tenant-blocking
-- problem, since it only applies to rows that AREN'T tenant-resolved:
--
--   unique (lower(user_email), role_key)
--   where (auth_user_id is null or tenant_id is null) and user_email is not null
--
-- Whether this can FAIL to create (a unique index creation fails outright
-- if existing data already violates it - unlike "if not exists", there is
-- no way to make a genuine constraint violation a no-op): the ORIGINAL
-- constraint being dropped was unique(user_email, role_key) - CASE-
-- SENSITIVE plain text equality - and every one of the 10 existing rows
-- already satisfies it today (it's an active, currently-enforced
-- constraint). Since case-sensitive equality is STRICTER than the new
-- index's lower(user_email) comparison, the only way this new index could
-- fail to create is if two rows share a role_key and their user_email
-- values are the same string except for letter case (e.g. 'Amy@x.com' vs
-- 'amy@x.com') - a case the old constraint would have permitted as two
-- distinct values but this one correctly treats as a duplicate. That is a
-- narrow, specific, checkable condition - not something to guess about.
-- Run the pre-flight query below against production BEFORE this
-- migration, and this migration will not be applied to production until
-- that is confirmed clear (per instruction, this session does not run
-- production Supabase). Note also that the whole file is one transaction
-- (begin/commit) - if this index creation DID fail for any reason, the
-- entire migration rolls back atomically; it cannot leave the database in
-- a partially-migrated state.
--
-- Pre-flight query (run in Studio against production BEFORE this
-- migration - not part of the transaction, a read-only check):
--
--   select lower(user_email) as email_ci, role_key, count(*), array_agg(id) as row_ids
--   from public.user_roles
--   where user_email is not null
--   group by lower(user_email), role_key
--   having count(*) > 1;
--
-- Expect ZERO rows back. If this returns any row, DO NOT run this
-- migration until those specific (email, role_key) duplicates are
-- resolved by hand - the migration will otherwise fail cleanly (whole
-- transaction rolled back, nothing partially applied) rather than
-- silently corrupt anything, but it is better caught here first.

alter table public.user_roles
  drop constraint if exists user_roles_user_email_role_key_key;

create unique index if not exists user_roles_tenant_auth_role_key_key
  on public.user_roles (tenant_id, auth_user_id, role_key)
  where tenant_id is not null and auth_user_id is not null;

create unique index if not exists user_roles_unresolved_email_role_key_key
  on public.user_roles (lower(user_email), role_key)
  where (auth_user_id is null or tenant_id is null) and user_email is not null;

-- ── 5. weekly_scores: replace the unique constraint (0 rows — safe) ────
alter table public.weekly_scores
  drop constraint if exists weekly_scores_cycle_id_user_email_week_number_key;

alter table public.weekly_scores
  add constraint weekly_scores_tenant_auth_cycle_week_key
  unique (tenant_id, auth_user_id, cycle_id, week_number);

commit;

-- ── Manual verification only — deliberately not a persistent view ──────
-- Same rationale as Phase 2B: a permanent cross-tenant-risk view isn't
-- worth it for an occasional check. Run manually in Studio:

-- select 'user_roles' as t, id, user_email from public.user_roles where user_email is not null and auth_user_id is null
-- union all
-- select 'user_roles (resolved, no active joint-x membership)', id, user_email from public.user_roles where auth_user_id is not null and tenant_id is null
-- union all
-- select 'qbrs', id, user_email from public.qbrs where user_email is not null and auth_user_id is null
-- union all
-- select 'weekly_scores', id, user_email from public.weekly_scores where user_email is not null and auth_user_id is null
-- order by t;

-- ── Pre-flight only — run this BEFORE the migration, not after ─────────
-- Same query as the one embedded in step 4's comments above, collected
-- here too since this is the section most likely to be copy-pasted from
-- when doing a pre-migration check. Must return ZERO rows before this
-- migration is safe to run against production - see step 4 for the full
-- reasoning (case-sensitive vs case-insensitive email comparison is the
-- only realistic way user_roles_unresolved_email_role_key_key's creation
-- could fail against the existing 10 rows).

-- select lower(user_email) as email_ci, role_key, count(*), array_agg(id) as row_ids
-- from public.user_roles
-- where user_email is not null
-- group by lower(user_email), role_key
-- having count(*) > 1;
