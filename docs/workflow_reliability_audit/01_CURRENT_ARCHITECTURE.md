# OPPS workflow reliability audit: current architecture

Audit date: 2026-08-02  
Repository: `Joint_x_OPPS`  
Method: read-only inspection of the local React/Supabase repository. No remote service was queried.

## Runtime shape

OPPS is a Vite/React application. TanStack Query owns server-state caching. `src/api/dataClient.js` is the generic Supabase entity adapter; invoicing uses the more explicit `src/api/invoices.js`. Invoice items are relational rows, while order products and PO items are JSON arrays. Supabase migrations are append-only files under `supabase/migrations/`.

## Architecture map

| Area | Exact files and responsibilities |
|---|---|
| Invoice page and list | `src/pages/Invoices.jsx`; `src/features/invoices/InvoiceList.jsx`; `src/features/invoices/InvoiceStatusBadge.jsx`; `src/features/invoices/invoiceDisplayStatus.js` |
| Invoice editor/modal/drawer | `src/features/invoices/InvoiceCreateFlow.jsx` (five-step create/edit flow); `src/features/invoices/InvoiceDetailDrawer.jsx` (review/actions); `src/pages/ClientInvoicePrint.jsx` (client/print route) |
| Invoice items | `src/features/invoices/InvoiceLineItemsEditor.jsx`; `src/features/invoices/InvoiceItemMediaEditor.jsx`; `src/features/invoices/InvoiceItemTemplateManager.jsx`; `src/features/invoices/ClientInvoiceItemHistory.jsx`; `src/features/invoices/invoiceCalculations.js`; `src/features/invoices/invoiceValidation.js` |
| Order modal/drawer/forms | `src/pages/Orders.jsx`; `src/components/orders/OrderDrawer.jsx`; `src/components/orders/NewOrderDrawer.jsx`; legacy `src/components/orders/OrderForm.jsx`; `src/components/orders/TypeformOrderForm.jsx`; `src/hooks/useOrderDrawerData.js` |
| Order-to-invoice creation | `src/components/orders/drawer/InvoicesTab.jsx`; `src/features/invoices/CreateInvoiceFromOrderButton.jsx` |
| Invoice queries/mutations | `src/api/invoices.js`; page-level TanStack mutations in `src/pages/Invoices.jsx`; order-context export mutations in `src/components/orders/drawer/InvoicesTab.jsx` |
| Order/client queries/mutations | Entity definitions and generic CRUD in `src/api/dataClient.js`; orchestration in `src/pages/Orders.jsx`, `src/components/orders/NewOrderDrawer.jsx`, `src/components/orders/TypeformOrderForm.jsx`, `src/pages/Clients.jsx` |
| PO page/cards/selection | `src/pages/PurchaseOrders.jsx` contains page, filters, selection toolbar, mutations, and `POCard` |
| PO modal/forms | `src/components/purchaseorders/POModal.jsx`; `src/components/purchaseorders/TypeformPOForm.jsx`; `src/components/purchaseorders/POProductSelector.jsx`; `src/components/purchaseorders/StockDemandPanel.jsx` |
| PO/order linking | `src/components/orders/drawer/PurchaseOrderTab.jsx`; `src/components/orders/NewOrderDrawer.jsx`; entity serialization in `src/api/dataClient.js` |
| PO approval/procurement | Frontend-only transitions in `src/components/purchaseorders/POModal.jsx`; the single `purchase_orders.status` field is read in `src/pages/PurchaseOrders.jsx` |
| PO receiving | Only `received_date` plus the single status exist in the table/adapter. UI jumps from `ordered` to `received`; there is no receipt or per-line receiving module. |
| Shared overlays | Radix wrappers: `src/components/ui/popover.jsx`, `src/components/ui/dropdown-menu.jsx`, `src/components/ui/select.jsx`, `src/components/ui/dialog.jsx`, `src/components/ui/drawer.jsx`. Bespoke autocompletes remain in `InvoiceCreateFlow.jsx`, `NewOrderDrawer.jsx`, `ProductsEditor.jsx`, and `InvoiceLineItemsEditor.jsx`. |
| Notifications | Sonner calls across invoice/order/PO screens; Sonner renderer wrapper at `src/components/ui/sonner.jsx`; a different shadcn renderer is mounted from `src/components/ui/toaster.jsx` by `src/App.jsx` |
| PDF/print | `src/features/invoices/ClientInvoiceView.jsx`; `src/features/invoices/InvoicePdfDownloadButton.jsx`; `src/pages/ClientInvoicePrint.jsx`; libraries `html2canvas` and `jspdf` |
| Zoho | `src/features/invoices/InvoiceExportCenter.jsx`; `zohoInvoiceCsv.js`; `zohoInvoiceExportConfig.js`; `zohoCustomerCsv.js`; `zohoCustomerExportConfig.js`; `zohoCustomerImport.js`; settings/persistence functions in `src/api/invoices.js` |
| Invoice/order files | `src/features/invoices/InvoiceItemMediaEditor.jsx`; `src/components/orders/drawer/OrderFilesTab.jsx`; `src/components/orders/drawer/InvoicesTab.jsx`; `src/lib/privateFiles.js`; upload implementation in `src/api/dataClient.js`; internal file metadata in `src/api/clientRequests.js` |
| Supabase client/services | `src/lib/supabaseClient.ts`; `src/lib/tenantContext.js`; `src/api/dataClient.js`; `src/api/invoices.js`; `src/api/clientRequests.js` |
| Core invoice migrations | `202606180001_opps_invoicing.sql`; `202606190001_opps_invoicing_phase4.sql`; `202606200003_tenant_invoice_rls.sql`; `202606200002_tenant_invoice_settings_unique.sql`; `202606210006_tenant_invoice_sequences.sql`; `202606210007_tenant_order_invoice_parent_guards.sql`; `202607020001_opps_invoice_item_templates.sql`; `202607200001_invoice_item_media_history.sql` |
| Core order/client migrations | `202605230001_link_clients_to_orders.sql`; `202605260001_order_client_contact_aliases.sql`; `202605180001_orders_invoice_portal_fields.sql`; `202606200005_tenant_client_order_rls.sql` |
| Core PO migrations | `202605180002_create_purchase_orders_table.sql`; `202605110001_purchase_order_ops_fields.sql`; `202606210004_tenant_purchasing_inventory.sql` |
| RLS/tenant foundation | `202606200001_multi_tenant_foundation.sql`; `202606200003_tenant_invoice_rls.sql`; `202606200005_tenant_client_order_rls.sql`; `202606210004_tenant_purchasing_inventory.sql`; parent guards in `202606210007_tenant_order_invoice_parent_guards.sql` |
| Storage buckets/policies | `202606270001_private_uploads_signed_urls.sql`; `202606270002_harden_private_upload_path_access.sql`. Buckets are private `uploads` and public `public-assets`. |

## Current persistence model

| Record | Storage | Important fields |
|---|---|---|
| Invoice | `opps_invoices` | `tenant_id`, stable `invoice_number`, customer snapshot fields, optional `customer_id`, optional `source_order_id`, money totals, single lifecycle `status`, Zoho timestamps |
| Invoice item | `opps_invoice_items` | FK `invoice_id`, `tenant_id`, line details, optional source IDs, `line_key`, media/specification/proof JSON |
| Order | `orders` | `tenant_id`, optional FK `client_id`, customer/contact snapshots, `products` JSON, `linked_po_id` (no FK in audited migrations), file/reference JSON |
| Client | `clients` | live name/email/phone/address plus `whatsapp_name` and `saved_contact_name` aliases |
| Purchase order | `purchase_orders` | `tenant_id`, supplier/project/order identifiers, one `status`, `items` JSON, dates/totals/comments/archive fields |

## Important architecture observations

- Invoice items are not embedded in the invoice. Every complete invoice read requires a second `opps_invoice_items` query.
- Order products and PO items are embedded JSON arrays, so there is no database-level per-line identity, status, receipt quantity, or constraint.
- Invoice and PO relationships are primarily one-way identifiers. Several are not foreign keys in the audited migrations.
- Generic entity reads are tenant-filtered in `dataClient.js`, and invoice reads explicitly filter `tenant_id` in `invoices.js`.
- No invoice/order/PO reliability tests were found under `src` or `supabase/tests`.

