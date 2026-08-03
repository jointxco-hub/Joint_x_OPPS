# Phase 0/1 SQL Package Open Decisions

These decisions must be resolved against the remote schema and owner policy before proposed SQL becomes a migration.

## Blocking technical decisions

1. **Remote supplier baseline:** The deployed supplier shape is confirmed, but the repository still lacks its reproducible `CREATE TABLE` baseline. Decide how and when to baseline it and whether `(tenant_id, id)` should receive a unique constraint. The draft continues to use a validation trigger rather than modifying suppliers.
2. **Existing view exposure:** Assign ownership and separately approve remediation for anonymous access to owner-executed `active_orders`, `v_orders`, and `v_purchase_orders`. This critical Phase 0 blocker is not authorization to alter those views now.
3. **Existing function exposure:** Assign ownership and separately approve removal of inherited `PUBLIC` execution from internal helper functions, preserving only intentionally public storefront behavior.
4. **Reviewer authorization source:** Confirm tenant `owner`/`admin` membership plus app-admin-with-membership is the correct Phase 1 reviewer policy. Ordinary members currently receive read-only identity/mapping access in this proposal.
5. **Supplier SKU uniqueness:** The proposal scopes case-insensitive supplier SKU uniqueness to tenant + supplier product + version. Confirm whether SKUs are actually unique across an entire supplier, across a tenant, or only within one supplier product.
6. **Internal variant uniqueness:** Confirm whether colour/size plus version is enough, or whether fit/cut/material attributes must also be variant dimensions.
7. **Version semantics:** Confirm whether `version` belongs on both master and variant records and whether a new `JET V2` uses a new internal code, a new version row, or both.
8. **Canonical normalization:** Approve canonical colour/size dictionaries, GSM precision, SKU generation, barcode policy, and staff override rules.
9. **Mapping evidence shape:** Approve the JSON evidence contract and ambiguity-code vocabulary before parser output is persisted.
10. **Batch registry:** Decide whether `batch_id` remains an opaque required UUID or receives a dedicated import/review batch table with owner, source file hash, counts, and status.
11. **Source snapshot retention:** Approve retention, export, and privacy rules for reviewer email and historical supplier/source text.

## Confirmed by the authorized remote audit

- PostgreSQL 17.6 supports `CREATE VIEW ... WITH (security_invoker = true)`.
- `pgcrypto` 1.3 is installed; `citext` and `pg_trgm` are not installed.
- The five proposed Phase 1 tables do not yet exist remotely.
- Remote suppliers require `id`, `name`, and `type`; `tenant_id` is nullable.
- Blank optional JSON inventory references are common and must not be classified as malformed UUIDs.
- The detailed confirmed drift and redacted data-quality findings are recorded in `12_REMOTE_AUDIT_RESULTS_REDACTED.md` and `13_REMOTE_SCHEMA_COMPARISON.md`.

## Existing audit decisions still open

1. Whether inventory tracks blanks, finished products, or both, and future WIP evidence.
2. When an order creates the internal demand commitment.
3. Whether tenants can ever share a physical stock pool.
4. Selling-price ownership between inventory, catalog, and invoicing.
5. Exact customer-facing availability behavior.
6. Whether the older `CatalogManagement` route will eventually be retired.

These do not authorize Phase 2. Internal demand timing, hard supplier allocation, physical balances, valuation lots, movements, and production integration require a separate design and approval.

## Confirmed assumptions represented in SQL

- `JET` is a tenant-scoped Joint X product class.
- Internal variants belong directly to internal products.
- Exact supplier products and supplier variants remain distinct identities.
- A supplier variant maps to a compatible internal variant of the same internal product.
- Internal products/variants do not contain physical balances.
- Supplier substitution and mixed-supplier production require explicit approval; this package stores compatibility metadata but implements no allocation behavior.
- Legacy names and recorded quantities remain immutable mapping evidence.
- Approval creates identity links only and never changes `current_stock`.
