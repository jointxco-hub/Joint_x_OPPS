# Managed Clients Control Plane — Phase 0/1 & Phase 2

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
allowlist; `tenant_status` is present on both row shapes; the Phase 0/1
migration file itself still never defines the write RPC (Phase 2
reintroduces it in its own new migration - see below); and the detail
page's Commerce section is gated behind `isCommerceEligible(row)`. All 8
pass.

---

## Phase 2 — Operator Workspace + Safe Managed Brand Provisioning

Builds on Phase 0/1 without editing its already-applied migration
(`20260823140000`). All Phase 2 DB work lives in a NEW migration,
`supabase/migrations/20260824090000_managed_clients_phase2_operations.sql`.
Continues using exactly the same tables Phase 0/1 established - no
competing managed-client model.

### Authority model

`admin_list_managed_clients()` stays `is_opps_staff()`-gated - unchanged,
still the cross-tenant staff READ surface. Every Phase 2
mutation/provisioning/preflight RPC instead requires
`public.is_app_admin()` - these are high-impact operations (editing
production workspace state, creating tenants/clients/domains/
memberships, activating a live XOS hostname), not ordinary staff-read
visibility. No browser INSERT/UPDATE ever touches `tenants`, `clients`,
`tenant_domains`, `tenant_memberships`, `tenant_capabilities`, or
`managed_client_workspaces` directly - every write goes through a
narrow, allowlisted, `SECURITY DEFINER` RPC.

### Workspace editing (Part A)

`admin_update_managed_client_workspace(p_workspace_id, p_updates)` -
app-admin-only, reintroduces the mutation Phase 0/1 deliberately removed
(it had no caller then). `p_updates` is validated against a 20-field
allowlist (`_validate_managed_workspace_update_keys`) shared with Part B
- an unknown key is rejected outright, never silently ignored. Every
allowed field uses `CASE WHEN p_updates ? 'key' THEN ... ELSE <existing>
END`, so an omitted key is preserved and a JSON `null` for a nullable
field clears it to SQL `NULL` - no separate "clear" flag needed.
`onboarding_stage`/`client_type`/`site_type` still reject invalid values
via the table's own `CHECK` constraints. No identity column
(`id`/`tenant_id`/`client_id`/`business_id`/`brand_id`/`storefront_id`/
`created_at`) is ever in the allowlist or the `UPDATE ... SET` list.
Writes an `opps_activity_events` row (`managed_client_workspace_updated`)
with the changed key list.

### Workspace initialization for a modern tenant with none (Part B)

`admin_initialize_managed_client_workspace(p_tenant_id, p_workspace)` -
app-admin-only. The browser supplies only the tenant id and optional
workspace fields; the canonical client is resolved server-side
(`tenant_id` filter on `public.clients`), and an **ambiguous** match
(more than one client row for that tenant) is rejected outright rather
than guessed at - stricter than the read model's display-only "pick the
oldest" convenience, because a write must never guess. Rejects
joint-x/system/QA/demo/test tenants and any tenant that doesn't pass the
same structural eligibility rule the read model uses (see below).
Rejects if a workspace already exists for that tenant/client pair. Used
by the UI's "Set up workspace" action - GSB is the first real candidate,
but this migration does **not** call it for GSB; that's a reviewed,
authorized follow-up action.

### Safe Add Managed Brand provisioning (Parts C/D)

`admin_preview_managed_brand_provisioning(p_input)` - app-admin-only,
read-only. Normalizes the tenant slug server-side
(`_normalize_managed_brand_slug`), derives the hostname as
`<slug>.xos.jointx.co.za` (the browser never supplies a hostname), and
checks slug/hostname/client-email availability plus whether an
`auth.users` account exists with that exact canonical email
(case-insensitive). The owner lookup is a single query - `select ...
from auth.users where lower(email) = lower(p_input->>'client_email')` -
so "owner account exists" and "email matches" are coupled by
construction; a true mismatch state cannot occur in this design (see the
function's own header note and the SQL test asserting this invariant).
Returns only booleans/derived strings and a human-readable blocker list -
**never** `auth_user_id`.

`admin_provision_managed_brand(p_input, p_idempotency_key)` - app-admin-
only, atomic. Re-validates everything the preview already checked (never
trusts the earlier preview call - state can change between the two calls),
then provisions in dependency order inside one transaction: tenant →
client → XOS domain (**pending**, never active) → owner membership →
optional products capability → workspace. Any failure means zero partial
provisioning - one plpgsql function body is already one implicit
transactional block, so an exception anywhere rolls back every earlier
insert in the same call. `auth_user_id` is resolved and used internally
only; never returned or stored.

### Idempotency

A dedicated ledger, `public.managed_brand_provisioning_operations`
(`idempotency_key` primary key, `request_fingerprint`, `result jsonb`) -
deliberately **not** `commerce.onboarding_operations`, which is a
Commerce-product-onboarding ledger, not a generic one; reusing it would
conflate two unrelated idempotency domains under one key namespace. Same
`pg_advisory_xact_lock` + ledger pattern already proven in XOS 3B's
`admin_onboard_client_commerce_product`. A second advisory lock, keyed on
the normalized slug, additionally serializes two *different*
idempotency-key calls racing to provision the same slug (the first lock
alone only protects retries of one call). Same key + same payload
returns the original result; same key + different payload raises
`MANAGED_BRAND_IDEMPOTENCY_CONFLICT`.

### XOS domain: pending until explicit Vercel activation (Part E)

The old manual template
(`supabase/provisioning/xos_tenant_provisioning_template.sql`) inserts
`tenant_domains.status = 'active'` directly, because a human operator
manually verifies the Vercel attachment before ever running it. The new
UI-driven provisioner has no such guarantee - a database row can never
prove Vercel is actually serving the hostname - so it always inserts
`status = 'pending'`. `admin_activate_managed_xos_domain(p_tenant_id)` -
app-admin-only - is the *only* path to `active`: it accepts just a
tenant id (never an arbitrary hostname), locates that tenant's own
primary `xos_admin` domain, allows only `pending`/`verified` → `active`,
and is idempotent if already active. The UI gates the call behind an
explicit "I confirm this hostname is attached to the correct Vercel
project" checkbox - provisioning (step 5) and activation (step 6) are
never combined automatically.

### Products capability (Part F)

`admin_set_managed_tenant_products_capability(p_tenant_id, p_enabled)` -
app-admin-only. Reuses the existing `tenant_capabilities` authority as-is
(no new module system), scoped to `capability_key = 'products'` only.
Never touches `commerce.products` - turning the capability off only
controls the XOS-side flag, never deletes or alters any Commerce
product.

### Unified read model refinement

`admin_list_managed_clients()` is `CREATE OR REPLACE`d in the **new**
Phase 2 migration only - the applied Phase 0/1 file is untouched. The
only logical change is `modern_tenants`' eligibility rule, now delegated
to a shared helper, `public._is_eligible_managed_tenant(tenant_id)`: a
linked `public.clients` row AND at least one of a matching
`managed_client_workspaces` row, a **non-disabled** (pending, verified,
*or* active - not just active) `xos_admin`/`storefront` domain, or an
enabled `tenant_capabilities` row. This is what lets a freshly
provisioned brand (domain status `pending`) appear immediately instead of
being hidden until someone remembers to run the activation step. The
same helper is reused by Part B and Part F's tenant-eligibility checks -
one source of truth, never duplicated. Legacy modernization is still
explicitly deferred - see the "Reconciliation identity rule" section
above, unchanged.

### Legacy workspaces stay legacy

Phase 2 lets staff edit a legacy workspace's own site/readiness/work
fields via the same `admin_update_managed_client_workspace` RPC, but
never changes `clients.tenant_id`, never creates a replacement client
mapping, and never unlocks Commerce for it - `isCommerceEligible(row)`
is unchanged from Phase 0/1. The detail view shows an explicit "Legacy
tenant reconciliation is a separate migration phase" message for every
legacy-only row.

### UI

- **Legacy row**: "Edit Workspace" button opens `WorkspaceFormDialog`
  (mode `edit`) - selects for `client_type`/`site_type`/
  `onboarding_stage`, plain inputs for the rest, a textarea for internal
  notes. No Commerce/XOS controls.
- **Modern, no workspace (GSB today)**: "Set up workspace" opens the same
  dialog (mode `init`), calling `admin_initialize_managed_client_workspace`
  instead. Commerce remains available immediately (its modern tenant
  identity already exists) regardless of workspace state.
- **Modern, with workspace**: "Edit Workspace" (mode `edit`), plus
  `ProductsCapabilityCard` (a `Switch`) and `XosActivationCard` (hidden
  once `xos_status === 'active'`).
- **Add Managed Brand wizard** (`AddManagedBrandWizard`, six steps: Brand
  → Workspace → Owner/Preflight → Review → Provision → External
  activation): a fresh `crypto.randomUUID()` idempotency key is generated
  once per wizard mount (same convention as
  `CommerceProductsSection`). The preflight step surfaces "Owner account
  required" verbatim when no matching `auth.users` account exists. The
  Provision button is disabled until preflight's `can_provision` is
  true. Step 6 (external activation) is a separate screen with its own
  confirmation checkbox and `Activate XOS` button - never auto-triggered
  by a successful provision.
- All new components live in
  `src/components/managedClients/ManagedClientOperations.jsx` (repo
  convention: `eslint.config.js` only lints `src/components/**`/
  `src/pages/**`/`src/Layout.jsx`, matching where
  `CommerceProductsSection.jsx` already lives).

### Tests

**SQL (`supabase/tests/managed_clients_phase2_operations.sql`)** -
rollback-wrapped, but UNLIKE the Phase 0/1 suite, this one performs real
application-table writes (it exercises the actual mutation/provisioning
RPCs) - every one of them is inside the file's single
`begin;`/`rollback;`, which is what guarantees none of it persists (a
single `supabase db query --file` invocation is one transaction, so
"after rollback" cannot be queried from inside the same file - that is
confirmed separately via a genuinely read-only query after the suite
completes, same as Phase 0/1's own final-verification step). Two
identities are resolved dynamically (never a hardcoded real person's auth
UUID): an OPPS staff identity (reused from Phase 0/1's own query, for the
read-model checks) and an app-admin identity
(`public.users.role = 'admin'`, for every Part A-F call). Covers: non-
admin denial for every mutating RPC; preflight slug normalization/
hostname derivation/conflict detection (slug, hostname, and client-email
conflicts tested independently); the owner-account-required rejection;
the `email_match`/`owner_account_exists` invariant; a full happy-path
provisioning creating exactly one of each dependency row, with the
domain left `pending`; idempotency replay (same key/same payload returns
the original result, same key/different payload conflicts, no
duplicate rows survive multiple attempts); initializing GSB's real (but
currently absent) workspace, server-side client resolution, system-tenant
rejection, and duplicate-initialization rejection; workspace update
(allowed-field changes, identity-key rejection, unknown-key rejection,
invalid-constrained-value rejection via the table's own `CHECK`
constraints, and intentional nullable-field clearing); the products
capability toggle (and that it never touches `commerce.products`); XOS
activation (pending → active, idempotent re-activation, system-tenant
rejection); and that the 3 historical legacy rows and GSB's Commerce
count remain correct in the unified projection despite all of the above.
**Not yet executed against production** - same read-only constraint as
Phase 0/1, and the Phase 2 migration itself has not been applied yet
either.

**JS (`tests/managed-clients-phase2-operations.test.mjs`)** - pure static
source-inspection tests, same convention as the Phase 0/1 suite, so these
run for real right now with zero database/network access: the nav gate
keeps `adminOnly: true`; legacy rows still never render Commerce
onboarding; the modern-no-workspace/has-workspace button branching;
`WorkspaceFormDialog`'s mode selection; the provisioning wizard never
sends a hostname to the RPC; the XOS activation card never presents
`pending` as live and requires its confirmation checkbox; the wizard's
own provision/activation gating and single-generation idempotency key;
the owner-account-required copy; the capability toggle never calls a
product-deletion function; the workspace form's field set excludes every
identity column; every Phase 2 RPC gates on `is_app_admin()` (never
`is_opps_staff()` alone); `admin_list_managed_clients()` stays
`is_opps_staff()`-gated; the XOS domain is always inserted `pending` and
activation never accepts a hostname parameter; provisioning/preview never
return `auth_user_id`; the workspace-update `SET` clause never assigns an
identity column; workspace-initialize rejects ambiguous client matches;
the idempotency ledger is its own table, never reusing
`commerce.onboarding_operations`; and the refined eligibility rule
accepts any non-disabled domain status. All 21 pass. (The Phase 0/1 suite
was updated in place: its "write RPC removed" test now only asserts the
already-applied `20260823140000` file itself was never retroactively
edited to add the RPC - Phase 2 deliberately reintroduces it in a new
migration once a real caller exists, so the old "must be absent
everywhere" assertion is now obsolete by design, not a regression. All 8
still pass.)
