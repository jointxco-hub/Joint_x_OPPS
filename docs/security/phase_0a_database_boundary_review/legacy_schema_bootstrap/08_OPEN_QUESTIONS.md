# Open Questions and Blockers

1. **Duplicate migration versions:** The chain contains duplicate version prefixes `20260523` and `202606020001`. Confirm an owner-approved disposable ordering/history treatment before claiming that `supabase db reset` can apply the chain. The bootstrap does not rename production migrations.
2. **Checked-in demo data:** The repository migration chain inserts synthetic tenants, clients, requests, files, orders, products, and storage metadata. Decide whether disposable validation should apply those migrations unchanged and whitelist their synthetic rows, or use reviewed schema-only variants. The bootstrap does neither automatically.
3. **Inferred legacy types:** Confirm or replace inferred definitions for order JSON fields, inventory stock type, transaction base columns, task/file tables, and client request/readiness tables using an authorized sanitized catalog capture.
4. **Purchase-order overlap:** Approve pre-creating the minimum confirmed PO superset in the bootstrap even though an incomplete `CREATE TABLE IF NOT EXISTS` exists later in the chain.
5. **Supplier constraints:** The remote type/payment constraint expressions and exact defaults were not captured. Confirm whether the disposable minimum should intentionally remain less restrictive.
6. **View source types:** Column order/count and expressions are confirmed, but every underlying remote column type was not independently captured. Contract tests must compare generated types before migration approval.
7. **Storage demo migration:** Confirm whether local validation may allow the checked-in insertion into `storage.objects`; it must never target non-local storage.
8. **Baseline completeness:** The package has not been executed. A clean local migration run remains the authoritative way to discover any additional compile-time dependency.

These blockers prevent claiming a validated clean build. They do not justify a production connection or production-derived dump.



