# XOS 3A — Product Authority Foundation

## Purpose

Introduces a generic, tenant-scoped, capability-gated, read-only product
catalog contract for XOS. This is the foundation phase only — no storefront,
no checkout, no PayFast, no product mutation, no GSB activation. GSB
currently has zero products; this phase makes it possible for a tenant to
*view* a catalog once one exists and the capability is turned on, nothing
more.

## Authority model — why `client_products` was not repurposed

`public.client_products` (audited before writing any code — see column
list below) is the existing managed/B2B/client-approval product system:

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

It models Joint X producing one custom, quoted item for one client, with
staff approval and production configuration baked into every row. It has
no concept of a client-browsable catalog, no `availability` state, no
per-tenant publish/draft lifecycle, and its `client_id` scoping is
one-client-at-a-time, not the tenant-wide "everyone at this workspace can
see this" model a catalog needs. Retrofitting a generic browsable-catalog
concept onto it would conflate two genuinely different authority models —
bespoke-quoted-production vs. tenant-catalog-browsing — for the sake of
reusing a table. `client_products` is untouched by this phase and remains
exactly what it already was.

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

Both new RPCs follow the exact pattern already established by
`get_xos_orders_for_host` / `get_xos_requests_for_host` /
`get_xos_files_for_host` / `create_xos_request_for_host` /
`get_xos_order_detail_for_host` (all read-audited before writing this
migration, all unmodified by it):

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
- `get_xos_products_for_host` additionally requires the `products`
  capability to be `enabled` for the resolved tenant, raising a second,
  equally generic `'Products are not available for this workspace.'`
  otherwise — the same message whether the capability is explicitly
  disabled or was never configured, and it never reveals anything about
  any *other* tenant's capability state.
- `EXECUTE` explicitly revoked from `PUBLIC` and `anon`, granted only to
  `authenticated` — written this way specifically because of the XOS 2.5
  discovery that a fresh `CREATE FUNCTION` on this project auto-grants
  `EXECUTE` to `PUBLIC` (which `anon`/`authenticated` both inherit)
  unless revoked from `PUBLIC` by name; naming individual roles in a
  revoke does not remove a separate `PUBLIC` grant.

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

`supabase/tests/xos_products_foundation.sql` — 24 checks, disposable
fixtures (three brand-new tenants, never touching Demo/GSB/Joint X real
data), wrapped in one transaction ending `rollback;`. Validated live
2026-08-23: **24/24 pass**, confirmed zero rows/schema persisted
afterward (`commerce` schema absent, zero `xos3a-test%` tenant rows).

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

## Rollback

Everything in this phase is additive and reversible:

```sql
drop function if exists public.get_xos_products_for_host(text, integer);
drop function if exists public.get_xos_capabilities_for_host(text);
drop table if exists public.tenant_capabilities;
drop schema if exists commerce cascade;
```

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
