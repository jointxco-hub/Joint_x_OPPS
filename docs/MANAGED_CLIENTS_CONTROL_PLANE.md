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

1. **`modern_tenants`**: every tenant that is an actual managed brand —
   excludes the Joint X system tenant (`slug = 'joint-x'`, the same slug
   `is_opps_staff()` itself already treats as the system tenant) and
   QA/demo/test fixture tenants, matched by naming convention
   (`slug !~* '(^|-)(qa|demo|test)(-|$)'`). There is no structural tenant
   "type" column in the current schema to key off instead — production
   only has `tenants.slug`/`tenants.name`/`tenants.settings` (`settings`
   is empty `{}` on every tenant today), so the naming convention is the
   only available signal, and it is documented here explicitly rather than
   left implicit.
2. **`tenant_primary_client`**: one representative `public.clients` row
   per modern tenant — the provisioning template creates exactly one; the
   oldest is chosen if more than one ever exists, for a stable pick.
3. **`modern_rows`**: for each modern tenant, LEFT JOIN its primary
   client's `managed_client_workspaces` row (if any) and its
   `tenant_domains`/`tenant_capabilities`/`commerce.products` counts. A
   modern tenant is always emitted, workspace or not — this is what makes
   GSB appear automatically with no legacy row.
4. **`legacy_rows`**: every `managed_client_workspaces` row whose
   `client_id` did **not** match any `tenant_primary_client` row is
   emitted as its own legacy-only entry. Because this exclusion uses the
   exact same join key as the inclusion in step 3, no workspace row can
   ever be silently dropped, and no managed brand is ever listed twice.

Result today: 1 modern-only row (GSB) + 3 legacy-only rows (the surviving
historical workspaces) = 4 managed brands. Confirmed against production,
read-only, during this task.

## Staff-safe API

Both RPCs gate on `is_opps_staff()` alone (the same corrected pattern XOS
3B established — see that migration's header note): production RLS on
`managed_client_workspaces` itself (`xos1_require_opps_staff USING
is_opps_staff()`, restrictive, plus a permissive `is_app_admin() OR
can_access_tenant(tenant_id)` policy) would have exactly the same
cross-tenant staff-visibility gap already fixed for `clients`/`orders` in
PR #33 — direct table access works for the 3 historical rows (their
`tenant_id` is Joint X, which staff are always members of) but would fail
for a future modern-tenant workspace row unless the staff member is
`is_app_admin()`. Both RPCs are `SECURITY DEFINER`, `set search_path`,
revoke `EXECUTE` from `PUBLIC`/`anon`, grant to `authenticated` only, and
return an explicitly allowlisted field set (no `select *`, no raw
`auth.users` exposure — only `public.users.user_email`, the same derived-
email pattern `is_opps_staff()` and `apply_invoice_order_sync` already
use).

- **`admin_list_managed_clients()`** — the unified read model described
  above. Used for both the index page and (client-side lookup by `key`)
  the detail view — no separate detail RPC, avoiding duplicate logic.
- **`admin_update_managed_client_workspace(p_workspace_id, p_updates)`** —
  narrow, allowlisted write path for **legacy workspace fields only**.
  `p_workspace_id` must already exist; this never creates a
  `managed_client_workspaces` row (so it cannot be used to give GSB one -
  that is a separate, explicit reconciliation action for a later phase).
  `id`/`tenant_id`/`client_id`/`business_id`/`brand_id`/`storefront_id`/
  `created_at` are never in the `SET` list, so no caller input can ever
  reassign identity/mapping fields. **Not wired into the UI in this
  phase** — the detail view is read-only; this RPC exists and is ready,
  but editing is deliberately deferred (Phase 0/1 is recovery/
  reconciliation, not full CRUD, and nothing in the acceptance criteria
  requires an edit UI yet).

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
  `admin_list_managed_clients()` row.
- **Add Managed Brand**: opens a dialog that stops at "Provisioning
  workflow not activated yet", pointing at
  `supabase/provisioning/xos_tenant_provisioning_template.sql` as the
  existing contract a future phase should build on (tenant → client → XOS
  domain → owner membership, optionally linking/creating a
  `managed_client_workspaces` row afterward). No production writes.

## Tests

`supabase/tests/managed_clients_control_plane.sql` — disposable,
rollback-wrapped, but writes **zero fixture rows**: every assertion reads
real existing production data (`admin_list_managed_clients()` itself, GSB,
the 3 historical workspace rows, the real `tenant-a-qa`/`tenant-b-qa`/
`demo-xos`/`joint-x` tenants) via `SELECT`, and simulates a caller purely
via `set_config('request.jwt.claims', ...)` (session-local, not a write) -
the same identity-simulation technique every XOS 3B suite already used.
Covers: staff can list; GSB appears exactly once; GSB's commerce count is
0 and its storefront/workspace fields are correctly null (not fabricated);
all 3 historical rows appear with their real, unchanged statuses; Joint X
and QA/demo tenants are excluded; a non-staff user is denied; the
returned fields are allowlisted (no secrets); and a final explicit
pass/fail gate fails the command on any assertion failure.

**Not yet executed against production** — this task's brief requires
read-only production access throughout implementation and review. Every
verification step used only `SELECT`/`information_schema`/`pg_constraint`
queries. Run with:

```
supabase db query --linked --file supabase/tests/managed_clients_control_plane.sql
```

only once write access for this phase is explicitly authorized.
