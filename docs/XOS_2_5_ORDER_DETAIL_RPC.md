# XOS 2.5 — Order Detail RPC (Decision 2)

## Signature

```sql
get_xos_order_detail_for_host(p_hostname text, p_order_number text) returns jsonb
```

New, additive function — `get_xos_orders_for_host` is unchanged. Migration:
`supabase/migrations/20260818090002_xos_order_detail_rpc.sql`.

## Security

Identical contract to every other XOS RPC (`get_xos_orders_for_host`,
`get_xos_requests_for_host`, `get_xos_files_for_host`,
`create_xos_request_for_host`):

- `SECURITY DEFINER`, `SET search_path TO 'public'`.
- Tenant derived from `resolve_authenticated_tenant_host(p_hostname, 'xos_admin')`
  — requires `auth.uid()` and active membership via `can_access_tenant()`.
- Order ownership verified with `o.order_number = p_order_number and o.tenant_id = resolved_tenant_id`
  — a browser can never request another tenant's order by guessing an
  order number, and the hostname/tenant is never browser-supplied as a raw id.
- `EXECUTE` granted to `authenticated` only, no `anon` grant.

## Output shape

```json
{
  "order_number": "...",
  "client_name": "...",
  "status": "...",
  "stage": "...",
  "created_at": "...",
  "due_date": "...",
  "total_amount": 0,
  "tracking_reference": "...",
  "items": [
    { "name": "...", "size": "...", "color": "...", "quantity": 0, "image_url": "...", "price": 0 }
  ]
}
```

`status`/`stage` are passed through the same raw values `get_xos_orders_for_host`
already returns — the frontend's existing `getClientSafeOrderStatus` /
`getOrderStageDetail` mapping (`src/lib/xosOrderStatus.js`, unchanged)
applies to them exactly as it does today.

## Why a new RPC, not enlarging the existing one (Option B, as approved)

`orders.products` is the only item-storage mechanism in this schema (no
separate line-items table). Its real shape (sampled from live orders)
includes operator-only fields alongside client-relevant ones:

```json
{
  "name": "Sweater — 360g (Midweight)", "size": "L", "color": "", "notes": "",
  "price": "134", "source": "custom", "line_id": "...", "category": "",
  "quantity": "24", "image_url": "", "catalog_item_id": "", "inventory_item_id": "",
  "selected_addons": [], "selected_print_options": []
}
```

A dedicated on-demand RPC keeps the Orders list payload small (items only
ever fetched when a detail sheet opens) and gives a clean least-privilege
boundary: the function builds a brand-new `jsonb_build_object` per item
from an explicit allowlist — it never passes `orders.products` through.

**Excluded, deliberately:** `catalog_item_id`, `inventory_item_id` (internal
catalog references, no client-facing purpose), `notes` (free-text operator
shorthand — sampled a real example, `"GURU print "` — ambiguous whether
ever meant for the client, so kept out), `source`, `selected_addons`,
`selected_print_options`, and anything about supplier/cost/margin (none of
these fields exist on `orders.products` today, but the allowlist approach
means a future operator-only field added to that jsonb blob can never leak
through this RPC without an explicit code change).

`image_url` is already a public storage bucket URL
(`.../storage/v1/object/public/xlab-assets/...`) — safe to return directly,
no signing needed. `price` is the client's own committed line amount, not
a supplier cost, so it's included per the approved output list.

## Validation performed (read-only, no function deployed yet)

The riskiest part of this RPC — extracting typed values out of
`orders.products`, where real data has quantity/price stored as both
strings (`"24"`) and native numbers (`10`) depending on which flow created
the order — was tested directly against three real orders (`ORD-MSXASYE8`,
`XL-260811-7258`, the Demo XOS seed order) as a plain read-only `SELECT`
mirroring the function's item-extraction logic. First attempt used
`jsonb_array_elements(...) with ordinality as item` and failed
(`operator does not exist: record ->> unknown` — `with ordinality`
requires an explicit two-column alias). Fixed to
`with ordinality as t(item, ord)`; re-ran and got correctly-typed output
for all three orders, mixed string/numeric sources included. The migration
file was corrected to match before being considered done — this is the
exact syntax the deployed function uses.

## Applied to production (2026-08-18, controlled cutover)

Same `PUBLIC`-default-grant issue found on migration 20260818090001 also
applies to any fresh `CREATE FUNCTION` on this project, not just
drop+recreate ones — confirmed live: immediately after creating this new
function, `anon` had `EXECUTE` via the inherited `PUBLIC` grant despite
never being named. Added an explicit `revoke ... from public;` before the
`authenticated` grant. Reconfirmed: `anon` → denied at the grant level
(`permission denied for function`, a stronger signal than the internal
tenant check even firing), `authenticated`/`postgres`/`service_role` → as
intended.

Full positive + negative test matrix run against the live deployed
function with simulated sessions: real order detail returned correctly
(2 items, all client-safe fields populated, all excluded fields absent by
inspection); anonymous denied at the grant level; authenticated outsider
denied (`XOS access denied`); authorized member requesting a real order
from a different tenant denied safely (`Order not found` — does not leak
whether the order exists elsewhere); nonexistent order same safe
not-found; malformed hostname denied; service_role/postgres confirmed
to retain access.

## Frontend wiring

- `src/lib/xosModules.js`: new `getXosOrderDetail({ hostname, orderNumber })`,
  same pattern (missing-RPC detection, try/catch) as the three existing
  XOS module functions.
- `src/lib/useXosData.js`: new `useXosOrderDetail({ hostname, orderNumber, enabled })`
  — its own query key (`['xos-order-detail', hostname, orderNumber]`), only
  enabled while a detail sheet is actually open. The Orders list query
  (`useXosOrders`) is untouched — it still only ever fetches summary rows.
- `src/pages/xos/XOSOrders.jsx`: `OrderDetailSheet` gained an
  `OrderItemsSection` that calls the new hook with `enabled={open}` (the
  sheet's own open state). States: loading (`ListSkeleton`), error
  (`ErrorState` with retry via `refetch`), success (renders items — image
  thumbnail with a fallback icon when `image_url` is empty, name,
  "size / color" joined as a variant string, quantity, and per-item price).
  Existing summary-level fields (status badge, placed/due/item count/order
  total/customer/tracking) are untouched.
