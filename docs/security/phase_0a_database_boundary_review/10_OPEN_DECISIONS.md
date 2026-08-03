# Phase 0A Remaining Owner Decisions

1. **Unknown callers:** Aggregate statement statistics prove all three views are used, but PostgreSQL cannot attribute the callers. Decide whether compatibility retention is sufficient for Phase 0A or require API gateway/query-log attribution first.
2. **Service role:** Confirm that service-role SELECT/EXECUTE compatibility should remain until every server consumer is named.
3. **Offline baseline:** Approve a sanitized, data-free legacy schema-only artifact so the incomplete repository baseline can reset in a disposable environment.
4. **Purchasing trigger:** Approve generic missing/cross-tenant parent errors and explicit caller-tenant validation.
5. **Rollback posture:** Approve security-safe rollback, which does not recreate the old anonymous/PUBLIC exposure.
6. **Migration authorization:** Approve the final SQL only after disposable reset, tests, rollback, data-hash, and repeatability evidence passes.

Resolved:

- No view is removed because usage is confirmed.
- View output contracts remain 25, 33, and 16 columns respectively.
- Archived inventory was linked before archive, has a complete historical snapshot, is no longer operationally active, and needs no exception marker.
- Blank optional references remain separate from malformed nonblank values.
- PostgreSQL 17.6 supports security-invoker views.