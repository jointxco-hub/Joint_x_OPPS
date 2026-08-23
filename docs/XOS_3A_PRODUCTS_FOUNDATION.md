# XOS 3A — Product Authority Foundation

## Purpose

Introduces a generic, tenant-scoped, capability-gated, read-only product
catalog contract for XOS. This is the foundation phase only — no storefront,
no checkout, no PayFast, no product mutation, no GSB activation. GSB
currently has zero products; this phase makes it possible for a tenant to
*view* a catalog once one exists and the capability is turned on, nothing
more.

Amended before this branch was pushed for review to add
`commerce.product_links` — an identity bridge to the rest of the
ecosystem (X LAB Account / `client_products`, OPPS) — so XOS is designed
from the start to interoperate cleanly rather than repeating the
historical X LAB ↔ OPPS pattern of building systems independently and
retrofitting identity/sync later. See "XOS / X LAB / OPPS Interoperability
Contract" below.

**Second amendment**, from independent pre-production review, before
this PR was pushed for merge: strengthened `client_product` tenant
integrity to check all three tenants (commerce product, `client_products`,
and its linked `clients` row) rather than two; added real referential/
tenant validation for `opps_product` and `xlab_product` links instead of
leaving them entirely to future adapter code; replaced Overview's
capped-list-length Products count with a dedicated
`get_xos_product_summary_for_host` aggregate RPC; and corrected this
document's earlier, inaccurate claim that `client_products` has "no
concept of a client-browsable catalog" (it does — see below).

## Authority model — why `client_products` was not repurposed

`public.client_products` (audited before writing any code — see column
list below) is the existing **managed, client-account/reorder/approval
product layer**:

```
xlab_product_id, opps_product_id, client_facing_name, internal_name,
status, client_price, requires_quote, print_method, placement,
garment_material, garment_gsm, garment_color, print_locations, print_size,
production_instructions, packaging_instructions, special_instructions,
internal_notes, available_variants, default_variants, primary_mockup_url,
visible_in_account, reorder_enabled, created_from_order_id,
last_ordered_at, revision, created_by, updated_by, approved_by,
approved_at, primary_mockup_asset_id
```

**Correction from an earlier draft of this document:** `client_products`
is *not* missing client-facing catalog concepts — it already has
`visible_in_account`, `reorder_enabled`, `client_price`,
`available_variants`, `primary_mockup_url`, and artwork/revision/order-link
relationships (`created_from_order_id`, `revision`,
`primary_mockup_asset_id`). It is not repurposed as the universal
Commerce authority not because it lacks those concepts, but because of
what it's scoped and centered on:

- **`client_id`-scoped**, not tenant-wide — it models one client's
  specific approved relationship to one product, not "every customer at
  this workspace can browse this."
- **Production/approval-centric** — `requires_quote`, `approved_by`/
  `approved_at`, `revision`, `internal_notes`, `production_instructions`
  are all live parts of its data model; a generic draft/published/archived
  catalog item has no equivalent concept.
- **Tied to managed Joint X service/product workflows** — it exists
  because Joint X staff produce and approve a specific item for a
  specific client, not because a tenant is running a self-service catalog.

`commerce.products` is the generic **tenant-wide commercial/B2C catalog
authority** — every customer at a tenant sees the same published catalog,
with no per-client approval step. `client_products` remains exactly what
it already was, untouched by this phase. This distinction matters
because XOS must integrate with X LAB Account, not unknowingly rebuild
it — see `commerce.product_links` below, which is the bridge that lets
a commerce product reference an existing `client_products` relationship
rather than duplicating what it already models.

`public.products` and `public.orders` were also explicitly *not* made the
universal commerce authority, per the architectural decision handed down
for this phase — they're the OPPS-internal production/fulfillment record,
not a tenant-facing catalog contract.

## `commerce.products` contract

New, dedicated `commerce` schema — never exposed to PostgREST (not in the
exposed schema list), and locked down at the grant level too as defense in
depth (see Grants below — the XOS 2.5 lesson: a fresh `CREATE` can
silently grant `PUBLIC` access unless revoked explicitly, so every new
object here has an explicit revoke, not an assumption of safety).

```
commerce.products
  id uuid PK, tenant_id uuid -> public.tenants(id), slug text, name text,
  description text, price numeric, sale_price numeric,
  currency text default 'ZAR', primary_image_url text,
  availability text, status text, source_system text, source_ref text,
  created_at, updated_at

commerce.product_variants
  id uuid PK, tenant_id uuid, product_id uuid -> commerce.products(id) on delete cascade,
  sku text, title text, size text, color text, price_override numeric,
  availability text, sort_order integer, source_ref text,
  created_at, updated_at
```

- `status`: `draft` | `published` | `archived`
- `availability`: `available` | `out_of_stock` | `preorder` | `unavailable`
- Validation: non-negative price/sale_price, sale_price ≤ price when both
  present, `(tenant_id, slug)` unique, `(tenant_id, source_system, source_ref)`
  unique only where `source_ref is not null` (manually-created products
  never collide), slug format restricted to `^[a-z0-9]+(-[a-z0-9]+)*$`.
- **A variant's `tenant_id` can never disagree with its parent product's
  tenant** — not merely validated, structurally impossible: a
  `BEFORE INSERT OR UPDATE OF product_id` trigger
  (`commerce.sync_variant_tenant_id`) derives and overwrites `tenant_id`
  from the parent product on every write, ignoring whatever value was
  passed in. Verified live (disposable): inserting a variant with an
  explicitly wrong `tenant_id` results in a row whose `tenant_id` matches
  the parent product anyway.
- RLS enabled on both tables with **zero policies** — a hard default-deny
  for every role except the table owner. Both tables are only ever
  reached through the two `SECURITY DEFINER` RPCs below, which execute as
  the function owner and bypass RLS by design; RLS here is defense in
  depth against any future direct-access path, not the primary boundary.

## XOS / X LAB / OPPS Interoperability Contract

Added as an amendment before this branch was pushed for review, to avoid
repeating the historical X LAB ↔ OPPS problem: independent systems built
first, identity/sync retrofitted later. XOS is designed from this
foundation phase to reference the ecosystem's existing identity bridge,
not build a second one.

### Authority boundaries

**Commerce** (`commerce.products`/`commerce.product_variants`) owns
commercial/customer-facing product identity only: canonical commerce
product id, retail name/description, retail price/sale price, public
variants, public availability, draft/published/archived state,
storefront-facing primary media.

**X LAB Account / `client_products`** owns client-service/product-management
concerns: the client-specific approved product relationship, artwork
revisions, client-facing reorder setup, client-specific service pricing,
and client production instructions exposed through *approved* workflows.

**OPPS** remains authoritative for everything operational: production
method/configuration, inventory truth, supplier identities, purchase
orders, reservations, receipts, consumption, transfers, production
movements, internal cost/margin, and fulfilment execution.

**Commerce must never become a second inventory or production ledger.**
Nothing in this phase writes stock, cost, or production state anywhere —
`commerce.products` has no such fields at all.

### Identity bridge

```
commerce.products
       |
       v
commerce.product_links   (system_key = 'client_product' | 'opps_product' |
       |                   'xlab_product' | 'legacy_gsb_product')
       v
client_products   (existing bridge - untouched, not duplicated)
   |          |
   v          v
xlab_product_id   opps_product_id   (existing columns on client_products)
   |                  |
   v                  v
X LAB product      OPPS product
identity           identity
```

`commerce.product_links(id, tenant_id, commerce_product_id, system_key,
external_id, metadata jsonb, created_at, updated_at)` — internal
integration metadata, never exposed through `get_xos_products_for_host`
or any other client-facing RPC (verified live — a products response never
contains `product_links`, `external_id`, or a linked client_product's raw
id anywhere in its text). RLS enabled, zero policies, `REVOKE ALL` from
`PUBLIC`/`anon`/`authenticated` — identical lockdown pattern to the other
two commerce tables.

**Preferred first path:** `system_key = 'client_product'`, with
`external_id` being a `client_products.id`. This reuses the existing
bridge rather than creating a second, disconnected one — `client_products`
already carries `xlab_product_id`/`opps_product_id`, so a single
`client_product` link transitively reaches both X LAB and OPPS identity
without `commerce.product_links` needing to know about either directly.

Direct `opps_product`/`xlab_product` links are supported by the schema
for cases where no `client_products` row exists yet — their referential
integrity is enforced by the trigger, not left entirely to future adapter
code, but their semantics differ per system because the underlying data
does:

- **`opps_product`**: `external_id` must be a valid UUID referencing an
  existing `public.products` row, **and that row's `tenant_id` must equal
  the commerce product's tenant** — confirmed via preflight that
  `public.products.tenant_id` is tenant-scoped in production data (the
  column is nullable at the schema level, so a `null` tenant is rejected
  just as firmly as a mismatched one, never silently accepted).
- **`xlab_product`**: `external_id` must be a valid UUID referencing an
  existing `public.xlab_products` row. **No tenant equality check** —
  confirmed via preflight that `public.xlab_products` has no `tenant_id`
  column at all, because it represents a reusable/shared X LAB catalog
  identity rather than a tenant-scoped record. `product_links.tenant_id`
  is still forced to the commerce product's tenant regardless (see below)
  — only the *existence* of the xlab_product is checked, not a tenant
  match that the underlying data has no way to express.
- **`legacy_gsb_product`** intentionally remains opaque in this phase —
  its source system is outside this canonical production schema and will
  need its own adapter contract later.

A future adapter using `opps_product`/`xlab_product` directly is
responsible for not creating conflicting duplicate authority with an
existing `client_product` link for the same commerce product — the
schema does not currently prevent one commerce product from holding both
a `client_product` link and a direct `opps_product`/`xlab_product` link
simultaneously.

### Uniqueness and tenant protections

- `tenant_id` on `commerce.product_links` is **derived, never trusted
  from input** — a `BEFORE INSERT OR UPDATE` trigger
  (`commerce.sync_product_link_tenant_id`) overwrites it from the parent
  `commerce_product_id` on every write, identical in spirit to the
  variant-tenant-forcing trigger, for every `system_key`. Verified live:
  inserting a link with an explicitly wrong `tenant_id` still lands with
  the correct one.
- For `system_key = 'client_product'`, the same trigger independently
  re-resolves **both** the linked `client_products` row **and** its
  linked `clients` row, and requires all three tenants (commerce product,
  `client_products.tenant_id`, `clients.tenant_id`) to agree.
  `client_products`' own `client_products_set_tenant_id()` trigger only
  *derives* `tenant_id` when it is `null` on insert — it never corrects
  or rejects a caller-supplied value that disagrees with the client's own
  tenant, so `client_products.tenant_id` alone cannot be trusted as a
  stand-in for "the client actually belongs to this tenant." Rejected:
  an invalid UUID, a missing `client_products` row, a missing linked
  `clients` row, or either tenant disagreeing with the commerce product's
  — all via generic internal-integrity exceptions (never client-facing,
  so the exact failure reason isn't exposed). Verified live: Tenant A's
  commerce product cannot link to Tenant B's `client_products` row.
- For `system_key = 'opps_product'`, the trigger requires a valid UUID,
  an existing `public.products` row, and that row's `tenant_id` to equal
  the commerce product's tenant. Verified live: Tenant A → Tenant B OPPS
  product rejected; a non-existent `opps_product` id rejected.
- For `system_key = 'xlab_product'`, the trigger requires a valid UUID
  and an existing `public.xlab_products` row — no tenant check (see
  above for why). Verified live: existing xlab_product accepted;
  non-existent id rejected.
- `UNIQUE (tenant_id, system_key, external_id)` is the single constraint
  that both (a) prevents an exact duplicate mapping and (b) prevents one
  external identity (e.g. one `client_products` row) from silently
  fanning out to a second commerce product within the same tenant —
  verified live as two distinct scenarios, both correctly rejected.
- Deleting a `commerce.products` row cascades (`ON DELETE CASCADE`) and
  safely removes its mapping rows — verified live.

### Date/movement contract

All Commerce and integration records use `timestamptz`, with
server-generated `created_at` (`default now()`) and a server-maintained
`updated_at` (`BEFORE UPDATE` trigger reusing the existing
`public.update_updated_at()` — never a browser-supplied timestamp as
authoritative state.

Ownership going forward: **customer/commercial events belong to Commerce**
(an order being placed, a catalog item being viewed/purchased);
**production/inventory movements belong to OPPS** (stock consumed, a
purchase order received, a production stage advanced). Commerce never
creates its own stock movement — there is no stock/quantity field
anywhere in `commerce.products`/`commerce.product_variants` by design.

The intended future order flow (not built in this phase):

```
Storefront
  → Commerce order (tenant/client/product identities preserved via
    commerce.product_links)
  → adapter creates/links the corresponding OPPS operational order
  → OPPS production/inventory movements happen exactly once, in OPPS
  → a safe, client-appropriate status is projected back into XOS
```

No user should ever be required to manually update the same operational
state in both Commerce and OPPS — that duplication is exactly the
retrofit problem this contract exists to avoid.

### Future sync contract (rule only — no implementation in this phase)

XOS 3A does not build synchronization or an event bus. The rule for every
future cross-system mutation, stated now so it isn't improvised later:

- exactly one authoritative writer per fact
- an explicit source identity (which system produced this write)
- idempotency (safe to retry/replay)
- tenant-preserving mapping (via `commerce.product_links` or an
  equivalent, never a bespoke ad hoc join)
- auditability
- deterministic retry/reconciliation behavior

**Avoid:** anonymous/direct cross-table writes, browser-controlled tenant
ids, permanent blind dual writes, and one-off bespoke bridge logic built
per tenant. Future adapters (storefront order sync, inventory
projection, etc.) should consume this shared mapping contract rather than
inventing their own.

### Scope of this phase

**XOS 3A creates the identity foundation only.** It does not implement
storefront sync, order sync, inventory sync, or PayFast — those are
future phases building on top of `commerce.product_links`, not part of
this change.

## Capability model

`public.tenant_capabilities(tenant_id, capability_key, enabled, config)`,
composite PK, RLS enabled with zero policies (no direct client CRUD).
Deliberately generic — not specific to `products` — so a future capability
(e.g. a different module) reuses the same table with a new key.

`get_xos_capabilities_for_host(p_hostname)` returns a `jsonb` object
containing **only enabled** capability keys — a disabled or never-configured
capability simply has no key in the response, so the frontend gates purely
on key presence (`capabilities.products?.enabled`) without needing to
distinguish "off" from "never set up."

## XOS safe RPC contract

All three new RPCs (`get_xos_capabilities_for_host`,
`get_xos_products_for_host`, `get_xos_product_summary_for_host`) follow
the exact pattern already established by `get_xos_orders_for_host` /
`get_xos_requests_for_host` / `get_xos_files_for_host` /
`create_xos_request_for_host` / `get_xos_order_detail_for_host` (all
read-audited before writing this migration, all unmodified by it):

- `SECURITY DEFINER`, `SET search_path TO 'public'`, tenant resolved
  *only* via `resolve_authenticated_tenant_host(p_hostname, 'xos_admin')`
  (requires `auth.uid()` and active membership via `can_access_tenant()`)
  — never a browser-supplied tenant id.
- Generic `raise exception 'XOS access denied.'` on any resolution
  failure — unknown hostname, no membership, wrong tenant, or a malformed/
  injected hostname string (`normalize_tenant_hostname` rejects anything
  with a protocol, path, query string, fragment, or port before it ever
  reaches a domain lookup — confirmed live: `host/../other-host` and
  `host?tenant=other-host` both denied, not partially matched).
- `get_xos_products_for_host` and `get_xos_product_summary_for_host` both
  additionally require the `products` capability to be `enabled` for the
  resolved tenant, raising a second, equally generic `'Products are not
  available for this workspace.'` otherwise — the same message whether
  the capability is explicitly disabled or was never configured, and it
  never reveals anything about any *other* tenant's capability state.
- `EXECUTE` explicitly revoked from `PUBLIC` and `anon`, granted only to
  `authenticated` — written this way specifically because of the XOS 2.5
  discovery that a fresh `CREATE FUNCTION` on this project auto-grants
  `EXECUTE` to `PUBLIC` (which `anon`/`authenticated` both inherit)
  unless revoked from `PUBLIC` by name; naming individual roles in a
  revoke does not remove a separate `PUBLIC` grant.

### `get_xos_product_summary_for_host` — accurate counts, not a capped length

Overview originally showed `useXosProducts(...).data.length` under a
"Products" metric card, using the same `limit`-capped
`get_xos_products_for_host` the Products module itself uses. That reads
as an exact total right up until a tenant has more products than the
cap, at which point it silently under-counts with no visual indication.
Fixed by adding a dedicated, narrow aggregate RPC instead of trying to
make the list-based count "close enough":

```json
{ "total": <non-archived count>, "published": <count>, "draft": <count>, "unavailable": <non-archived, availability='unavailable' count> }
```

No product rows, no `tenant_id`, no pagination — just four `count(*)
filter (...)` aggregates over `commerce.products` for the resolved
tenant. Overview now calls this instead of pulling any product rows at
all; the Products module page itself is unaffected and continues to use
`get_xos_products_for_host` for its list. Verified live with more than
10 products for one tenant (exceeding the list RPC's default page size)
that the summary's `total` stays accurate while a capped list's `.length`
would not.

### Client-visible vs. Joint X–only fields

Returned per product: `id, slug, name, description, price, sale_price,
currency, primary_image_url, availability, status, variants[]`. Per
variant: `id, sku, title, size, color, price_override, availability,
sort_order`.

**Never returned:** `tenant_id`, `source_system`, `source_ref` — the only
fields that exist on these tables beyond the client-safe list. There is no
supplier/cost/margin/production data on `commerce.products` at all in this
phase (Joint X's production feasibility, internal costs, and supplier
information remain entirely in OPPS's existing tables, untouched and
unreferenced by this contract) — the allowlist exists as a forward-looking
guard for whenever those fields are added to this schema later, not
because anything sensitive is on it today.

Archived products (`status = 'archived'`) are excluded from the normal
list unconditionally.

## Test matrix

`supabase/tests/xos_products_foundation.sql` — 48 checks, disposable
fixtures (nine brand-new tenants across four fixture blocks, plus
read-only references to two real, existing QA fixture tenants and one
real `public.products` row — never mutated, never touching Demo/GSB/
Joint X real data otherwise), wrapped in one transaction ending
`rollback;`. Validated live 2026-08-23 (original 24, then 32 with the
interoperability amendment, then re-validated together with the 16
review-amendment additions below): **48/48 pass**, confirmed zero
rows/schema persisted afterward (`commerce` schema absent, zero
`xos3a-test%` tenant rows, zero `XOS 3A%`-named client/client_products
rows).

| # | Check | Result |
|---|---|---|
| 1/10 | Tenant X member on Tenant X host sees only X's product | PASS |
| 2 | Tenant X member on Tenant Y host | denied | PASS |
| 3 | Tenant Y member on Tenant X host | denied | PASS |
| 4 | No tenant membership at all | denied | PASS |
| 5 | Unknown hostname | denied | PASS |
| 6 | Path/query hostname injection | denied, cannot override tenant | PASS |
| 7 | Capability enabled → products available | PASS (same as #1) |
| 8 | Capability explicitly disabled | denied, generic message | PASS |
| 9 | Capability row missing entirely | denied, same generic message | PASS |
| 11 | Variant tenant mismatch structurally impossible | PASS |
| 12 | Archived product excluded from list | PASS |
| 13/14 | Response contains only allowlisted fields, no internal leak | PASS |
| 15/16 | `anon`/`PUBLIC` cannot `EXECUTE` either RPC | PASS |
| 17 | `anon`/`authenticated` cannot directly `SELECT` commerce tables or `tenant_capabilities` | PASS |
| 18 | Existing 5 XOS/internal-request functions still present, untouched | PASS |

Plus two capability-RPC-specific checks (returns only enabled keys;
omits disabled ones) — also PASS.

### Interoperability amendment tests

| # | Check | Result |
|---|---|---|
| 1 | Product link tenant forced to equal commerce product tenant (even when a different tenant is passed) | PASS |
| 2 | Tenant A commerce product cannot link to Tenant B's `client_products` row | PASS |
| 3 | Correct same-tenant `client_product` link succeeds | PASS |
| 4 | Exact duplicate mapping (same commerce product too) rejected | PASS |
| 5 | Same `client_product` cannot map to a second, different commerce product in the same tenant | PASS |
| 6 | `get_xos_products_for_host` response never contains `product_links`, `external_id`, or a linked client_product's raw id | PASS |
| 7/8 | `anon`/`authenticated` cannot directly `SELECT` `commerce.product_links` | PASS |
| 9 | Deleting a commerce product cascades and removes its mapping rows | PASS |
| 10 | All of the above rolls back completely | PASS (confirmed via post-run persistence check, not an in-transaction assertion) |

### Review amendment tests (strengthened tenant integrity + product summary)

| # | Check | Result |
|---|---|---|
| A | `client_products.tenant_id` = commerce tenant, but linked `clients.tenant_id` differs → rejected | PASS |
| B | Fully consistent chain (commerce = `client_products.tenant_id` = `clients.tenant_id`) succeeds | PASS |
| C | Direct `opps_product`, same tenant (real Demo XOS product, read-only reference) → succeeds | PASS |
| D | Tenant A QA commerce product → Demo XOS's real OPPS product (different tenant) → rejected | PASS |
| E | Nonexistent `opps_product` id → rejected | PASS |
| F | Existing `xlab_product` (real, tenant-less catalog identity, read-only reference) → succeeds | PASS |
| G | Nonexistent `xlab_product` id → rejected | PASS |
| H | `get_xos_product_summary_for_host` total (11, excluding 1 archived of 12 inserted) stays accurate while a `limit=5` list call returns only 5 | PASS |
| I | Summary RPC: wrong host → `XOS access denied.`; capability disabled → `Products are not available for this workspace.` (matches the products RPC's exact contract) | PASS |
| J | `anon`/`authenticated` have no `SELECT`/`INSERT`/`UPDATE`/`DELETE` on `commerce.product_links` | PASS |
| K | `anon`/`authenticated` have no `SELECT`/`INSERT`/`UPDATE`/`DELETE` on `commerce.products`/`commerce.product_variants` (not SELECT-only) | PASS |

## Rollback

Everything in this phase is additive and reversible:

```sql
drop function if exists public.get_xos_product_summary_for_host(text);
drop function if exists public.get_xos_products_for_host(text, integer);
drop function if exists public.get_xos_capabilities_for_host(text);
drop table if exists public.tenant_capabilities;
drop schema if exists commerce cascade;
```

(`drop schema commerce cascade` removes `commerce.products`,
`commerce.product_variants`, and `commerce.product_links` together — the
link table has no separate rollback step since it lives in the same
schema and was never referenced by anything outside it.)

No existing table, function, or grant is modified — only new objects are
created, so rollback is a pure teardown with no data-loss risk to
anything that predates this migration.

## Production activation steps (later, not performed in this phase)

1. Migration `20260823111500_xos_3a_products_foundation.sql` reviewed and
   applied to production (not done in this phase).
2. Real `commerce.products`/`commerce.product_variants` rows created for
   a tenant through whatever internal process Joint X staff use (not
   built in this phase — no publish/CRUD UI exists yet).
3. Copy `supabase/provisioning/xos_3a_activate_products_capability_template.sql`,
   set `v_tenant_slug` to the target tenant (e.g. `gsb`), review, run once.
   Idempotent — validated live (disposable) that running it twice leaves
   exactly one `tenant_capabilities` row with `enabled = true`.
4. Confirm: `select enabled from public.tenant_capabilities where tenant_id = (select id from public.tenants where slug = '<slug>') and capability_key = 'products';` → `true`.
5. The tenant's XOS workspace shows the Products nav item and their real
   catalog (or a polished empty state if step 2 hasn't happened yet) on
   next page load — pure data change, no deploy needed.

**Not performed for GSB in this phase** — the migration does not seed any
tenant, and the activation template above is a template only.

## Explicit exclusions (per phase scope)

Not built in XOS 3A: storefront, checkout, PayFast, a GSB-specific admin,
direct OPPS product/inventory table exposure, any change to inventory
reservation work, product publish/CRUD/mutation of any kind, a second
request inbox or product-request table (the existing XOS Requests
workflow is reused via a "Request product setup" CTA), Collections, Store
Settings, Reports, XOS 4, and GSB product seeding.
