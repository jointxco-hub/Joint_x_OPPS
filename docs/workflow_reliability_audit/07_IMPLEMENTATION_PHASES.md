# Recommended implementation phases

Each phase should have its own branch and deploy gate. Phase 1 is deliberately narrow and first.

## Phase 1 — invoice data-loss protection and mutation feedback

Recommended first branch: `fix/invoice-item-reliability`.

- Stop summary fallback after detail failure; display retryable errors.
- Require complete-item load proof before edit/save.
- Add unexpected-empty protection and optimistic concurrency.
- Replace client-side delete/reinsert with a transactional create/update RPC.
- Standardize the toast renderer/API; add pending/disabled/success/failure states.
- Invalidate detail, list, order-linked invoice, siblings, and export queries.
- Add invoice persistence/RLS/error-path tests and observability without sensitive payloads.

Exit gate: forced item-query and insert failures cannot display false emptiness or alter existing lines; duplicate submits are prevented.

## Phase 2 — relationships, contact cleanup, money labels, corrections

- Add audited invoice/order link/unlink from both surfaces using current cardinality.
- Fix contact alias serialization; report/migrate redundant Saved Contact values; simplify UI.
- Add explicit invoice/client/order propagation choices for phone/address.
- Persistently label shipping, adjustment, amount paid, and line discount.
- Add controlled void-and-replace/revision workflow and permissions.
- Introduce human display label while retaining stable internal number.

## Phase 3 — PO approval and procurement

- Complete permission audit and central command service.
- Separate approval and procurement states without duplicate equivalent fields.
- Add authorized direct commands and restricted-user submission flow.
- Replace archive/delete-oriented selection with reviewed bulk actions and exact results.
- Add safe card quick actions; move delete to constrained danger menu.

## Phase 4 — PO receiving and inventory movement integration

- Normalize/identify PO lines as needed.
- Add receipt headers/lines, quantities, exceptions, location, evidence, supplier variant.
- Atomically create inventory movements and linked-order updates.
- Preserve existing inventory identity strategy.

## Phase 5 — invoice attachments and PDF pagination

- Add invoice attachment model, direct upload, linked-order selection/dynamic links, visibility and PDF choices.
- Correct client/internal filtering and storage access.
- Replace raster slicing with semantic/row-aware pagination; repeat headers and keep totals/payment blocks together.

## Phase 6 — Zoho Import Centre

- Generalize the existing customer CSV preview into durable jobs/results.
- Add stable Zoho identifiers, idempotency, duplicate rules, per-row retry.
- Progress through clients/contacts, items/services/taxes, invoices, then payments.
- Preserve OPPS source-of-truth fields and make all overwrites explicit.

## Cross-phase controls

- Tenant scoping and RLS tests are mandatory in every phase.
- Relationship and lifecycle commands write audit events.
- Additive migrations only; rehearse on an isolated copy, never by replaying history on production.
- Feature flags/compatibility reads should permit rollback of UI before schema cleanup.

