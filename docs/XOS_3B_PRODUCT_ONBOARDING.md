# XOS 3B — Product Onboarding & Ecosystem Reconciliation

Internal, staff-only workflow that lets OPPS staff establish a Commerce
product once and connect it across Commerce, the managed client-account
layer, OPPS, and the shared X LAB catalog — through the existing identity
bridge (`commerce.product_links`), not a bespoke sync mechanism. XOS itself
remains read-only for Products; nothing in this phase is reachable by a
normal authenticated tenant/client user.

Builds on [XOS 3A](./XOS_3A_PRODUCTS_FOUNDATION.md) — read that first for
the base `commerce.products` / `commerce.product_variants` /
`commerce.product_links` schema and the client-facing read RPCs
(`get_xos_products_for_host`, `get_xos_product_summary_for_host`,
`get_xos_capabilities_for_host`). This phase adds no changes to any of
those; XOS's own Products page is unmodified.

## Authority contract

| System | Owns |
|---|---|
| **Commerce** (`commerce.products`) | Canonical commercial product identity, retail name/description/price/sale price, public variants, draft/published/archived state, storefront-facing primary image. |
| **`public.client_products`** | Managed client-account relationship, client-specific reorder setup, approval/revision lifecycle, artwork, managed-service price, production instructions tied to the managed relationship. |
| **`public.products` (OPPS)** | Operational product identity, production-facing config, operational status. |
| **OPPS Inventory** | Physical stock truth. Never touched by this phase. |
| **`public.xlab_products`** | Reusable/shared X LAB catalog identity — no `tenant_id`, not owned by any one tenant. |

Commerce retail price and `client_products.client_price` are deliberately
independent — neither is ever silently copied into the other. Commerce
never becomes an inventory ledger; `client_products` never becomes the
universal retail catalog; X LAB templates never become tenant-owned.

## Identity path (unchanged, reused)

```
commerce.products
       |
commerce.product_links
       |
public.client_products
    |             |
xlab_product_id   opps_product_id
    |             |
xlab_products     products
```

## What this migration adds

`supabase/migrations/20260823120000_xos_3b_product_onboarding.sql`:

- **`commerce.onboarding_operations`** — a narrow idempotency ledger
  (`idempotency_key` primary key, `request_fingerprint`, cached `result`).
  RLS enabled with zero policies (SECURITY DEFINER only), same pattern as
  the rest of the `commerce` schema.
- **`admin_onboard_client_commerce_product(p_client_id, p_product, p_variants, p_existing_client_product_id, p_existing_opps_product_id, p_existing_xlab_product_id, p_idempotency_key)`**
  — the atomic onboarding RPC.
- **`admin_get_client_commerce_products(p_client_id)`** — staff-safe
  integration-health read, returning one projection per linked commerce
  product: `commerce_product`, `client_product.linked`, `xlab.linked`,
  `opps.linked`, `integration_status` (`complete` | `needs_opps_mapping`).
  Internal OPPS data only — never merged into `get_xos_products_for_host`.

Both RPCs are `SECURITY DEFINER`, revoke `EXECUTE` from `PUBLIC`/`anon`,
grant to `authenticated`, and gate internally with
`public.is_opps_staff() and public.can_access_tenant(<tenant resolved from
public.clients server-side>)` — the same pattern already used by
`find_or_create_client_product_artwork_from_asset` and the `client_products`
"Staff manage client products" RLS policy. Tenant is always derived from
`p_client_id` via `public.clients`, never trusted from caller input.

No OPPS product-creation RPC exists anywhere in this repo (confirmed by
inspection — only a one-off demo-data seed insert). This phase does not add
one: `admin_onboard_client_commerce_product` may **link** an existing
`public.products` row; it never inserts one. Absence of a link surfaces as
`integration_status: 'needs_opps_mapping'`, never a silent auto-create.

## Two onboarding paths

- **Path 1 — existing managed product**: pass `p_existing_client_product_id`.
  Verified against the selected client and its tenant. The row is never
  duplicated; an already-set `opps_product_id`/`xlab_product_id` on it is
  re-verified and its `product_links` row ensured (self-healing). A param
  only fills a currently-null field — it never silently overwrites an
  already-different established mapping.
- **Path 2 — new managed product**: no existing `client_products` row is
  passed. A shell is created with safe defaults (`status: draft`,
  `visible_in_account: false`, `reorder_enabled: true`, no approval
  metadata, no OPPS/X LAB mapping unless explicitly supplied in the call).

Either path locates-or-creates the Commerce product via the existing
`client_product` link (never a second Commerce product for the same
managed relationship), then atomically replaces its variant set from
`p_variants`.

## Idempotency

`p_idempotency_key` is required (carries `default null` only so it can
follow the optional `p_existing_*` params without violating Postgres'
"defaults must trail" rule — validated as required at runtime). A
`pg_advisory_xact_lock` keyed on the string serializes concurrent calls
sharing a key so two racing replays can never both create rows. A settled
key replays its original cached result forever after; the same key with a
materially changed payload (fingerprinted via `md5()` over every input
that affects the outcome) is rejected with
`ONBOARD_IDEMPOTENCY_CONFLICT`. Newly created Commerce products additionally
stamp `source_system = 'xos_onboarding'`, `source_ref = <idempotency key>`,
reusing XOS 3A's existing `(tenant_id, source_system, source_ref)` unique
identity contract as a second, defense-in-depth layer.

## Audit

Every onboarding call that does real work (not an idempotent replay) writes
one row to the existing `public.opps_activity_events` log — no new audit
table was added; this event log is already the generic mechanism written by
`apply_invoice_order_sync` and read by `TeamActivityPanel`/`WorkQueue`/
`OperationsHealth`. `event_type: 'xos_commerce_product_onboarded'`,
`entity_type: 'commerce_product'`, `metadata` carries `client_id`,
`client_product_id`, `idempotency_key`, `opps_linked`, `xlab_linked`.

## Internal UI

Extends the existing client detail surface (`ClientAccountDialog` in
`src/pages/Clients.jsx`) — no new "fourth admin" page. A "Commerce
Products" section lists onboarded products with an integration-status
badge row (Commerce Connected / Client Account Connected / X LAB
Connected-or-Not Linked / OPPS Connected-or-Mapping Pending) and an "Add
product" button opening `ProductOnboardingDialog`: name, description,
retail price, sale price, currency, primary image upload, availability,
status, variants — plus a clearly separated "Managed Client Fields" section
(client/service price, requires quote, account visibility, reorder
enabled) and an "Integration" section (OPPS product search-select scoped to
the client's tenant via the existing `CatalogItem`/`public.products` data
path; X LAB template id as a plain optional field). `src/api/commerceOnboarding.js`
is a thin RPC wrapper, matching `src/api/artworkLinking.js`.

## Test matrix

`supabase/tests/xos_3b_product_onboarding.sql` — disposable, rollback-wrapped
(`begin; ... rollback;`), covering items 1–21 of the 22-item XOS 3B test
matrix (fresh fixture tenants/clients/products/xlab row, two real existing
Joint X staff `auth_user_id`s reused read-only as JWT subs since
`is_opps_staff()` authority is global and not fixture-creatable). Item 22
("existing XOS 3A security matrix remains green") is intentionally not
duplicated here — it is already covered by the separate, already-validated
`supabase/tests/xos_products_foundation.sql`.

**Not yet executed against production** — the XOS 3B task brief specifies
read-only production access; every step of this implementation used only
`SELECT`/`information_schema` queries. The migration, both RPCs, and the
test suite are written and build-verified (`npm run build` succeeds) but
have not been applied to or run against the live database. Run with:

```
supabase db query --linked --file supabase/tests/xos_3b_product_onboarding.sql
```

only once write access for this phase is explicitly authorized.
