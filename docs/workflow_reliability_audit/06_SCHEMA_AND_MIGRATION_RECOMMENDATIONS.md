# Schema and migration recommendations

These are recommendations only. No migration was created or executed.

## First: transactional invoice persistence

Add a tenant-scoped, finance-authorized RPC that accepts invoice header, complete lines, expected `updated_at`/version, and explicit `allow_empty_items=false`. It should:

1. lock/read the invoice and validate tenant/status/version;
2. validate and calculate/verify lines;
3. stage or upsert line changes without exposing an empty interval;
4. update header/totals;
5. record item versions and one activity event;
6. commit or roll back everything;
7. return the complete invoice.

The create equivalent must insert header and lines atomically. Add `NOT NULL` to `opps_invoice_items.invoice_id` after orphan verification. Consider a unique `(tenant_id, invoice_id, line_number)` constraint.

## Relationships and audit

- Convert `opps_invoices.source_order_id` to a nullable FK to `orders(id) ON DELETE SET NULL` after orphan/cross-tenant audit. Keep its existing index.
- Do not add an invoice-order junction now; current cardinality does not justify it.
- Add a general or domain-specific audit table/event function for invoice-order and PO-order link changes with tenant, entity IDs, before/after, reason, actor, request/idempotency ID, and timestamp.
- Resolve `orders.linked_po_id` versus `purchase_orders.linked_order_id`. Prefer the latter as authoritative; backfill and deprecate the former only after discrepancy reporting.
- Add FKs for `purchase_orders.supplier_id`, `project_id`, and `linked_order_id` after data cleanup.

## Invoice corrections

Add only if equivalent fields do not exist:

- `revision_of_invoice_id` or `replaces_invoice_id` FK
- `revision_number`
- `correction_reason`
- `voided_at`, `voided_by`, `void_reason`
- optional `replacement_invoice_id` (or derive reverse relationship)

Add constraints preventing cross-tenant revision links and ambiguous replacement chains. Paid corrections require payment/credit-note design before schema changes.

## Human display name

Keep `invoice_number` and its tenant unique index unchanged. Prefer a derived UI label over a stored name. If a stored label is required, add `display_label` without uniqueness and never use it for integration identity.

## Invoice attachments

Recommended `opps_invoice_attachments` fields: `id`, `tenant_id`, `invoice_id`, optional `source_order_id`/source file identifier, `link_mode`, `storage_bucket/path` or private reference, name/type/size/checksum, `visibility`, `include_in_pdf`, `sort_order`, `created_by/at`, `updated_by/at`, archive fields. Add tenant RLS requiring invoice access and private storage paths. Avoid public-assets for sensitive records.

## Zoho imports

Add durable import infrastructure before importing financial entities:

- import job: tenant, entity type, source file/checksum, mapping version, mode, status, actor, totals, timestamps;
- import row: job, source row/key, matched OPPS ID, Zoho ID, action, status, normalized payload/hash, validation/errors;
- external reference table or explicit per-entity columns: tenant, provider/org, entity type, OPPS ID, Zoho ID, last-seen version/status, timestamps; unique provider/org/entity/Zoho ID.

Do not use `zoho_exported_at`/`zoho_imported_at` as substitutes for stable external IDs. Keep OPPS-owned operational fields protected by per-field import policy.

## PO workflow and receiving

Add separate approval/procurement fields only after checking production schema for equivalents. Add command/audit metadata (`approved_by/at`, rejection reason, ordered_by/at, buyer, expected date, location). Normalize PO lines before receiving if exact line identity is required; embedded JSON is inadequate for durable receipt reconciliation.

Recommended receiving entities: `purchase_order_receipts` and `purchase_order_receipt_lines`, plus links to the existing inventory movement structure. Enforce nonnegative quantities, no unauthorized over-receipt/substitution, same tenant, and idempotency.

## RLS/permissions

- Define PO capabilities (create/edit draft, submit, approve, order, receive, archive, delete) in database functions/policies or security-definer command RPCs.
- Align invoice frontend role checks with invoice RLS; `getFinanceLevel() > 0` is not equivalent to database levels 1/2.
- Restrict delete to unused drafts in the database, not only UI.
- Preserve existing tenant policies and use additive migrations. Never replay historical migrations against production.

## Pre-migration data reports

Before any constraint: orphan invoice source IDs; cross-tenant links; invoice items without parent/tenant; duplicate line numbers; conflicting PO/order links; missing supplier/project/order targets; invalid PO statuses; saved-contact values distinct from WhatsApp names; attachment references outside tenant-prefixed private paths.

