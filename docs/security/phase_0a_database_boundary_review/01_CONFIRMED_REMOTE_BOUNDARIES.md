# Confirmed Remote Boundaries and Final Treatment

The authorized investigation is summarized in `13_READ_ONLY_INVESTIGATION_RESULTS.md`. PostgreSQL 17.6 supports security-invoker views.

## Final view treatment

| View | Dependencies (RLS enabled) | Known usage | Final treatment |
| --- | --- | --- | --- |
| `active_orders` | orders | Aggregate statement statistics show use | Preserve 25-column contract and non-archived filter; add security-invoker plus tenant-membership predicate; SELECT only authenticated/service; add explicit-tenant RPC. |
| `v_orders` | orders, clients, projects, purchase_orders | Aggregate statement statistics show use | Preserve 33-column contract and joins; add security-invoker plus order-tenant predicate; SELECT only authenticated/service; add explicit-tenant RPC. |
| `v_purchase_orders` | purchase_orders, suppliers | Aggregate statement statistics show use | Preserve 16-column contract and status filter; add security-invoker plus PO-tenant predicate; SELECT only authenticated/service; add explicit-tenant RPC. |

All are owned by postgres, currently owner-executed, and currently grant all table privileges to anon, authenticated, and service role. No view is removed because caller identity is unknown and use is confirmed.

## Final role boundary

| Role | Views | RLS helpers | Trigger helper | Tenant RPCs | Storefront RPC |
| --- | --- | --- | --- | --- | --- |
| anon | none | none | none | none | execute |
| authenticated | SELECT, tenant-membership filtered | execute | none | execute | execute |
| service role | SELECT compatibility | execute | execute/maintenance | execute | execute |
| owner | ownership | ownership | ownership | ownership | ownership |

PUBLIC receives no internal function execution. All scoped functions use `pg_catalog, public`. App-admin status does not bypass the explicit membership predicate embedded in the finalized views/RPCs.

## Archived reference

The item was archived after order creation. The order is no longer operationally active, and the line retains historical name, size, colour, and quantity. No exception exists or is required. Preserve the historical link and block only new selection.