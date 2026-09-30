# Canonical Product & Pricing Architecture v1

## Status

**Architecture reference — Phase 0 production truth incorporated.**

This is the permanent reference for how product and pricing work today
across Joint X, and the target direction for the next several
implementation slices. It reflects what a direct, hash-verified
inspection of the live shared production database confirmed during this
initiative's Phase 0, not assumptions read off old migrations —
`docs/SHARED_SUPABASE_MIGRATION_RECONCILIATION_2026-09-01.md` and
`docs/OPPS_PERMISSION_MODEL_SOURCE_OF_TRUTH_RESTORATION_2026-09-27.md`
both independently document that this codebase's git history does not,
on its own, reproduce live production state; this document does not
repeat that mistake for pricing.

Sections marked **(future)** describe intended direction, not current
behavior. Everything else describes verified live behavior as of Phase
0 and Slice 01 (`docs/architecture/canonical-pricing-slice-01-invoice-normalization.md`).

## Scope

Joint X / OPPS / X LAB / Quick Solution Café.

---

## 1. Core principle

**Build a capability once and expose it through the appropriate
surfaces.**

- **OPPS** — operational command centre and primary
  product-configuration surface.
- **X LAB** — customer-facing / storefront surface.
- **Quick Solution Café** — an independently deployable commerce
  surface on its own Supabase project/database, converging on the same
  logical contract rather than being merged into the OPPS database.

**Canonical does not mean one physical database.** It means:

- common product identity
- common pricing semantics
- common component roles
- common snapshot rules
- common authority boundaries
- predictable Bridge/sync contracts

---

## 2. Verified live production model

### A. `client_products`

The live commercial product definition for a specific client
relationship. Confirmed via direct schema inspection: `client_price`
(nullable numeric) currently acts as the agreed/customer-facing unit
price in several operational flows (manual order-add, quote-line
mapping).

`client_products.computed_unit_price` and
`client_products.price_reconciled` **do not currently exist live** —
confirmed by column inventory of the shared production database. Do not
assume either exists; do not design against them as if they do.

This table's scope and boundaries — client-scoped, production/approval-
centric, not a tenant-wide catalog — are already documented in
`docs/XOS_3A_PRODUCTS_FOUNDATION.md` ("Authority model — why
`client_products` was not repurposed"). This document does not revisit
that decision.

### B. `product_components`

Actively used live (confirmed via production activity statistics — real,
ongoing insert/update/delete churn, not dormant scaffolding). This is
the strongest existing structured composition/BOM model in the codebase.

Known live component roles include:

- `blank_garment`
- `print_service`
- `setup_fee`
- `addon`

The model already distinguishes `billing_mode`:

- **per-unit** components (multiply with quantity)
- **once-per-order** components (setup/tooling-style, charged once)

This should be **extended, not replaced by a second component engine.**

### C. `order_line_component_snapshots`

Historical/frozen production truth. Once a commercial transaction is
committed, later changes to the source Client Product or its components
must not rewrite historical order economics. This table, together with
`order_line_production_tracking`, is the existing foundation for that
guarantee.

### D. `production_pricing_defaults`

Existing supporting/default configuration (staff-editable default
price/setup-fee per production method). Treat as low-churn pricing/
config defaults, not as the final commercial price authority.

### E. Commerce

`commerce.products` / `commerce.product_variants` are a separate,
active commercial pricing surface. Storefront price resolution
(confirmed live, in `create_commerce_checkout_order`) currently uses:

```
coalesce(variant.price_override, product.sale_price, product.price)
```

`commerce.product_links` is a live and load-bearing identity bridge
into `client_products` (`system_key = 'client_product'`,
`external_id = client_products.id::text`) — not a documentation
artifact. This matches the authority-boundaries table already recorded
in `docs/XOS_3A_PRODUCTS_FOUNDATION.md` and
`docs/PUBLIC_STOREFRONT_COMMERCE.md`: Commerce owns commercial/
customer-facing product identity; `client_products` owns the managed
relationship, artwork, and production instructions; OPPS owns inventory
truth. This document does not change that boundary — it adds the
pricing-specific consequence of it (§3).

Commerce checkout is enabled per tenant via a `tenant_capabilities` flag
(`capability_key = 'products'`, `config->>'storefront_catalog_source' =
'commerce'`), and is not yet the default path for every storefront
tenant — X LAB's own default storefront checkout still takes a legacy,
client-trusted-pricing path.

### F. Quick Solution subsystem in the shared OPPS/X LAB database

`commerce.service_orders`, `commerce.service_order_items`, and
`commerce.service_product_configs` — confirmed live and active in the
**shared** `slhcvyeuqsduaglddqdb` database — form a complete, active
Quick-Solution-branded order/payment/counter/handoff subsystem, gated
entirely behind `SECURITY DEFINER` RPCs (`create_quick_solution_*`,
`qs_*`, `admin_send_quick_solution_order_to_opps`), with no direct
`anon`/`authenticated` table grants.

This is **architecturally distinct** from the separate Quick Solution
Café Supabase project's similarly-named tables (`commerce.service_orders`
etc. in `tijiamrfnxrbitafiflj`) and from that project's own
`create_quick_solution_*` RPC family. **Do not treat same-named tables
across the two databases as the same system.** The link between the
shared-DB subsystem and `public.orders` is application-managed
(`commerce.service_orders.opps_order_id`, a plain `uuid` with no foreign
key) via an explicit handoff function, not a database-enforced
relationship.

**This is flagged as an explicit architecture decision still required —
see §12B. It is not resolved by this document.**

---

## 3. The three current price authorities

Phase 0 verified, by direct inspection of live function bodies, that
there are **three independent, live pricing authorities** for what can
be conceptually the same client product, and that none of them read or
validate against each other:

1. **`client_products.client_price`** — flat, staff-set. Authoritative
   for the manual "add composed client product to order" flow
   (`xos_add_composed_client_product_to_order`: the commercial unit
   price is `coalesce(staff override, client_products.client_price,
   0)` — the composed component sum is attached only as diagnostic
   metadata for that flow, never as the price itself) and for quote-line
   mapping.
2. **`product_components`-derived composition pricing**, via the live
   composition/freeze kernel (`_xos_freeze_client_product_price_breakdown`)
   — computed fresh on every call, including a `reconciled` boolean, but
   never persisted back onto `client_products`. It is authoritative only
   for once-per-order setup-fee line items generated alongside a
   composed add, and for the staff-facing reconciliation preview.
3. **Commerce product/variant price** — `commerce.products.price`,
   `commerce.products.sale_price`, `commerce.product_variants.price_override`
   — authoritative only for Commerce-enabled-tenant self-service
   checkout, resolved independently of both of the above.

**This multiplicity is the core pricing-governance problem this
initiative exists to address. Do not pretend it is already unified —
it is not.** A `client_products` row can legitimately have a
`client_price`, a component-sum-derived price, and a linked Commerce
variant price that all disagree, with nothing today that detects or
prevents that beyond a UI-surfaced `reconciled: false` flag in one of
the three paths.

---

## 4. Canonical v1 authority model

Target direction. Does not authorize implementation beyond what's
already shipped (§14).

### A. Product identity

There must be one stable logical product identity even when a product
appears in OPPS, X LAB, Commerce, Café, or later Merchant/Bridge flows.

**Do not force all systems into one table immediately.** Use explicit
identity/link records between independently deployed systems.
`commerce.product_links` is existing, live proof that this
identity-linking pattern already works in this codebase — proof of
identity linking only, not evidence that pricing is unified across the
linked systems (see §3) — the direction is to extend the identity
pattern, not invent a new mechanism.

### B. Composition authority

`product_components` becomes the canonical operational composition/BOM
model for OPPS/X LAB. It should be able to represent, over time:

- blank/base product or material
- production/print method
- setup
- artwork/design decision
- finishes
- add-ons
- supplier inputs
- supplier cost
- quantity behavior
- production-specific metadata

**(future)** — none of these new fields are implemented by this
document. Direction only.

### C. Customer-facing selling price

For Client Products, `client_products.client_price` **remains the
agreed customer-facing selling price of record in v1** — this matches
verified current behavior (§3.1), it is not a new proposal.

Component totals may explain it, validate it, calculate proposed
prices, or reveal unresolved components — but must not silently
overwrite an agreed client price without an explicit pricing action.

### D. Commerce authority

Commerce **remains a valid storefront pricing surface for now.** It is
not subordinated by this document. An explicit future decision is
needed between:

1. Commerce becoming the canonical storefront projection of Client
   Product pricing, or
2. Commerce remaining a parallel product class with explicit price/
   link contracts.

**Until that decision is made, price synchronization between Commerce
and `client_products`/`product_components` must never be assumed.**
See §12A.

### E. Café

Café remains operationally independent. **Do not merge Café's database
into OPPS.** Convergence happens through a shared logical contract,
stable product identities, a shared pricing-strategy vocabulary, and
Bridge/event/API sync where needed — never premature database merging.

---

## 5. Canonical calculation contract

Conceptual pipeline **(future — describes the target shape, not one
function that exists today)**:

```
Product identity
  → composition/components
  → defaults/context
  → pricing kernel
  → proposed/computed price
  → agreed selling price
  → transaction snapshot
```

Four distinct concepts that must never be conflated:

| Term | Meaning |
|---|---|
| **Cost** | What Joint X pays / consumes. |
| **Computed price** | What the pricing engine calculates from rules/components. |
| **Agreed selling price** | The commercial price currently offered/contracted to the client. |
| **Transaction price** | The immutable unit/line amount frozen into a quote/order/invoice. |

These are not interchangeable, and no single live field today collapses
all four into one number — see §3.

---

## 6. Component pricing rules

Component quantity semantics (verified live in
`product_components.billing_mode` and
`_xos_freeze_client_product_price_breakdown`):

- **Per unit** — component amount multiplies with quantity.
- **Once per order** — a setup/tooling-style component is charged once
  and does not multiply by item quantity.

Worked example: parent component R250, setup component R300, quantity
10 → `R2,500 + R300 = R2,800`, **not** `R5,500`.

**Missing component pricing must surface explicitly** as
`unresolved_components` or an equivalent signal — this is already how
the live freeze kernel behaves (it returns an explicit
`unresolved_components` array for price-bearing components with no
`default_sell_price` set). **Never silently convert an unresolved
production component to R0 and present the product as fully
reconciled.**

---

## 7. Snapshot / historical truth rule

Source products and components are mutable. Once a quote, order, or
invoice is committed, its transaction record is **immutable historical
truth** — not a live view of current product/component state. At the
commit boundary:

- freeze the relevant composition/pricing facts into the transaction
  record
- later source edits must not rewrite historical prices or production
  configuration

`order_line_component_snapshots` is the existing, live foundation for
this rule. **(future)** — additional document-level snapshot needs
(e.g. a comparable freeze for invoice line composition detail) are not
implemented by this document; direction only.

---

## 8. Server authority rule

Use completed Invoice Slice 01
(`docs/architecture/canonical-pricing-slice-01-invoice-normalization.md`)
as the first production example.

**General rule**: browser/client calculations may be used for preview
and UX. They are **not** final authority at commit boundaries. Mutating
RPCs must calculate, recompute, or verify commercial totals server-side.

- Quote behavior (`save_opps_quote_with_items`) is already a stronger
  example of this rule — it recomputes header fields and per-line
  totals, not just the grand total.
- Invoice normalization (Slice 01) is now aligned further toward this
  model — the grand-total tolerance/override already existed; Slice 01
  extended server-side recomputation to the header fields and per-line
  `item_total`.
- Storefront checkout **should likewise** resolve price against its
  server-authoritative source — X LAB's legacy default-storefront path
  does not yet do this (§2E, §3.3). **(future)** — not addressed by
  this document or by Slice 01.

---

## 9. Pricing reconciliation

**(future)** — `computed_unit_price`, `price_reconciled`,
`price_difference`, `unresolved_components` are useful concepts but are
**not currently persisted live on `client_products`.** Do not document
them as existing columns anywhere else in this codebase's docs.

Possible future behavior:

- computed price = what composition/rules currently calculate
- agreed price = `client_products.client_price`
- reconciled = whether they match within policy

A mismatch should be visible and intentional, never a silent change to
commercial pricing.

---

## 10. Surface responsibilities

**OPPS**:
- primary configuration/editor surface
- composition/BOM
- supplier/cost context
- commercial operations
- quotes
- invoices
- orders
- production
- inventory (later)
- Counter capability

**X LAB**:
- customer-facing catalogue/storefront
- safe projection of configured products
- configuration choices allowed by the product contract
- checkout/order creation
- no exposure of internal supplier/cost/trade-secret data

**Café**:
- its own commerce/admin/counter experience
- separate Supabase project/database
- reuse the same conceptual contract where valuable
- independent availability if OPPS is unavailable

**Merchant/Bridge**: later. **Not a prerequisite for canonical pricing
v1.**

---

## 11. Product configuration UX direction

**(future)** — the long-term configuration model should support guided
product assembly such as:

```
base/blank
  → production method
  → placement/variant
  → artwork/design
  → finish/add-on
  → quantity
  → fulfilment
```

Do not require every product to use every stage — strategies remain
product-specific. Examples already live today: `FIXED_RETAIL`,
`PER_UNIT`, `SUPPLIER_MARGIN`, `PHOTOGRAPHY_SESSION`, and others in
Café's own pricing dispatcher. The architecture should allow multiple
strategies without creating separate, incompatible systems.

---

## 12. Immediate architecture decisions still open

None of these are resolved by this document. **Do not consolidate or
delete anything listed here until the relevant decision is made.**

**A. Commerce relationship** — does Commerce become the canonical
storefront projection for Client Products, or remain a parallel product
class? (§4D)

**B. Duplicate Quick Solution subsystem** — what is the long-term role
of the shared-DB `commerce.service_*` subsystem versus the separate
Café database's own subsystem of the same name? (§2F)

**C. Client Product reconciliation persistence** — whether, and when,
`computed_unit_price`/reconciliation metadata should become persisted
state on `client_products`. (§9)

**D. Pricing kernel ownership** — today, OPPS composition data
(`product_components`) and the actual pricing/freeze kernel
(`_xos_freeze_client_product_price_breakdown`,
`xos_add_composed_client_product_to_order`) have historical ownership
split across repos sharing one database, with no versioned contract
between them. The kernel contract needs to become explicit and
versioned.

**E. Cross-database identity contract for Café** — define the IDs/
events/API/Bridge mechanism later, without coupling the databases
directly.

---

## 13. Implementation sequence from here

**Completed**: Slice 01 — OPPS invoice pricing normalization
(`docs/architecture/canonical-pricing-slice-01-invoice-normalization.md`).

**Next**: this document — architecture/reference locked.

Then, in this order (not immutable — preserve the principles above if a
dependency changes):

- **Slice 02** — Client Product pricing composition/reconciliation
  contract. Focus: document/centralize computed composition output,
  agreed `client_price` vs. computed price, unresolved-component
  visibility, no silent repricing.
- **Slice 03** — OPPS Product Configuration surface improvements /
  shared component editor.
- **Slice 04** — X LAB/Commerce projection contract, after the Commerce
  authority decision (§12A).

Then: OPPS Counter reuse of canonical product capability, file/asset
reliability, orders/invoices workspace improvements, inventory
integration, customer accounts, Merchant/Bridge expansion.

---

## 14. Non-goals for v1

This document does **not** authorize:

- merging Café's database into OPPS
- deleting Commerce
- deleting either Quick Solution subsystem
- automatically repricing every existing Client Product
- replacing `product_components`
- rewriting old order snapshots
- migrating the legacy X LAB storefront blindly
- exposing internal cost/supplier data to customers
- making Merchant/Bridge a prerequisite
- a giant one-shot rewrite

---

## 15. Architecture invariants

1. One logical product can have multiple projections, but must have
   stable identity links.
2. Composition and selling price are related but not identical.
3. Cost, computed price, agreed price, and transaction price are
   distinct.
4. Historical transaction truth is immutable.
5. Client/browser math is never the final commit authority.
6. Unresolved inputs must be visible, not silently treated as zero.
7. OPPS is the operational configuration authority.
8. Customer surfaces expose customer-safe projections only.
9. Café remains independently operational.
10. Cross-system convergence happens through contracts/identity/Bridge,
    not premature database merging.
11. Canonical means one logical contract, not necessarily one physical
    database.
12. Incremental migration is preferred over a giant rewrite.
