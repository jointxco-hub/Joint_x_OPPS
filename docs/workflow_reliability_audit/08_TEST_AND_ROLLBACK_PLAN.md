# Test and rollback plan

## Phase 1 test matrix

### Invoice persistence

- Create from order with 1, 20, and 100 products; reopen and compare line IDs/counts/values/totals.
- Simulate header insert, template sync, item insert, version insert, final read, and network failures. No partial invoice/item state may commit.
- Force item SELECT denial/error. UI must show error/retry, never zero items or Edit.
- Attempt empty/stale replacement. Server must reject and preserve prior rows.
- Concurrent editors: second stale save is rejected with reload/compare guidance.
- Draft approval must not alter or hide items. Approved/exported/paid/void reads return identical lines under authorized access.
- Cross-tenant user cannot read/update parent or lines, and cannot link cross-tenant order/client.

### Feedback/interactions

- One mounted toast renderer displays success/error in OPPS, XOS, and storefront shells where applicable.
- Each mutation disables its initiating control, changes accessible label, prevents double click, and reports outcome.
- Autocomplete closes on outside pointer, blur, Escape, selection, route/dialog close; keyboard navigation and focus return work across mobile/desktop.
- Failed optimistic order/relationship update rolls back and refetches.

## Invoice/order functional regression

- Create/edit/reopen contact aliases; verify intended client/order fields.
- Link/unlink from invoice and order; reverse view updates immediately; audit event records before/after.
- Exercise all address/phone propagation choices and target-unavailable cases.
- Approved correction creates linked revision/replacement; original remains immutable; paid restriction holds.
- Stable internal number remains unique; human label excludes year and includes client.

## PO tests

- Transition table tests for every role, valid/invalid source state, tenant, and direct combined command.
- Bulk mixed-eligibility preview and per-row success/failure; retry only failed rows.
- Remote delete failure must never become local/UI success. Only unused drafts can be deleted.
- Partial receipts across multiple deliveries reconcile ordered/received/outstanding/damaged/missing/substituted quantities.
- Inventory movement and receipt commit/rollback together; replayed request is idempotent.
- PO/order/supplier/project links reject nonexistent and cross-tenant targets.

## PDF tests

Generate golden PDFs/print screenshots for desktop and mobile entry points with 1/10/30/100 lines, long descriptions, images, zero and nonzero discounts/shipping/adjustment, totals near page boundary, payment details, terms, and multiple proofs. Assert no row split, repeated headers, totals/payment grouping, correct page count, and selectable/readable content where the chosen renderer supports it.

## Zoho tests

- Quoted commas/newlines/BOM, reordered headers, missing headers, duplicate rows, ambiguous email/name, and invalid money/status/date.
- Same import twice is idempotent.
- Partial job exposes exact row results and retry; OPPS-owned fields are unchanged unless explicitly approved.
- External IDs are unique within tenant/provider organization and cannot cross-link tenants.

## Deployment and rollback

1. Capture pre-deploy counts/checksums for affected rows in an isolated staging copy; do not export customer data into test logs.
2. Apply additive schema first, leaving existing readers compatible.
3. Deploy server/RPC and tests, then guarded UI.
4. Observe error rate, empty-invoice detail attempts, duplicate mutation IDs, line-count deltas, and RLS denials.
5. Roll back UI/feature flag first. Keep additive columns/tables/RPCs dormant; do not destructively reverse data-bearing migrations.
6. If a write defect is detected, disable the command, preserve audit/import job evidence, identify affected IDs through tenant-scoped reports, and restore only from verified snapshots/version history with explicit approval.

## Audit limitations

This was static local inspection. No production schema introspection, logs, records, storage objects, or role sessions were accessed. Before implementation, verify deployed migration state and reproduce in a tenant-isolated non-production environment. Do not run historical migrations against production.

