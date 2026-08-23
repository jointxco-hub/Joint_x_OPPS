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
| **`public.client_products`** | Managed client-account relationship, client-specific reorder setup, approval/revision lifecycle, artwork, managed-service price, production instructions tied to the managed relationship. One-to-one identity mapping: one managed relationship belongs to exactly one Commerce product tenant-wide. |
| **`public.products` (OPPS)** | Operational product identity, production-facing config, operational status. **Tenant-scoped but reusable**: production data proves one OPPS product ("JET T-Shirt") already backs two different `client_products` ("JET T-Shirt" and "SFR T-Shirt") - several Commerce products in the same tenant may legitimately share one underlying OPPS base product. Each Commerce product still carries at most one OPPS mapping; the reuse runs the other direction (one OPPS product, many Commerce products). |
| **OPPS Inventory** | Physical stock truth. Never touched by this phase. |
| **`public.xlab_products`** | Reusable/shared X LAB catalog/production template identity — no `tenant_id`, not owned by any one tenant or client. Same reuse shape as OPPS: one template, many Commerce products; each Commerce product still carries at most one X LAB mapping. |

Commerce retail price and `client_products.client_price` are deliberately
independent — neither is ever silently copied into the other. Commerce
never becomes an inventory ledger; `client_products` never becomes the
universal retail catalog; X LAB templates never become tenant-owned.

**Cardinality, precisely** (this matters for future inventory integration
- Commerce products/designs must not force creation of duplicate OPPS base
products merely because their branding/retail identity differs):
- `client_product` → Commerce product: **one-to-one**, tenant-wide.
- OPPS product → Commerce product: **one-to-many**, same tenant only (many
  Commerce products may reference the same OPPS base product; each
  Commerce product still has at most one OPPS mapping).
- X LAB template → Commerce product: **one-to-many**, no tenant scope at
  all (many Commerce products across any tenant may reference the same
  shared template; each Commerce product still has at most one X LAB
  mapping).

## Post-review corrections (PR #32)

An independent review of the first cut of this migration surfaced several
pre-production blockers, all fixed in place (the migration was never
applied to production, so it was safe to amend rather than layer a second
one on top):

1. **Staff authority.** The original RPCs gated on
   `is_opps_staff() and can_access_tenant(target_tenant)`. Production
   verification showed active Joint X OPPS staff hold **no**
   `tenant_memberships` row in GSB (a real, active managed client tenant) -
   that gate would have denied every real onboarding call. `public.clients`'
   own RLS already treats `is_opps_staff()` alone as sufficient internal
   authority. Both RPCs now match that contract: `is_opps_staff()` is the
   actor gate, the tenant is always resolved server-side from
   `public.clients`, and every supplied OPPS/client-product/X LAB identity
   is still independently verified against that resolved tenant. This does
   not touch or weaken any XOS client-facing RPC.
2. **Deterministic link conflicts.** The original `exception when
   unique_violation then null` pattern could silently succeed even when an
   external identity was already mapped to a *different* Commerce product,
   letting the result/audit event claim `linked: true` without a real row
   backing it. Replaced with `commerce.ensure_product_link(...)`: create if
   absent, no-op if it already points at this Commerce product, raise
   `ONBOARD_LINK_CONFLICT` (rolling back the whole call) if it points
   elsewhere.
3. **X LAB template cardinality.** The original `UNIQUE (tenant_id,
   system_key, external_id)` constraint was too strong for
   `system_key = 'xlab_product'` - X LAB templates (JET tees, hoodies,
   caps, etc.) are reusable catalog identities; many Commerce products in
   one tenant legitimately reference the same template. Replaced with three
   narrower constraints (below). Confirmed against production (read-only):
   `commerce.product_links` has 0 rows, so this swap is compatible with
   live data as-is.
4. **Idempotency key generated once per UI session**, not per click - see
   Idempotency below.
5. **Both onboarding paths exposed in the UI**, plus searchable pickers
   for existing managed products and X LAB templates (no more pasted
   UUIDs) - see Internal UI below.
6. **Non-destructive updates.** A mapping-only call (e.g. adding a missing
   OPPS link to an already-onboarded product) no longer risks wiping
   commercial fields/variants - see Idempotency/variant semantics below.
7. **Genuinely disposable SQL test fixtures** - the earlier test file
   inserted synthetic UUIDs directly into `tenant_memberships.auth_user_id`,
   which has a real FK to `auth.users(id)` (confirmed via `pg_constraint`,
   not the less reliable `information_schema.constraint_column_usage` view
   the first verification pass used). The suite now creates disposable
   `auth.users`/`public.users` rows for every simulated identity instead.
8. **The suite now fails the command** on any failed assertion (previously
   it only recorded `passed = false` in a result table without surfacing
   failure to the caller).

**Round 2:** a follow-up independent live-data reconciliation found `3.`
above did not go far enough. It corrected `xlab_product` cardinality but
still treated `opps_product` as a one-to-one identity mapping, requiring
`UNIQUE (tenant_id, system_key, external_id)` for it too via
`p_identity_unique = true`. Production disproves that: one real OPPS
product ("JET T-Shirt") already backs two different `client_products`
("JET T-Shirt" and "SFR T-Shirt"). `opps_product` now gets the same
reusable-external-identity treatment as `xlab_product`
(`p_identity_unique = false`), moved out of constraint B into the
"reusable" set - see "Product link identity and conflicts" below. Tenant
safety is unaffected: `public.products.tenant_id` must still equal the
tenant derived from the selected client before any OPPS link is allowed;
only the *count* of Commerce products one same-tenant OPPS product may
back has changed, not which tenant may reach it.

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
  The `opps`/`xlab` lookups use `LEFT JOIN LATERAL ... LIMIT 1` rather than
  a plain join, so the query stays structurally safe against row
  multiplication even if the one-mapping-per-type constraint were ever
  bypassed, not just empirically safe because that constraint holds today.
- **`admin_get_client_commerce_onboarding_options(p_client_id)`** — backs
  the onboarding form's three pickers: this client's `client_products`
  (with a `linked` flag), this tenant's OPPS products, and active X LAB
  templates. No unrestricted browser table access is needed for any of the
  three.

All three RPCs are `SECURITY DEFINER`, revoke `EXECUTE` from
`PUBLIC`/`anon`, grant to `authenticated`, and gate internally with
`public.is_opps_staff()` alone — the same pattern already used by
`find_or_create_client_product_artwork_from_asset`. Tenant is always
derived from `p_client_id` via `public.clients` (and its `status` checked
`= 'active'`), never trusted from caller input; every supplied
OPPS/client-product/X LAB identity is still independently verified against
that resolved tenant. See "Post-review corrections" above for why this is
`is_opps_staff()` alone rather than also requiring `can_access_tenant()`.

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
managed relationship).

**Non-destructive updates on an already-linked Commerce product.** When
the call resolves an existing Commerce product (e.g. a mapping-only call
adding a missing OPPS link), only a key **explicitly present** in
`p_product` overwrites its column - an absent key preserves the current
value, and an explicit JSON `null` on a nullable field is a deliberate
clear. `p_variants` follows the same idea: `NULL` preserves the current
variant set untouched, `[]` deliberately clears it, a non-empty array
replaces it. A brand new Commerce product still requires `name` and
establishes every field fresh (`NULL` variants there behaves like `[]` -
nothing to preserve yet).

## Product link identity and conflicts

`commerce.product_links` carries three constraints (replacing XOS 3A's
single `UNIQUE (tenant_id, system_key, external_id)`, which assumed every
`system_key` was a one-to-one identity mapping - see "Post-review
corrections" for the two separate production findings that disproved
that, for `xlab_product` and then for `opps_product`):

- **A** `UNIQUE (commerce_product_id, system_key, external_id)` - exact
  duplicate protection, any `system_key`.
- **B** `UNIQUE (tenant_id, system_key, external_id) WHERE system_key IN
  ('client_product', 'legacy_gsb_product')` - external identity uniqueness,
  *true* identity systems only. Deliberately excludes both `opps_product`
  and `xlab_product`: production data proves `public.products` is a
  tenant-scoped, reusable operational/base-product identity (one real OPPS
  product legitimately backs several `client_products`/Commerce products
  in that tenant), and X LAB templates are reusable across tenants
  entirely (`GSB Product A -> JET 240g`, `GSB Product B -> JET 240g`).
- **C** `UNIQUE (commerce_product_id, system_key) WHERE system_key IN
  ('client_product', 'opps_product', 'xlab_product')` - one mapping of a
  given integration type *per Commerce product*; a single Commerce product
  can never ambiguously carry two different OPPS products, two different
  X LAB templates, or two different client_products. Reuse only ever runs
  the other direction (one external identity, many Commerce products) -
  never a Commerce product fanning in to several identities of the same
  type.

`commerce.ensure_product_link(commerce_product_id, tenant_id, system_key,
external_id, identity_unique)` is the deterministic helper both RPCs use to
write these links: create if absent, no-op success if the link already
points at this Commerce product, raise `ONBOARD_LINK_CONFLICT` (aborting
the whole onboarding call) if the identity is already linked elsewhere (for
`client_product`/`legacy_gsb_product`) or if THIS Commerce product already
carries a different mapping of that type (all four system_keys, via
constraint C). `identity_unique` is `true` only for
`client_product`/`legacy_gsb_product`, `false` for `opps_product` and
`xlab_product` (external-identity reuse is expected for both, not a
conflict) - constraint C still caps each Commerce product at one mapping
per type regardless.

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

The **browser** generates that key exactly once per onboarding session -
`useState(() => crypto.randomUUID())` in `ProductOnboardingDialog`, so it
is stable across retries after a transient failure (a regenerated key per
click would defeat retry safety) and only changes when the dialog is
closed and reopened (a fresh mount). The JS wrapper
(`adminOnboardClientCommerceProduct`) also maps an `undefined` `variants`
argument to RPC `NULL` (preserve), not `[]` (clear) - the UI only sends a
concrete variants array once staff has actually touched the variants
editor in that session (`variantsTouched`), so an untouched variants
section on a "link existing managed product" flow can never wipe real data.

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
product" button opening `ProductOnboardingDialog`, which now exposes both
onboarding paths as an explicit "Managed Product Source" choice:

- **Create new managed product** (default): name, description, retail
  price, sale price, currency, primary image upload, availability, status,
  variants, plus a clearly separated "Managed Client Fields" section
  (client/service price, requires quote, account visibility, reorder
  enabled).
- **Link existing managed product**: a searchable selector
  (`admin_get_client_commerce_onboarding_options`, filtered to this
  client's *unlinked* `client_products`) - staff picks a name, never pastes
  a UUID.

An "Integration" section offers an OPPS product search-select (same
options RPC, tenant-scoped) and an X LAB template search-select (same RPC,
active templates) - both optional, both searchable, no free-text UUID
inputs anywhere in this form anymore. `src/api/commerceOnboarding.js` holds
three thin RPC wrappers, matching `src/api/artworkLinking.js`.

## Test matrix

`supabase/tests/xos_3b_product_onboarding.sql` — disposable, rollback-wrapped
(`begin; ... rollback;`), covering the full corrected XOS 3B test matrix:
the corrected authority contract (staff succeeds across tenants without
membership; a real tenant owner and a bare authenticated user are both
still denied), core onboarding/idempotency/non-duplication, OPPS
same-tenant reuse across two Commerce products with both mappings
verified to coexist, one Commerce product rejected from carrying two
different OPPS products, cross-tenant OPPS still rejected, X LAB template
reuse across products plus one-mapping-per-product rejection,
`legacy_gsb_product`/`client_product` external-identity conflict still
rejected deterministically, the integration-health RPC returning the
correct per-product OPPS/X LAB link without row multiplication,
non-destructive mapping-only updates (byte-level field/variant
preservation), the inventory/XOS-client-RPC boundary, and a
fixture-provenance check. Every
simulated identity (including the "is_opps_staff() staff" one) is a fresh
disposable `auth.users`/`public.users` row created and rolled back inside
the transaction - no real production account is read or relied upon. A
failed assertion raises at the end of the script, so the command itself
fails (non-zero/error) rather than silently recording `passed = false`.
Item 22 of the original XOS 3B test matrix ("existing XOS 3A security
matrix remains green") is intentionally not duplicated here — it is
already covered by the separate, already-validated
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
