# Phase 0A Validation Checklist

## Completed read-only evidence

- [x] Confirm PostgreSQL 17.6 security-invoker support.
- [x] Capture all three exact view definitions, dependencies, RLS flags, grants, and output contracts.
- [x] Capture target function owners, modes, ACLs, effective roles, and search paths.
- [x] Review repository, generated/local client, reporting, checked-in/deployed Edge Function, database routine, dependent-view, cron, and aggregate statement evidence.
- [x] Confirm all three views have statement usage and must not be removed.
- [x] Resolve archived-reference timing, historical snapshot, operational state, and exception presence.
- [x] Retain only redacted conclusions in Git.

## Static migration review

- [ ] Owner reviews `11_PHASE_0A_SECURITY_MIGRATION_PROPOSED.sql` line by line.
- [ ] Confirm 25/33/16-column output contracts match the captured remote contracts.
- [ ] Confirm no table DDL, data DML, RLS-policy, inventory identity, reservation, or workflow change exists.
- [ ] Confirm final function role matrix and safe search paths.
- [ ] Confirm migration and rollback remain idempotent/security-safe.

## Disposable validation

- [ ] Supply the reviewed data-free legacy schema-only baseline required by file 12.
- [ ] Execute file 12 only in a local/disposable environment with no production credentials.
- [ ] Apply file 14 seed, file 06 read-only tests, file 15 rollback-only operation tests, storefront tests, and application regressions.
- [ ] Prove pre/post/rollback/reapply row hashes and current_stock totals are identical.
- [ ] Prove rollback never restores anon/PUBLIC access.
- [ ] Reapply and prove repeatable deployment.

## Production gate

- [ ] Identify unknown statement callers from API/query logs or explicitly accept compatibility retention.
- [ ] Owner resolves every item in `10_OPEN_DECISIONS.md`.
- [ ] Owner approves disposable evidence, migration hash, and rollback evidence.
- [ ] A separate request explicitly authorizes creation of a real timestamped migration.
- [ ] A later, separate request explicitly authorizes production application.