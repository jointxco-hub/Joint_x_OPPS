# Public Storefront Commerce — Phase 4A Foundation

## Purpose

A generic (never tenant-specific), unauthenticated, read-only public
storefront catalog contract, backed by the existing `commerce.products`/
`commerce.product_variants` authority (XOS 3A/3B). This is the
foundation phase only: catalog reads, nothing else. No checkout, no
PayFast, no product mutation, no storefront domain activation for any
tenant, no product import. See "Phase 4B checkout" below for the
deliberately-deferred next phase's design.

This phase is part of GSB's Commerce authority migration (see the
local GSB repo's `docs/GSB_COMMERCE_MIGRATION_PLAN.md`), but nothing in
this document or its migration is GSB-specific. Any tenant with an
active `storefront`-surface domain and the `products` capability enabled
can use this contract once it's applied.

## Authority boundaries (restated, non-negotiable)

| System | Owns |
|---|---|
| **Commerce** (`commerce.products`/`commerce.product_variants`) | Commercial/customer-facing product identity: retail name/description, retail price/sale price, public variant identity, public availability, draft/published/archived state, storefront-facing media. |
| **X LAB Account / `client_products`** | Managed product relationship, artwork/revisions, client reorder configuration, production instructions, managed-service information. |
| **OPPS** | Inventory truth: physical stock, supplier identity, purchase orders, reservations, receipts, consumption, production, internal costs, fulfilment. |

Commerce is not, and must never become, a stock/inventory ledger —
there is no quantity field anywhere in `commerce.products`/
`commerce.product_variants` by design (XOS 3A), and nothing in this
phase changes that. A public storefront's own product authority (e.g.
GSB's unapplied `gsb_products`) must never compete with Commerce as a
second commercial authority.

## Host authority

### What already existed before this phase (reused, not duplicated)

`public.resolve_public_storefront_tenant(p_hostname text)`
(`202606270008_tenant_storefront_catalog_backend.sql`, Phase 5B)
already resolves an active `public.tenant_domains` row
(`surface = 'storefront'`, `status = 'active'`, tenant `status = 'active'`)
to `(tenant_slug, tenant_name, hostname)`, already granted to
`anon`/`authenticated`. **This migration does not redefine or modify
it.** Its sibling, `get_storefront_catalog_for_host(...)`, reads
`public.products` (the OPPS operational table) — a separate, older
storefront pattern (X LAB / `demo-xos`) that pre-dates
`commerce.products` entirely. That function is also untouched here;
it is explicitly not the pattern this phase follows, since reading
OPPS's operational product table for a public catalog is exactly the
"Commerce vs. OPPS" boundary confusion this whole phase exists to
avoid going forward.

`public.resolve_public_tracking_tenant`/
`public.get_public_order_tracking_for_host`
(`202606210008_tenant_host_routing.sql` /
`202606240001_host_aware_public_tracking.sql`) establish the exact
security shape this phase's new RPCs mirror: `SECURITY DEFINER`,
`public.normalize_tenant_hostname` (rejects protocol/path/query/
fragment/port/malformed hostnames before any lookup), an **active**
`tenant_domains` row of the correct surface joined to an **active**
tenant, no `tenant_id` ever accepted as an RPC parameter, granted to
both `anon` and `authenticated` (a storefront visitor need not be
signed in).

### What this phase adds

A new, internal-only helper,
`public._resolve_public_commerce_tenant(p_hostname text) returns uuid`
— not a second public hostname resolver. It **calls** the existing
`resolve_public_storefront_tenant` (above) rather than re-deriving its
predicate a second time, then maps the returned `tenant_slug` back to a
`tenant_id` (slugs are unique tenant-wide throughout this codebase,
relied on the same way elsewhere). This is the only place a real tenant
UUID is produced from a browser-supplied hostname in this phase, and it
is never itself granted to `anon`/`authenticated` — only called from
within the two `SECURITY DEFINER` catalog RPCs below (the exact pattern
already proven throughout Managed Clients Phase 2/3's internal
`_`-prefixed helpers, which call each other across `SECURITY DEFINER`
boundaries without needing their own grants).

A supplied hostname never directly becomes tenant identity — it is
always resolved through `tenant_domains`, and only an `active`,
`storefront`-surface row on an `active` tenant resolves at all. A
`pending`/`disabled` domain, a `xos_admin`-surface domain, an unknown
hostname, or a hostname carrying a query string/path/protocol all fail
identically (a single generic "Storefront not found." — see below).

## Public commerce catalog RPCs

`get_public_storefront_products_for_host(p_hostname text, p_limit integer default 50)`
and `get_public_storefront_product_for_host(p_hostname text, p_slug text)`
— both `SECURITY DEFINER`, `set search_path to 'pg_catalog', 'public'`,
explicitly schema-qualify `commerce.products`/`commerce.product_variants`.
`EXECUTE` revoked from `PUBLIC` first (the XOS 2.5 lesson: a fresh
`CREATE FUNCTION` auto-grants to `PUBLIC`, which `anon`/`authenticated`
both inherit unless revoked by name), then explicitly granted to both
`anon` and `authenticated`.

Both:
1. Resolve tenant via `_resolve_public_commerce_tenant(p_hostname)` —
   `null` → generic `'Storefront not found.'` (never distinguishes
   unknown/pending/disabled/wrong-surface/inactive-tenant).
2. Require the `products` `tenant_capabilities` row `enabled = true` for
   that tenant — otherwise a generic `'Storefront catalog is not
   available.'` (never distinguishes "explicitly disabled" from "never
   configured", and never reveals anything about any *other* tenant's
   capability state — identical principle to `get_xos_products_for_host`).
3. Call the **same shared internal projection helper**,
   `_public_storefront_products_projection(p_tenant_id, p_slug, p_limit)`
   — list passes `p_slug = null`; detail passes `p_limit = null` and a
   real slug. One implementation, so list and detail can never drift
   apart on what counts as "safe" or "published" (the same lesson Managed
   Clients Phase 3's shared snapshot helper already established for this
   codebase).

### Safe projection

**Returned per product**: `id, slug, name, description, price,
sale_price, currency, primary_image_url, availability, variants[]`.
**Per variant**: `id, sku, title, size, color, price_override,
availability, sort_order`.

**Never returned, anywhere**: `tenant_id`, `source_system`, `source_ref`,
`status`, anything from `commerce.product_links`, any `client_products`/
OPPS/X LAB id, internal cost/supplier data, inventory quantities, or
auth information. `status` is used only as a server-side filter
predicate — it is never one of the returned jsonb keys, unlike the
authenticated `get_xos_products_for_host`, which legitimately does
return `status` so staff can see draft/archived state for management.

### Publication rule (the one real difference from the authenticated Products list)

`get_xos_products_for_host` (authenticated, staff-facing) excludes only
`archived`. This phase's public RPCs are stricter: **`status = 'published'`
only** — `draft` and `archived` are both excluded unconditionally. A
product mid-edit or pulled from sale must never be publicly browsable
just because it isn't archived yet.

### Determinism

Products: `order by name asc, id asc` (a public listing should be
alphabetically stable for customers; `id` breaks a name tie
deterministically — two products can legitimately share a name).
Variants: `order by sort_order nulls last, id asc` (an unset/tied
`sort_order` still needs a deterministic tie-break; `get_xos_products_for_host`'s
own `sort_order, created_at` ordering was not reused as-is here for
exactly that reason — `created_at` is not a unique tie-breaker either).

`p_limit` is always clamped server-side —
`greatest(1, least(coalesce(p_limit, 50), 100))` — a negative, zero,
null, or absurdly large value can never reach the query unclamped, and
never raises an error.

## No table-level access change

`commerce.products`/`commerce.product_variants` already have RLS
enabled with zero policies and are already revoked from
`anon`/`authenticated`/`PUBLIC` (XOS 3A). This phase adds **zero** table
grants — the two new `SECURITY DEFINER` RPCs (and their two internal
helpers, neither of which is itself grantable) are the only path
`anon`/`authenticated` ever reach this data through.

## OPPS inventory boundary

Unchanged, restated: physical stock quantity is never exposed by this
contract, never stored in Commerce, and never synthesized here. Public
`availability` (`available`/`out_of_stock`/`preorder`/`unavailable`) is
whatever value already sits on the Commerce row — this phase reads it,
never derives or infers it from anything OPPS owns. Keeping Commerce
availability actually in sync with OPPS's real inventory truth is a
**future** synchronization problem, explicitly out of scope here (see
GSB's migration plan's "Stock mapping rule" for the one-time, read-only
mapping used only when originally *populating* Commerce availability
from a legacy source — that is not a live sync, and this contract does
not depend on it staying accurate over time).

## Checkout boundary — Phase 4B (design only, not implemented)

Commerce catalog **read** authority (this phase) and checkout/order
**write** authority are different trust boundaries and must not be
conflated. Reading a published catalog is safe by construction (no
mutation, no PII, `SECURITY DEFINER` read-only RPCs). Creating an order
is not, and nothing in this phase implements it.

Reviewed for this design (read-only, nothing changed): GSB's own
`gsb_create_checkout_order`/PayFast design (well-built — idempotency key,
server-side re-pricing, no client-trusted price — but scoped to GSB's
own unapplied `gsb_*` schema, not reusable as-is for a generic
multi-tenant contract), X LAB's PayFast edge functions (the pattern GSB's
own functions were themselves adapted from), the existing public tracking
contract (`get_public_order_tracking_for_host` — the closest existing
generic, hostname-resolved, anon-reachable pattern), and OPPS's existing
order authority (`public.orders` and its own ownership of production/
fulfilment state).

**Proposed Phase 4B checkout contract** (not built):

1. Browser never supplies `tenant_id` as authority — resolved from the
   storefront hostname exactly as this phase's catalog RPCs already do,
   via the same `_resolve_public_commerce_tenant`-shaped helper (reused,
   not reinvented, for the checkout path too).
2. Server re-resolves every line item's Commerce product + variant
   pricing at order-creation time — the client's submitted price/name/
   image (if present at all, e.g. for on-screen cart display) is never
   read as authoritative. Directly mirrors `gsb_create_checkout_order`'s
   own already-proven design for this specific property.
3. A single, server-created order/payment intent — idempotency-keyed
   (client generates the key once per checkout attempt, not per submit
   click — the same lesson `getOrCreateCheckoutKey()`'s `sessionStorage`
   pattern already encodes) — is the only thing a subsequent PayFast
   `init`/`notify` pair ever operates on.
4. PayFast integration is tied to that server-created order, using the
   existing validated ITN-signature-check-before-any-DB-write pattern
   (ordering already proven correct in both X LAB's and GSB's own
   `payfast-notify` implementations).
5. **OPPS becomes the operational order/fulfilment authority** —
   production status, shipping/tracking, internal state — not a second,
   independent order record. The order-write path should create or link
   an OPPS-side operational order rather than maintaining commercial
   order state twice, mirroring the "exactly one authoritative writer
   per fact" rule XOS 3A already established for product identity.
6. **No independent `gsb_orders`-shaped durable authority** unless a
   future design explicitly and separately justifies one — the default
   assumption carried into Phase 4B is a single generic public checkout
   contract (not a second GSB-specific schema), the same relationship
   this phase's catalog contract already has to GSB specifically (fully
   generic, GSB is simply the first real consumer).

None of the above is implemented, stubbed, or scaffolded in this phase
— it is a design record so Phase 4B doesn't have to re-derive it from
scratch, and so nobody is tempted to quietly port `gsb_create_checkout_order`
directly as a shortcut.

## Public vs. XOS authenticated catalog — summary

| | Authenticated (`get_xos_products_for_host`) | Public (this phase) |
|---|---|---|
| Tenant resolution | `resolve_authenticated_tenant_host` — requires `auth.uid()` + `can_access_tenant()` membership | `_resolve_public_commerce_tenant` — hostname only, no auth required |
| Surface | `xos_admin` | `storefront` |
| Status filter | excludes `archived` only | `published` only |
| `status` field returned? | yes | no |
| Grantees | `authenticated` only | `anon` and `authenticated` |
| Purpose | staff review/management surface | public shopper browsing |

## Future storefront domain activation (not performed in this phase)

For any tenant (GSB included) to actually serve a public catalog through
this contract: (1) `commerce.products`/`commerce.product_variants` rows
must exist and be `published`, (2) the tenant's `products` capability
must be `enabled` (already true for GSB), (3) an **active**
`public.tenant_domains` row with `surface = 'storefront'` must exist for
the tenant's real public hostname. Step (3) is a deliberate, explicit,
later activation step for any tenant — not performed for GSB or anyone
else in this phase. Confirmed via read-only check: GSB currently has
**zero** `storefront`-surface `tenant_domains` rows.

## Explicit exclusions (per phase scope)

Not built in this phase: checkout, PayFast, product mutation/import of
any kind, storefront domain creation/activation for any tenant, any
change to GSB's workspace/Site Build/Commerce products, any change to
`GSB Tes`, any deploy, any DNS change.
