# Phase 0A Sanitized Legacy Schema Bootstrap

Review-only, proposed, and unexecuted. This package reconstructs the minimum legacy schema needed before the checked-in migration chain can be evaluated in an isolated local Supabase/Docker lab.

It is not a production migration and must never be copied into the normal migration chain without a separate owner review. It contains no rows, production identifiers, business quantities, credentials, project references, or Inventory Phase 1 objects.

## Files

1. `01_OBJECT_INVENTORY.md` - object ownership and create/leave decisions.
2. `02_LEGACY_SCHEMA_BOOTSTRAP_PROPOSED.sql` - data-free disposable bootstrap.
3. `03_SCHEMA_PROVENANCE.md` - confirmed versus inferred sources.
4. `04_SANITIZATION_REPORT.md` - sensitive-data review.
5. `05_BOOTSTRAP_VALIDATION_PROPOSED.sql` - staged structural assertions.
6. `06_BOOTSTRAP_ROLLBACK_PROPOSED.sql` - bootstrap-only rollback.
7. `07_EXECUTION_SEQUENCE.md` - exact disposable workflow.
8. `08_OPEN_QUESTIONS.md` - blockers and owner decisions.

## Boundary

The bootstrap creates legacy base objects and the three confirmed pre-remediation views. Checked-in migrations remain responsible for later tenant tables, RLS helpers, policies, operational tables, storefront functions, and Phase 0A itself.

`purchase_orders` is the one intentional overlap: the repository creates an incomplete version later, while Phase 0A requires confirmed deployed columns absent from that definition. Pre-creating the minimum confirmed shape lets the later idempotent migration patch it without inventing a production reconciliation migration.

