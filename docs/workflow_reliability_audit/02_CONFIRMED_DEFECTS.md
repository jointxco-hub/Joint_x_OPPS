# Confirmed defects and reproduction traces

`Confirmed` means the failure mechanism is present in the current local code. Runtime data was not inspected, so historical row contents and production policy state were not assumed.

## Priority findings

### INV-01 — incomplete invoice detail can be presented and edited as an empty invoice (critical)

- Reproduce: open an invoice whose detail/item request fails (network, policy, tenant mismatch, or transient Supabase error). `Invoices.jsx` supplies `detailQuery.data || selectedInvoice`; the fallback is the list summary and has no `items`. `InvoiceDetailDrawer.jsx` converts absent items to `[]` and, after loading ends, does not render the query error. For a draft, Edit remains available.
- State/query: `selectedInvoice` is a summary row; `detailQuery` calls `getInvoice(id, {includeItems:true})`; `listInvoiceItems()` queries `opps_invoice_items` by both `invoice_id` and `tenant_id`.
- Database: `opps_invoices.id/tenant_id`; `opps_invoice_items.invoice_id/tenant_id`.
- Root cause/evidence: detail error is discarded; summary and full-detail types are interchangeable; no completeness marker prevents edit. `InvoiceCreateFlow` initializes a starter row when `initialInvoice.items` is absent/empty.
- Severity/data loss: critical. A read failure looks like saved emptiness. If the user creates/replaces lines and saves, the old lines can be replaced.
- Fix: never fall back to a summary after a detail failure; show an error/retry state; require `items_loaded === true` before edit/save; use a dedicated detail type/query boundary.

### INV-02 — line replacement is non-atomic and can destroy existing rows (critical)

- Reproduce: edit a draft invoice and trigger a failure after its existing lines are deleted (template sync/insert/version insert/network interruption). `updateInvoice()` deletes all rows and then inserts replacements in separate requests.
- State/query: the editor submits the whole `items` array; `updateInvoice()` computes totals, deletes `opps_invoice_items`, inserts new rows, then writes versions.
- Database: `opps_invoice_items`; `opps_invoice_item_templates`; `opps_invoice_item_versions`.
- Root cause/evidence: client-side delete-and-reinsert without a database transaction/RPC. Creation is also parent-first and child-second, so a failed child insert can leave an empty parent invoice.
- Severity/data loss: critical and permanent without backup/audit reconstruction.
- Fix: transactional tenant-scoped RPC; reject an unexpected empty replacement; preserve old rows until all validation/template work succeeds; return the committed invoice and items atomically.

### UI-01 — notification system mismatch makes Sonner feedback invisible (high)

- Reproduce: complete an action that calls `toast.success()` imported from `sonner` (invoice, order, PO, upload). `App.jsx` mounts `@/components/ui/toaster`, which renders the separate `use-toast` store. It never mounts `@/components/ui/sonner`.
- State/mutation: affects most page and drawer mutations.
- Root cause/evidence: producer and renderer belong to different toast systems.
- Severity/data loss: high operational risk; repeated submissions and accidental duplicate records.
- Fix: standardize on one toast system, mount it once in every app shell, and add a smoke test.

### ORD-01 — contact aliases are dropped from order writes (high)

- Reproduce: enter WhatsApp Name or Saved Contact Name in `NewOrderDrawer`, `OrderForm`, or inline drawer editing; save/reopen.
- State/query: forms set `whatsapp_name` and `saved_contact_name`; `dataClient.entities.Order.create/update` calls the Order serializer.
- Database: both columns exist on `orders` and `clients` from `202605260001_order_client_contact_aliases.sql`.
- Root cause/evidence: the Order serializer in `src/api/dataClient.js` does not include either field, so they are removed before Supabase insert/update. Client updates can persist them, creating client/order divergence.
- Severity/data loss: high; user-entered order snapshot data is silently discarded.
- Fix: include both fields in the serializer, test create/edit/reopen, then deliberately remove the redundant Saved Contact UI only after a migration/data decision.

### ORD-02 — inline relinking/edits have no reliable pending or success state (high)

- Reproduce: change an order field or PO link in `OrderDrawer`/`PurchaseOrderTab`, then click again because nothing visible confirms the save.
- State/query: `Orders.handleDrawerUpdate()` immediately patches `selectedOrder` and calls a shared mutation. It has an error toast, but no success toast and exposes no per-field `isPending`; PO link Select is not disabled. The global toast mismatch can also hide the error.
- Database: whichever `orders` column is edited, notably `linked_po_id`.
- Root cause/evidence: optimistic state is applied before confirmation with no rollback, correlation, status, or acknowledgement.
- Severity/data loss: high; duplicate/racing writes and false confidence.
- Fix: mutation state per action, disable repeat input, confirmed success, rollback on error, invalidate all relationship queries.

## Remaining reported invoice/order issues

| ID / reproduction | Current flow and evidence | Database/queries | Severity / risk | Recommended correction |
|---|---|---|---|---|
| UI-02: focus invoice Customer field, then click outside | `InvoiceCreateFlow` uses `showClientSuggestions` and a hand-built absolute panel. It closes only when a suggestion is selected; unlike `NewOrderDrawer`, there is no blur/outside handler. This is not the Radix popover. | Local UI only | Medium; blocks interaction, no data loss | Replace all bespoke suggestion panels with one accessible combobox/popover with outside-click, Escape, focus return, portal/z-index contract. |
| ORD-03: compare customer/contact names in order forms | `client_name`, `whatsapp_name`, and `saved_contact_name` are presented as separate fields in multiple forms. Client and order both store aliases. | `clients` and `orders` duplicate snapshot/live fields | Medium; divergent identity | Treat client name as canonical invoice/billing name; retain WhatsApp display name only where useful; retire `saved_contact_name` UI after data review. Keep immutable invoice `customer_name`. |
| INV-03: edit an approved invoice | `updateInvoice()` permits full edits only in `draft`. Drawer offers Duplicate for non-drafts and Void for non-paid records. A basic void-and-duplicate mechanism therefore exists, but no reopen authorization, correction reason, revision chain, credit-note semantics, or replacement link exists. | `opps_invoices.status`; activity rows | High; financial control gap, not direct loss | Keep approved invoices immutable. Add controlled void-and-replace/revision metadata and reason/authorization; do not casually reopen exported/paid invoices. |
| REL-01: link/unlink from invoice or order | Order invoice tab discovers invoices by `source_order_id`; invoice drawer merely displays the raw source UUID. No link/unlink action exists. | `opps_invoices.source_order_id`; no FK in founding migration; indexed but non-unique | High; orphan/stale links | Add bidirectional UI backed by the one source field, tenant validation, audit activity, success state. Do not add a junction table for the current one-invoice-to-one-order / one-order-to-many-invoices cardinality. |
| INV-04: review three number inputs | They are `shipping_charge`, `adjustment`, and `amount_paid` in `InvoiceCreateFlow`. They have placeholders only. Discount is edited per line (`opps_invoice_items.discount`) and calculated into `opps_invoices.discount_total`; it is not the third input. | Invoice columns above; line discount | Medium; financial entry errors | Wrap all three in persistent labels. Label line discount in the item editor and explain calculated discount total. |
| ZOH-01: look for Import Centre | `InvoiceExportCenter` already imports customer CSVs, but only clients. Matching is unique normalized email then unique name; duplicate file rows are skipped. `Promise.allSettled` allows partial writes and only reports aggregate counts. | Client CRUD; no import job/row tables | High for future expansion; partial imports currently possible | Reframe as Import Centre, retain preview, add durable job/row results, idempotency keys/external IDs, per-row retry and rollback guidance before adding other entities. |
| INV-05: inspect invoice naming | Stable number is generated as `OPPS-INV-YYYY-NNNN` and displayed directly everywhere. There is no separate human display name. | Tenant/year sequence and tenant+number unique index | Low | Preserve internal number. Derive a display label such as `INV-#### — Client` or store a separate display label; do not weaken internal uniqueness. |
| DATA-01: edit invoice phone/address and save | `InvoiceCreateFlow` mutates only invoice snapshot fields; `updateInvoice()` writes only `opps_invoices`. It never updates `clients` or `orders`. Order address mapping on creation uses `delivery_note`, not a dedicated billing address. | `opps_invoices.customer_phone/customer_billing_address`; `clients.phone/delivery_address`; `orders.client_phone/delivery_note` | High; divergent records | Add explicit save scope: invoice only / client / linked order / both. Preview exact changes, authorize each target, perform transactionally/audit each mutation. Default to invoice snapshot only. |
| ATT-01: add/select invoice files | Direct item image/proof upload exists. Proof JSON supports `include_in_pdf` and `client_visible`, and private tenant-prefixed storage is used. There is no invoice-level attachment model, order-file picker, or dynamic order link. PDF filtering checks only `include_in_pdf`, not `client_visible`. | JSON on `opps_invoice_items.proofs`; private `uploads` bucket | High privacy/design gap | Add relational invoice attachments with source, visibility, PDF flag, immutable snapshot/dynamic-link choice, tenant policy, and audit. Require client-visible for client portal output; keep internal-only excluded. |
| PDF-01: download a long invoice | `html2canvas` captures one tall bitmap. `jsPDF` repeats the same image with a negative Y offset per page. Cuts occur at fixed 277 mm boundaries with no knowledge of rows, headers, totals, or payment blocks. | Browser-only; no DB | High document integrity; no DB loss | Use paginated HTML print or a row-aware PDF renderer. Add repeated table headers and explicit keep-together/page-break rules. |
| PDF-02: browser print a long invoice/mobile layout | Print CSS only avoids breaks on every `section/article`; line rows are `div`s without break protection; header is a non-table div and cannot repeat. Large protected sections can still overflow. Layout varies by responsive breakpoint. | Browser print CSS | High | Add print-specific fixed table/grid, `break-inside: avoid` per row, repeating `<thead>`, keep totals/payment together, and multi-page regression fixtures. |

## Shared interaction findings

- Radix `Popover`, `DropdownMenu`, `Select`, `Dialog`, and `Drawer` correctly portal at `z-50`; no defect was found in those wrappers. The reported dropdown defect is in bespoke autocomplete panels that bypass them.
- `NewOrderDrawer`, `ProductsEditor`, and `InvoiceLineItemsEditor` use delayed `onBlur` dismissal; the invoice customer autocomplete lacks even that. A shared component is needed to eliminate inconsistent timing and z-index behavior.
- PO status buttons do not disable while the shared update mutation is pending and provide no status-specific result.
- PO bulk mutations are sequential loops with only all-or-nothing UI reporting. A failure stops the loop after earlier records have changed; `onError` is absent, so silent partial update is possible.
- Generic `runSelect()` falls back to cached rows on server error. Generic delete returns `false`, then the entity layer falls back to local deletion and reports success. This can conceal remote failure and is unsafe for destructive workflows.
- Query invalidation is inconsistent: invoice mutations are comparatively thorough; order inline updates invalidate only `orders`; relationship consumers such as PO/order detail keys are not uniformly invalidated.

## Security and tenant findings

- Invoice tables have finance/admin plus tenant RLS. Invoice APIs also filter tenant. Item loading does not vary by approval status.
- `getFinanceLevel(user) > 0` grants the invoice UI to levels 3/4 (ops/team), while database invoice RLS permits only admin or finance levels 1/2. This frontend/backend mismatch can produce confusing access failures.
- PO RLS permits every authenticated tenant member to perform every operation. The PO page has no user/role gate, so approval, status change, archive, and delete are not authorization-separated.
- `source_order_id` and PO link identifiers are tenant-checked by triggers when targets exist, but audited founding migrations do not define the relevant foreign keys. Invalid/nonexistent UUIDs can therefore remain.
- Private upload paths are tenant-prefixed and policy-scoped. Public-assets writes are available to any authenticated user and should never be used for sensitive invoice/order attachments.
- Invoice activity covers lifecycle changes, not relationship changes, snapshot propagation, or line replacement as one atomic audited event.

