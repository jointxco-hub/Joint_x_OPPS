# Phase 0A Final Read-Only Investigation Results

**Investigation date:** 2026-07-26  
**Scope:** Authorized SELECT-only database queries, repository searches, deployed Edge Function inventory/source inspection, and aggregate statement statistics.  
**Redaction:** No project reference, tenant/order/inventory UUID, customer identity, SKU, price, quantity, or raw order line was retained.

## Archived inventory reference conclusion

The single valid archived-inventory reference was reported as `order_1`, line 3, linked to `inventory_1`.

| Question | Confirmed result |
| --- | --- |
| Archive timing | Inventory was archived after the order was created. |
| Operational state | The order is not currently operationally active under the package rule: unarchived order and status other than cancelled/delivered. |
| Historical name | Present |
| Historical size | Present |
| Historical colour | Present |
| Historical quantity | Present |
| Existing exception marker | Absent |

Conclusion: the line has a sufficient historical snapshot. Preserve the archived reference for traceability and block the item only from new selection. No exception marker or row repair is required for this completed/non-operational order. Do not unarchive or relink it.

The reference-shape audit reconfirmed 39 blank optional order references, one valid UUID-shaped order reference, and five blank optional PO references. No malformed nonblank reference was returned.

## View definitions, RLS, and output contracts

PostgreSQL 17.6 is deployed, so security-invoker views are supported.

| View | Dependencies, all RLS enabled | Output contract | Current grants | Final treatment |
| --- | --- | ---: | --- | --- |
| `active_orders` | `orders` | 25 columns | All table privileges to anon/authenticated/service role; owner postgres | Preserve exact columns/filter, add `security_invoker`, add tenant-membership predicate, revoke all broad grants, restore SELECT only to authenticated/service role, add explicit-tenant RPC. |
| `v_orders` | `orders`, `clients`, `projects`, `purchase_orders` | 33 columns | Same broad grants | Preserve exact joins/columns, add `security_invoker` and order-tenant membership predicate, SELECT only to authenticated/service role, add explicit-tenant RPC. |
| `v_purchase_orders` | `purchase_orders`, `suppliers` | 16 columns | Same broad grants | Preserve exact joins/status filter/columns, add `security_invoker` and PO-tenant membership predicate, SELECT only to authenticated/service role, add explicit-tenant RPC. |

No view will be removed in Phase 0A because aggregate statement statistics show current queries against all three.

## Consumer investigation

- Repository application/generated-client/reporting search: no direct table/API reference to any of the three views. `Clients.jsx` uses `active_orders` only as a computed client metric name.
- Checked-in Edge Functions: no reference.
- Deployed Edge Functions: all deployed bundles were inventoried; the eleven not checked in locally were downloaded temporarily, searched, and removed. No reference was found.
- Database dependent views: none.
- Database routine text: `get_customer_account(text,text)` matched the token `active_orders`, but inspection confirmed it is a JSON/statistics alias, not a query against the view.
- Database scheduled jobs: `pg_cron` is not installed, so no database cron consumer exists.
- Aggregate statement statistics since the retained statistics reset show three statement shapes/15 calls involving `active_orders`, one shape/nine calls involving `v_orders`, and one shape/eight calls involving `v_purchase_orders`.

The statement statistics prove use but do not identify whether the callers are PostgREST, a generated/external client, reporting, or an administrator. Therefore output shape and authenticated SELECT compatibility must be preserved. API gateway logs outside PostgreSQL were not available through the approved query path.

## Final function privilege matrix

All functions are owned by `postgres` and currently use `search_path=public`.

| Function | Current effective roles | Final roles | Final mode/path |
| --- | --- | --- | --- |
| `current_user_tenant_ids()` | PUBLIC effective; authenticated/service; anon effective through PUBLIC | authenticated, service role, owner | SECURITY DEFINER; `pg_catalog, public` |
| `can_access_tenant(uuid)` | PUBLIC effective; authenticated/service; anon effective through PUBLIC | authenticated, service role, owner | SECURITY DEFINER; `pg_catalog, public` |
| `current_user_app_role()` | PUBLIC effective; authenticated/service; anon effective through PUBLIC | authenticated, service role, owner | SECURITY DEFINER; `pg_catalog, public` |
| `is_app_admin()` | PUBLIC effective; authenticated/service; anon effective through PUBLIC | authenticated, service role, owner | SECURITY DEFINER; `pg_catalog, public` |
| `assign_purchasing_tenant()` | Explicit anon/authenticated/service plus PUBLIC | service role and owner only; trigger execution retained | SECURITY DEFINER; `pg_catalog, public`; generic parent errors |
| `get_storefront_catalog_for_host(text,integer)` | Explicit anon/authenticated/service; no PUBLIC | unchanged named roles plus owner; no PUBLIC | SECURITY DEFINER; `pg_catalog, public` |
| Three new tenant RPCs | Not present | authenticated, service role, owner; no anon/PUBLIC | SECURITY INVOKER; `pg_catalog, public` |

The finalized migration is `11_PHASE_0A_SECURITY_MIGRATION_PROPOSED.sql`. It is deliberately retained under documentation and was not copied to the production migration path.

## Remaining evidence limit

Unknown statement callers must be identified from API gateway/query logs before direct view access can be deprecated. This no longer blocks shape-preserving containment, but it blocks view removal and blocks removing authenticated SELECT compatibility.

## Non-action confirmation

Only read-only queries and remote source downloads were performed. The temporary downloaded sources and query files were removed after review. No database definition, privilege, policy, data, order, inventory row, quantity, or production workflow was changed.
