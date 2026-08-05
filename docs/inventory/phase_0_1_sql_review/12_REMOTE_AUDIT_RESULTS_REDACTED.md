# Remote Phase 0 Audit Results - Redacted

**Execution date:** 2026-07-26  
**Target:** Linked production Supabase project; project reference, tenant UUIDs, row UUIDs, names, SKUs, order numbers, costs, and exact quantity totals are omitted from this document.  
**Execution scope:** Only `01_REMOTE_SCHEMA_AUDIT.sql`, `02_DATA_QUALITY_AUDIT.sql`, and SELECT-only result-capture forms of those same approved queries.  
**Mutation status:** No DDL, DML, grant, RLS, rollback, fixture, test, migration, or application command was executed.

## Output-handling note

The Supabase Management API returns only the final result set of a multi-statement query. The two approved files were first executed unchanged. Their omitted result sets were then collected with temporary SELECT-only capture queries derived from the same approved catalog and data-quality SELECTs. Temporary capture files were removed after this redacted review record was prepared.

The unchanged data-quality script's final result contained production row identifiers and legacy names/SKUs. Those raw rows were reviewed transiently and are intentionally not copied into the repository. This document retains only aggregates, tenant aliases, and baseline hashes.

## Remote runtime and extensions

| Item | Confirmed result |
| --- | --- |
| PostgreSQL | 17.6 (`server_version_num` 170006) |
| `pgcrypto` | Installed, version 1.3 in `extensions` |
| `citext` | Not installed |
| `pg_trgm` | Not installed |
| Security-invoker views | Supported by this PostgreSQL version; retain the proposed `security_invoker = true` design |

## Relevant relation presence

Present remotely with RLS enabled:

- `inventory`
- `suppliers`
- `purchase_orders`
- `orders`
- `products`
- `tenants`
- `tenant_memberships`

Not present remotely:

- `inventory_products`
- `inventory_variants`
- `inventory_supplier_products`
- `inventory_supplier_variants`
- `inventory_legacy_mappings`

This confirms that no proposed Phase 1 object was previously applied.

## Redacted inventory baseline

Exact quantity totals are intentionally omitted. The hashes bind tenant UUID + row count + exact quantity total and can be used to compare an authorized later audit without exposing the quantity in Git.

| Tenant alias | Rows | Archived rows | Quantity baseline | SHA-256 baseline hash |
| --- | ---: | ---: | --- | --- |
| `tenant_1` | 39 | 4 | Redacted | `4d42a016c44cc1499c126278a6f0c2f8f40266102bc62d46981ff6e8ab2053d2` |
| `tenant_3` | 1 | 0 | Redacted | `60fb88407b3a29260bf0ab333129af3f5c864b4d552af6b406eb2af8d1e343f8` |
| `tenant_4` | 1 | 0 | Redacted | `117b09b6b23f6f73aca8162539f3694eec00e95abe42b994622e812bf6e8312d` |

Total legacy inventory rows: **41**. Tenant aliases are stable only for this audit report and reveal no tenant identity.

## Data-quality findings

| Check | Result | Interpretation / required handling |
| --- | ---: | --- |
| Null inventory tenants | 0 | Current rows are tenant-assigned, although the remote column remains nullable. |
| Orphan tenant references | 0 | No inventory row points to a missing tenant. |
| Negative stock | 0 | No current negative recorded quantity. |
| Null stock | 0 | No null recorded quantity. |
| Exact duplicate SKU groups | 0 | Global unique constraint currently prevents these. |
| Case-insensitive SKU collision groups | 0 | No current collision, but future uniqueness must still be tenant-scoped. |
| Normalized duplicate-name groups | 5 | Requires human mapping review. |
| Near-duplicate-name groups | 6 | Suggestion only; never auto-merge. |
| Rows without preferred supplier | 41 | Every legacy row requires supplier review; null does not prove an orphan. |
| Orphan supplier references | 0 | No non-null missing supplier IDs. |
| Cross-tenant supplier references | 0 | No detected cross-tenant supplier relationship. |
| Rows without structured location | 41 | Every legacy row lacks usable structured-location evidence. |
| Rows without cost | 22 | Exact cost/margin reporting cannot be backfilled automatically. |
| Rows using reorder point 10 | 38 | Confirms the UI-default alert problem. Do not bulk-change during Phase 1. |
| Invalid order `products` JSON containers | 0 | All inspected containers are arrays. |
| Invalid PO `items` JSON containers | 0 | All inspected containers are arrays. |
| Blank order `inventory_item_id` fields | 39 | Optional blank values, not malformed legacy keys; exclude from UUID-link defect counts. |
| Valid UUID-shaped order inventory references | 1 | The one valid reference points to archived inventory while its order remains active. |
| Blank PO `inventory_item_id` fields | 5 | Optional blank values, not malformed legacy keys. |
| Missing valid order inventory references | 0 | No valid UUID points to a missing row. |
| Missing valid PO inventory references | 0 | No valid UUID points to a missing row. |
| Cross-tenant order/PO inventory references | 0 | None detected. |
| Active-order references to archived inventory | 1 | Must be resolved or explicitly preserved before mapping/cutover. |
| Active-PO references to archived inventory | 0 | None detected. |

## Legacy naming signals

Only aggregate counts are retained:

| Signal | Rows |
| --- | ---: |
| Names containing Daniel Slaves | 13 |
| Names containing JET | 2 |
| Names containing 180gsm/gms | 14 |
| Names containing 220gsm/gms | 9 |
| Names containing 230gsm/gms | 1 |
| Names containing 300gsm/gms | 3 |

These groups overlap. They are parser suggestions, not approved mappings. The remote rows confirmed spelling variation and inconsistent use of name versus SKU for colour/size, so original text must remain immutable.

## Security findings

### Critical - legacy owner-executed views are granted to `anon`

The remote views `active_orders`, `v_orders`, and `v_purchase_orders`:

- are owned by `postgres`;
- have no `security_invoker` option;
- grant direct privileges, including `SELECT`, to `anon`;
- expose order, client, purchase-order, and supplier fields in their definitions.

Because PostgreSQL views use owner permissions unless made security-invoker, this is a Phase 0 security blocker. Remediation requires a separately reviewed/authorized security change; none was made during this audit.

### High - default `PUBLIC` function execute remains effective

`has_function_privilege('anon', ..., 'execute')` returned true for:

- `current_user_tenant_ids()`
- `can_access_tenant(uuid)`
- `current_user_app_role()`
- `is_app_admin()`
- `assign_purchasing_tenant()`
- `get_storefront_catalog_for_host(text, integer)`

The storefront function is intentionally public. The internal helpers and trigger function are still reachable because revoking from `anon` alone does not remove PostgreSQL's default `PUBLIC` execute privilege. Future hardening must revoke from `PUBLIC` first and then grant only intended roles. The proposed Phase 1 functions already follow this pattern.

### Existing base-table grants

Supabase default ACLs grant broad table privileges to `anon`, `authenticated`, and `service_role`; RLS is enabled on all relevant base tables. No anonymous RLS policy was found on inventory, suppliers, purchase orders, orders, products, tenants, or memberships. The view issue above remains materially different because the views are not security-invoker.

## Audit completion statement

No raw production identifiers or row-level business data were saved in Git. No `current_stock` value was modified. No proposed Phase 1 SQL was executed.
