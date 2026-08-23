# Managed Clients Control Plane — Phase 0/1

OPPS internal control plane for Joint X-operated brands, sites, and client
workspaces — distinct from **Normal Clients** (`src/pages/Clients.jsx`),
which is the CRM/customer-record surface. This phase recovers the
surviving legacy database model and reconciles it with the modern XOS
tenant architecture; it does not migrate, rewrite, or provision anything.

## Two generations of managed-brand data

- **Legacy**: `public.managed_client_workspaces` — a surviving table that
  predates the XOS tenant architecture. It carries brand/site
  identity (`client_type`, `site_type`), readiness tracking (`assets_status`,
  `content_status`, `products_services_status`, `pricing_status`,
  `mockup_status`, `launch_readiness_status`, `domain_status`), site/infra
  fields (`preview_url`, `live_url`, `domain_name`, `site_repo_url`,
  `storefront_status`), and work tracking (`next_action`,
  `next_action_owner`, `next_action_due_at`, `launch_target_date`,
  `internal_notes`). 3 rows currently survive (Siya Mnisi, Xilaveko
  Bilankulu, Dr Ndamane) — all point at the Joint X system tenant; their
  linked `public.clients` rows are also still Joint-X-scoped, i.e. none of
  them have been migrated to a dedicated tenant. This migration does not
  touch this table's schema or rows, and does not add a competing table.
- **Modern**: tenant → client → `tenant_domains` → `tenant_memberships` →
  `tenant_capabilities` → Commerce, the architecture every new managed
  brand (e.g. God's Spoilt Brat) now uses. See
  `supabase/provisioning/xos_tenant_provisioning_template.sql` for the
  provisioning contract. A modern managed tenant may have **no**
  `managed_client_workspaces` row at all yet — GSB has none. That is an
  expected, valid state, not an error.

## Reconciliation identity rule

`admin_list_managed_clients()` (in `supabase/migrations/20260823140000_managed_clients_control_plane.sql`)
builds the unified projection as follows:

1. **`modern_tenants`**: every tenant that is an actual managed brand.
   Slug naming (`slug <> 'joint-x'` and `slug !~* '(^|-)(qa|demo|test)(-|$)'`,
   matching how every fixture tenant in this codebase's own test suites is
   named) is used only as an **exclusion** heuristic - not as the sole
   inclusion signal (post-review: relying on naming alone was flagged as
   not durable). A tenant only qualifies when it *also* has a linked
   `public.clients` row **and** at least one positive, structural sign of
   being live managed-brand infrastructure: an active `xos_admin` or
   `storefront` `tenant_domains` row, or an enabled `tenant_capabilities`
   row. There is no dedicated tenant "type" column in the current schema
   (`tenants.settings` is empty `{}` on every tenant today) - this is the
   closest available structural proxy, and it is documented here
   explicitly rather than left implicit.
2. **`tenant_primary_client`**: one representative `public.clients` row
   per modern tenant — the provisioning template creates exactly one; the
   oldest is chosen if more than one ever exists, for a stable pick.
3. **`modern_rows`**: for each modern tenant, LEFT JOIN a
   `managed_client_workspaces` row matching **both** `client_id = pc.id`
   **and** `tenant_id = mt.id` (post-review: `client_id` alone is not
   sufficient - the table's real uniqueness is `(tenant_id, client_id)`; a
   workspace whose `tenant_id` disagrees with its own client's current
   tenant is a data-integrity anomaly and must never be silently absorbed
   into a modern tenant's row), plus `tenant_domains`/
   `tenant_capabilities`/`commerce.products` counts. A modern tenant is
   always emitted, workspace or not — this is what makes GSB appear
   automatically with no legacy row.
4. **`legacy_rows`**: every `managed_client_workspaces` row that did
   **not** match on that same `(client_id, tenant_id)` pair is emitted as
   its own legacy-only entry, always with `tenant_id = null` in the
   projection - never the workspace's own raw `tenant_id` (which could be
   Joint X, or in a future mismatch scenario a real modern tenant it
   nonetheless doesn't safely belong to), so a legacy row can never
   misleadingly present a Commerce-eligible tenant identity. Because this
   exclusion uses the exact same join key as the inclusion in step 3, no
   workspace row can ever be silently dropped, and no managed brand is
   ever listed twice - including a future tenant/client-mismatched
   workspace row, which now stays independently visible as its own
   legacy/reconciliation-needed record rather than being absorbed.

Result today: 1 modern-only row (GSB) + 3 legacy-only rows (the surviving
historical workspaces) = 4 managed brands. Confirmed against production,
read-only, during this task.

**Commerce eligibility.** A legacy-only row's `client_id` is real, but
that client still belongs to the Joint X tenant (XOS 3B derives the
Commerce tenant from `public.clients.tenant_id`), so onboarding Commerce
from a legacy-only row would create/link Commerce state under Joint X -
architecturally wrong (post-review blocker). The RPC still returns
`client_id` for every row (the frontend needs it regardless, e.g. to link
to the Clients page), but `src/pages/ManagedClients.jsx`'s
`isCommerceEligible(row)` - `Boolean(row.tenant_id) && (row.source ===
"modern" || row.source === "both")` - gates whether `CommerceProductsSection`
renders at all; a legacy-only row shows a read-only explanatory message
instead of "Add product".

## Staff-safe API

`admin_list_managed_clients()` gates on `is_opps_staff()` alone (the same
corrected pattern XOS 3B established — see that migration's header note):
production RLS on `managed_client_workspaces` itself
(`xos1_require_opps_staff USING is_opps_staff()`, restrictive, plus a
permissive `is_app_admin() OR can_access_tenant(tenant_id)` policy) would
have exactly the same cross-tenant staff-visibility gap already fixed for
`clients`/`orders` in PR #33 — direct table access works for the 3
historical rows (their `tenant_id` is Joint X, which staff are always
members of) but would fail for a future modern-tenant workspace row
unless the staff member is `is_app_admin()`. It is `SECURITY DEFINER`,
`set search_path`, revokes `EXECUTE` from `PUBLIC`/`anon`, grants to
`authenticated` only, and returns an explicitly allowlisted field set (no
`select *`, no raw `auth.users` exposure — the `access` array's `email` is
resolved as `coalesce(public.users.user_email, auth.users.email)`, so a
real active membership like GSB's owner is never misrepresented as
`Unknown` just because no `public.users` profile row happens to exist yet
for that auth identity - `auth.users` itself is never exposed beyond that
one derived column, matching the same reasoning as `is_opps_staff()`'s and
`apply_invoice_order_sync`'s existing auth.users-derived-email patterns).
Used for both the index page and (client-side lookup by `key`) the detail
view — no separate detail RPC, avoiding duplicate logic.

**No write RPC in this phase (post-review).** An earlier revision also
added `admin_update_managed_client_workspace(p_workspace_id, p_updates)`,
a narrow allowlisted write path for legacy workspace fields. It was
**removed** before final review: nothing in this phase's UI calls it (the
detail view is deliberately read-only), and shipping an unused write
surface widens the production change surface without giving the operator
any new capability yet. Legacy workspace editing is next-phase work, and
should ship with its own dedicated mutation test matrix alongside the UI
that actually calls it, not ahead of either.

## Commerce Products

Reused as-is: `src/components/commerce/CommerceProductsSection.jsx` was
extracted out of `src/pages/Clients.jsx` (previously a local, unexported
component) into a shared component, imported by both `Clients.jsx` and
`ManagedClients.jsx`. It still calls the existing XOS 3B RPCs
(`admin_get_client_commerce_products`, `admin_onboard_client_commerce_product`,
`admin_get_client_commerce_onboarding_options`) unchanged — no new product
system, no duplicated onboarding flow.

## Vercel / Supabase infrastructure fields

The surviving schema does **not** contain `vercel_url`/`supabase_url`
columns. Repo-wide inspection found no existing Vercel/Supabase project
reference metadata stored anywhere else either. Current generic
infrastructure fields are `preview_url`, `live_url`, `domain_name`,
`site_repo_url` — this phase surfaces only those, verified/stored fields.
Explicit Vercel/Supabase project metadata (and secrets, which must never
be stored here regardless) is a **future schema extension**, not
fabricated in this phase.

## UI

- New nav item "Managed Clients" (`src/Layout.jsx`, between "Clients" and
  "Projects"), registered as a page in `src/pages.config.js`.
- **Index** (`ManagedClients`): header, subtext, "+ Add Managed Brand" CTA,
  4-stat summary (managed brands / sites live / XOS live / needs
  attention — all frontend-derived from fields the RPC already returns,
  not separately stored), search, card grid.
- **Detail**: a dialog (matching `Clients.jsx`'s `ClientAccountDialog`
  pattern) with Overview / Site-Website / Readiness / Work / XOS / Access
  / Commerce Products sections, populated entirely from one
  `admin_list_managed_clients()` row. Overview shows **Tenant status**
  (the modern tenant's own active/inactive state, from `tenant_status`)
  separately from **Site status** (the legacy workspace's site readiness,
  from `site_status`) - post-review fix: GSB shows `Tenant status: Active`
  / `Site status: Not configured`, not a single conflated "Status" field
  that would have nothing accurate to show for a modern tenant with no
  workspace yet. Commerce Products only renders when `isCommerceEligible(row)`
  - see "Commerce eligibility" above; a legacy-only row shows a read-only
  explanatory message instead.
- **Add Managed Brand**: opens a dialog that stops at "Provisioning
  workflow not activated yet", pointing at
  `supabase/provisioning/xos_tenant_provisioning_template.sql` as the
  existing contract a future phase should build on (tenant → client → XOS
  domain → owner membership, optionally linking/creating a
  `managed_client_workspaces` row afterward). No production writes.

## Tests

**SQL (`supabase/tests/managed_clients_control_plane.sql`)** — disposable,
rollback-wrapped, performs **zero persistent application-table writes**:
the only `INSERT`s target a `create temporary table` (`test_results`,
never persisted regardless of commit/rollback); every assertion reads real
existing production data (`admin_list_managed_clients()` itself, GSB, the
3 historical workspace rows, the real `tenant-a-qa`/`tenant-b-qa`/
`demo-xos`/`joint-x` tenants) via `SELECT`, and simulates a caller purely
via `set_config('request.jwt.claims', ...)` (session-local, not a write).
The staff identity used is resolved **dynamically at run time** using the
exact same authority definition `is_opps_staff()` itself uses (active
`public.users` + active `tenant_membership` + active `joint-x` tenant) -
post-review fix: a prior revision hardcoded a real person's auth UUID
directly in the committed file, which the test now looks up instead,
failing loudly if no such identity currently exists. Covers: staff can
list; a non-staff user is denied; GSB appears exactly once; GSB's commerce
count is 0 and its storefront/workspace fields are correctly null (not
fabricated); GSB's `tenant_status` (`active`) is distinct from its (null)
`site_status`; GSB's owner access entry resolves a non-null email via the
`auth.users` fallback and carries only `email`/`role`/`status`; all 3
historical rows appear with their real, unchanged statuses and with
`tenant_id = null` (the Commerce-guard precondition); Joint X and QA/demo
tenants are excluded; the returned fields are allowlisted (no secrets);
and a final explicit pass/fail gate fails the command on any assertion
failure.

**Not yet executed against production** — this task's brief requires
read-only production access throughout implementation and review. Every
verification step used only `SELECT`/`information_schema`/`pg_constraint`/
`pg_policy` queries. Run with:

```
supabase db query --linked --file supabase/tests/managed_clients_control_plane.sql
```

only once write access for this phase is explicitly authorized.

**JS (`tests/managed-clients-control-plane.test.mjs`)** — pure static
source-inspection tests (matching the existing
`tests/client-products-source-identity-uniqueness.test.mjs` convention;
this repo has no live-database harness reachable from `node --test`), so
these run for real, right now, with zero database/network access. They
guard the committed shape of the review-driven fixes directly: the
workspace join requires both `client_id` and `tenant_id`; the legacy
exclusion uses the identical key; legacy rows always project `tenant_id`
as `null`; `modern_tenants` requires the client-row and domain/capability
structural signals, not slug alone; the `access` email resolution and
allowlist; `tenant_status` is present on both row shapes; the write RPC
and its frontend wrapper are both absent; and the detail page's Commerce
section is gated behind `isCommerceEligible(row)`. All 8 pass.
