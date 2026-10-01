# OPPS Quote Approve-on-Behalf — Slice 02B-1

## Status

**REHEARSED — not yet applied to production**

## Date

2026-10-01

## References

| | |
|---|---|
| Migration (prepared, not yet applied) | `20260930090000_quote_approve_on_behalf` |
| Rehearsal script | `supabase/tests/quote_approve_on_behalf_rehearsal.sql` |
| Production project | `slhcvyeuqsduaglddqdb` |
| Reference function this slice's guards mirror | `accept_public_quote` |
| `accept_public_quote` full-definition hash (unchanged before/after rehearsal) | `0b1034164d6406b6bc760e14c5986f49` |

This is a completion record for the rehearsal/validation stage only. The
migration has not been applied to production yet — see Status above.

## Background

Operators sometimes need to record that a client approved a quote through
an offline/delegated channel (WhatsApp, phone, in person, email, or on
behalf of a non-technical client), without ever recording it as though
the client clicked "accept" themselves. `public.opps_quotes` and
`public.opps_quote_events` already supported an `actor_kind = 'staff'`
value on both their relevant CHECK constraints before this slice — it was
simply never written by anything. This slice adds the one function that
writes it: `public.accept_quote_on_behalf`.

Authorization is intentionally **not** `public.has_tenant_permission()`.
Live verification (this session, against production) showed the Joint X
tenant currently grants the `*` wildcard permission to `owner`, `admin`,
`member`, and `staff` roles alike in `tenant_access_role_permissions` —
so a permission-string check would pass for every one of those roles, not
just high-trust operators, silently failing to enforce the one constraint
this capability exists for. Until that wildcard grant is separately
reconciled (tracked as a follow-up below, not touched by this migration),
authorization is an explicit, narrow check: `public.is_app_admin()` OR an
active `tenant_memberships` row for the caller on the quote's own
`tenant_id` with `tenant_role in ('owner', 'admin')`.

## What changed (on apply — not yet live)

- Adds `public.accept_quote_on_behalf(p_quote_id, p_expected_revision_number, p_approval_source, p_note)`, `SECURITY DEFINER`, granted to `authenticated` only (never `anon` — unlike `accept_public_quote`, which is reached via an unauthenticated public share link).
- Writes `accepted_actor_kind = 'staff'` and the real operator's `auth.uid()` into `accepted_actor_user_id`.
- `accepted_ack_name` / `accepted_ack_email` are explicitly set to `null` on every call — never populated with anything that could be mistaken for the client's own acknowledgment.
- `accepted_revision_id` always comes from `published_revision_id`, never `current_revision_id` — same invariant as `accept_public_quote`.
- Same fail-closed guards as `accept_public_quote`: quote status must be `sent`/`viewed`/`changes_requested`; the caller's `p_expected_revision_number` must match the live published revision (race guard); `p_approval_source` must be one of a closed enum (`whatsapp`, `phone`, `in_person`, `email`, `assisted`, `other`).
- Writes an `opps_quote_events` row (`event_type='accepted'`, `actor_kind='staff'`) with `metadata.approval_mode='on_behalf'` and `metadata.approval_source` for audit.
- No table is altered. No existing function, policy, or grant is changed.
- Frontend: `QuoteDetailDrawer.jsx` gains an "Approve on behalf of client" dialog (approval source + optional note); `quoteStatus.js` gains the `canApproveQuoteOnBehalf` predicate and `APPROVAL_SOURCE_OPTIONS`; `quotes.js`/`Quotes.jsx` wire the new action through. These frontend changes are already present in this branch and do not depend on the migration being applied — the button/dialog will call an RPC that doesn't exist in production until the migration lands.

## Production validation

*Every step below was run directly against production (project
`slhcvyeuqsduaglddqdb`) by the engineer operating Supabase Studio, from
scripts prepared and reviewed in-session; results were reported back and
reviewed, not executed against production directly by the agent (a
harness-level safety gate blocks direct production SQL execution from
this session regardless of transaction safety).*

- Full rehearsal (migration + 22 tests) run inside a single explicit `BEGIN...ROLLBACK` transaction against the real database.
- Fixture setup required a temporary, transaction-scoped admin JWT claim (reset immediately after fixture setup, before any test's own identity switch) so the rehearsal's own privileged inserts could pass `enforce_approved_admin_role_change()`'s email check.
- Coverage: ordinary `member`, `staff`, `finance`, `manager`, and `production_staff` roles all correctly denied (`QUOTE_APPROVAL_ON_BEHALF_DENIED`); a cross-tenant `owner` and, separately, a literal cross-tenant `admin` both correctly denied; missing/invalid `approval_source` rejected; stale revision number rejected (`QUOTE_PUBLISHED_REVISION_CHANGED`); tenant `owner` success verified field-by-field (status, actor kind/id, null ack fields, correct accepted revision, event row + metadata, actor label/email resolution); a second acceptance attempt on an already-accepted quote rejected (`QUOTE_NOT_ACCEPTABLE`); tenant `admin` success verified the same way on a separate disposable quote; app-admin success (via `public.users.role='admin'`, independent of any `tenant_memberships` row on the quote's own tenant) verified the same way on a third disposable quote.
- One rehearsal defect found and fixed during this process: the app-admin test's fixture-integrity guard originally asserted the disposable app-admin user had *zero* `tenant_memberships` rows anywhere, which is structurally false in this production schema — inserting a `public.users` row with `role='admin'` auto-enrolls that user into the real `'joint-x'` tenant via a separate, pre-existing, intentional trigger (`add_internal_user_to_joint_x_team()`, confirmed unchanged and present in tracked migration history, `202606230006_fix_internal_order_access.sql`). The guard was corrected to check membership scoped to the quote's own disposable tenant only, which is what the authorization predicate actually depends on.
- A second defect found and fixed: verification `SELECT`s run immediately after a successful RPC call, while the postgres session `role` was still switched to the disposable test identity's `'authenticated'`, were filtered out by RLS. Fixed by issuing `RESET ROLE` before each post-call verification read (and re-establishing `'authenticated'` before the next test that needed it).
- Rollback residue after the full rehearsal: 0 disposable tenants, 0 `auth.users`/`public.users`, 0 `tenant_memberships`, 0 `opps_quotes`, 0 `opps_quote_revisions`, 0 `opps_quote_events`.
- `public.accept_quote_on_behalf` confirmed absent after rollback (not yet applied).
- `public.accept_public_quote` full-definition hash confirmed unchanged after rollback: `0b1034164d6406b6bc760e14c5986f49`.
- No migration bookkeeping entry exists for `20260930090000_quote_approve_on_behalf` in `supabase_migrations.schema_migrations` — confirming `supabase db push` was never invoked and the migration is not live.

## Follow-ups (not fixed in this slice)

- Joint X member/staff wildcard RBAC reconciliation — the `*` wildcard permission currently granted to `owner`, `admin`, `member`, and `staff` roles alike in `tenant_access_role_permissions`, which is why this slice's authorization deliberately bypasses `has_tenant_permission()` rather than relying on it.
- My Hub / Directory / role visibility audit.
- `tenant_memberships.tenant_role` CHECK constraint migration-history gap — the live constraint admits `owner`, `admin`, `member`, `staff`, `manager`, `counter_staff`, `production_staff`, `finance`, and `partner_viewer` (confirmed live via `20260926205000_cafe_access_04_counter_staff_role.sql:4`), but the `ALTER TABLE` that widened it from the original `('owner', 'admin', 'member')` (`202606200001_multi_tenant_foundation.sql:24`) could not be located anywhere in this repo's tracked migration history.
