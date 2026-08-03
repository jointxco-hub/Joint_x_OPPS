# Invoice and order target workflow

## Safety invariants

1. Never present an invoice as editable until header and line items are confirmed loaded for the active tenant.
2. Never replace saved lines with an empty or incomplete UI state.
3. Header, lines, totals, templates, version history, and activity commit atomically.
4. Approved invoices are immutable financial snapshots. Corrections are explicit, authorized, reasoned, and auditable.
5. Relationship and propagation mutations show pending, success, and failure states and cannot be double-submitted.

## Create/edit flow

- Create from order produces a draft with copied client/order snapshots and relational line items in one transaction.
- Editor receives a detail payload containing `items_loaded`, `row_version/updated_at`, and the complete item set.
- Save rejects stale versions and unexpected zero-line replacements. The user may explicitly delete all lines only through a separately confirmed action, if business rules allow it.
- After save, invalidate invoice list/detail, order-linked invoices, client invoice history, siblings, and export candidates as applicable.
- Detail load failure renders Error + Retry, never a zero-item invoice.

## Link/unlink

- Invoice drawer: “Link order” searchable tenant-scoped order picker; “Unlink order” confirmation.
- Order drawer: list all linked invoices; link an existing eligible invoice; unlink a selected invoice.
- Use `opps_invoices.source_order_id` for current cardinality. Add a real FK/index and same-tenant guard.
- Audit old/new order, invoice, actor, timestamp, reason, and entry point.

## Customer/contact and address updates

The invoice always holds snapshots. Before saving changed phone/address on a draft, show:

- Invoice only (default)
- Invoice + update client
- Invoice + update linked order
- Invoice + update both

The review lists exact field-level changes and unavailable targets. Approved-invoice snapshots cannot be propagated by editing the approved record; correction/replacement workflow applies.

Use client name as canonical billing/customer identity. Keep WhatsApp name as a communication alias. Remove Saved Contact Name from new/edit surfaces after a migration report identifies unique historical values and safely maps or preserves them.

## Money fields

- Persistent labels: Shipping charge, Adjustment, Amount paid.
- Line editor label: Discount per line; review label: Discount total (calculated).
- Do not add another top-level discount field unless business rules explicitly require invoice-level discount allocation.

## Approved invoice correction

Preferred path:

1. User chooses Correct invoice.
2. System checks permission and downstream state (exported/imported/paid).
3. User supplies reason.
4. System creates a new draft revision/replacement linked to the original.
5. Original remains immutable and is voided only when valid; paid invoices require a credit/refund accounting path, not a simple void.
6. Activity shows original, replacement, reason, actor, and Zoho disposition.

Existing Duplicate and Void actions can be reused behind these controls, but current free-standing actions are not a full correction workflow.

## Attachments

Add invoice-level attachment records rather than adding more JSON to invoice rows. Each record needs tenant, invoice, optional source order/file reference, immutable snapshot versus dynamic link, storage reference, file metadata, `visibility` (`internal`/`customer`), `include_in_pdf`, sort order, actor, and timestamps.

Support direct upload and selection from linked order without duplicating storage objects. Client renderers must require customer visibility; PDF inclusion is a separate explicit choice. Item proofs can migrate into or coexist with this model.

## PDF target

- Prefer semantic paginated HTML/CSS for browser print or a row-aware PDF engine.
- Use real table headers capable of repeating.
- Apply keep-together to each line row, totals block, payment guidance/details, and attachment caption.
- Allow long descriptions to wrap within a row but move the whole row when it fits on the next page.
- Establish a desktop/mobile-independent document width and print stylesheet.
- Test 1, 10, 30, and 100 lines, long text, thumbnails, zero/nonzero money fields, and proof pages.

## Zoho Import Centre boundary

OPPS remains authoritative for operational clients, contacts, items/services, order links, attachments, and workflow. Zoho imports accounting references/statuses without silently overwriting OPPS-owned fields.

Import progression: clients/contacts first, then items/services/taxes, invoices, and payments. Every import uses parse → map → validate → duplicate match → preview → explicit commit → row results → retry/export errors. Persist Zoho organization/entity IDs, source version/hash, job ID, and last-seen status. Never rely solely on mutable names.

