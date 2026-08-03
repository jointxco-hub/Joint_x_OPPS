# Data flow and relationships

## Disappearing invoice items: complete trace

### Creation from an order

1. `InvoicesTab.jsx` renders `CreateInvoiceFromOrderButton` with the open order.
2. `CreateInvoiceFromOrderButton.jsx` maps `order.products` into invoice item objects. It copies quantity/rate/discount and selected product metadata; it uses the order ID as `source_order_id`.
3. It checks `listInvoices({sourceOrderId})`, then calls `createInvoice()`.
4. `createInvoice()` calculates totals, inserts `opps_invoices`, syncs client item templates, inserts `opps_invoice_items`, writes item-version history, and reads the complete invoice back.

Order items are therefore only source material. Saved invoice items are relational `opps_invoice_items` rows, not references to temporary order state and not embedded invoice JSON.

### Reload/edit

1. The order tab initially lists invoice summaries with `listInvoices()`; summaries intentionally do not contain items.
2. Opening navigates to `/Invoices?invoice=<id>`.
3. `Invoices.jsx` stores `{id}`/summary in `selectedInvoice` and separately runs `getInvoice(id, {includeItems:true})`.
4. `getInvoice()` loads `opps_invoices`, then `listInvoiceItems()` using `invoice_id` and `tenant_id`.
5. On success, Edit passes the detailed invoice to `InvoiceCreateFlow`, whose initial state maps the loaded items.
6. On detail failure, the page falls back to the summary object, the drawer renders no items, and the error is not shown. This is the confirmed false-empty path.

### Save/overwrite risk

`updateInvoice()` interprets any array-valued `input.items` as a complete replacement. It deletes every existing row for the invoice/tenant, then inserts the supplied rows. There is no transaction. An incomplete UI state or an insert failure can therefore remove good data. The code has no empty-array preservation guard or loaded-version token.

### RLS, tenant and status conclusions

- Both invoice and item queries include `tenant_id`; no missing tenant filter was found in this path.
- Invoice/item RLS uses the same finance/admin plus tenant predicate. A membership/role/policy problem can block loading, but current code masks the resulting error.
- Approval status does not alter item queries. Approved invoices are simply blocked from full `updateInvoice()` edits.
- Order items are not substituted during reload. `useClientInvoiceData` only uses order products to enrich thumbnails/variant display after saved invoice rows load.
- No atomic database RPC protects invoice/header/item/template/version writes.

## Invoice ↔ order cardinality

| Question | Current answer |
|---|---|
| Order foreign key to invoice | None. `orders.invoice_files` and `invoice_numbers` are external/reference JSON, not OPPS invoice relationships. |
| Invoice foreign key to order | `opps_invoices.source_order_id` is a UUID-like column, indexed but not declared as an FK in the audited migration. |
| Direction | Invoice to one optional source order; order UI reverse-queries invoices. |
| Multiple invoices per order | Yes. No unique constraint exists and the UI explicitly supports “Create another.” |
| Multiple orders per invoice | No current model or requirement implementation. |
| Junction needed now | No. The current required cardinality is many invoices to one order. Add a real nullable FK and retain the reverse query. Introduce a junction only if one invoice must legally cover multiple orders. |

Required relationship operations should update `source_order_id`, enforce same-tenant target existence, write an audit event with old/new IDs and actor, invalidate invoice/order queries, and show pending/success/failure states.

## Client/contact ownership

| Value | Current source and copies | Recommended ownership |
|---|---|---|
| Billing/customer name | `clients.name`; copied to `orders.client_name`; copied to immutable `opps_invoices.customer_name` | Client live canonical value; order operational snapshot; invoice legal snapshot |
| WhatsApp name | `clients.whatsapp_name`; intended copy to `orders.whatsapp_name` | Optional live client alias plus intentional order snapshot |
| Saved contact name | `clients.saved_contact_name`; intended copy to `orders.saved_contact_name` | Retire as a separate UI concept if it duplicates WhatsApp name; migrate/retain historical data only |
| Email/phone/address | Client live fields; duplicated on order and invoice | Invoice values remain immutable snapshots after approval; edits require explicit propagation scope |

The order forms attempt to persist both aliases to the client and order, but the Order serializer drops them. Invoice creation from an order uses `order.client_name`, `client_email`, `client_phone`, and `delivery_note`. It does not use WhatsApp/saved-contact name for billing.

## PO relationships

| Target | Current implementation | Gap |
|---|---|---|
| Supplier | `purchase_orders.supplier_id` and snapshot `supplier_name`; tenant trigger checks tenant if target resolves | No FK in founding migration; form permits multiple `supplier_ids` but serializes only the first ID while concatenating names |
| Customer order | `purchase_orders.linked_order_id` and separate `orders.linked_po_id` | Two independent fields, no synchronization/audit/FKs; cardinalities conflict |
| Project | `purchase_orders.project_id` | Available in schema/adapter but absent from main PO form |
| Stock need | `StockDemandPanel` derives demand from current orders/inventory/PO JSON | No durable demand-to-PO link |
| Inventory receipt | None | No receiving entity, movement link, or per-line received quantity |

Use `purchase_orders.linked_order_id` as the current authoritative many-POs-to-one-order direction unless requirements demand many-to-many. Deprecate or strictly synchronize `orders.linked_po_id`; do not keep two unaudited sources of truth.

