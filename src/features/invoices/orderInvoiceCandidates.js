// Same-client, same-tenant candidate filtering for "Link existing invoice"
// in the order drawer. This is a UX-layer filter/display concern only -
// the actual safety enforcement lives server-side in
// link_invoice_to_order_relational() (supabase/migrations/
// 202608180003_invoice_relational_link_and_reopen.sql), which re-checks
// customer_id/tenant_id itself and cannot be bypassed even if this filter
// were ever wrong. `invoices` here is already tenant-scoped by the query
// that fetched them (listInvoices()'s .eq("tenant_id", ...)).
//
// Single source of truth for "this invoice still counts, financially"
// versus dead/void - every duplicate/relationship warning in this file
// (and InvoiceDetailDrawer's own duplicate-invoice-for-this-order
// warning) reuses this one predicate rather than each redefining
// `status !== 'void'` locally, so "active invoice" can never quietly
// drift into two different meanings.
export function isActiveInvoiceStatus(status) {
  return status !== 'void';
}

// Status eligibility was previously hard-restricted to 'draft' only.
// Extended to every status except 'void' - a void invoice is dead and
// should never become the target of a new order relationship. This does
// not by itself make an invoice's line items/totals editable; that stays
// gated separately (draft-only, or via reopen_invoice()).
export function getLinkableInvoiceCandidates(invoices = [], order = {}) {
  if (!order?.client_id) return [];
  return invoices
    .filter((invoice) => invoice?.customer_id === order.client_id)
    .filter((invoice) => isActiveInvoiceStatus(invoice?.status))
    .filter((invoice) => !invoice?.source_order_id)
    .sort((a, b) => String(b.invoice_date || b.created_at || '').localeCompare(String(a.invoice_date || a.created_at || '')));
}

// Same-client invoices already linked to a DIFFERENT order. Surfaced
// separately (not silently dropped) so staff see "Already linked to
// ORD-XXXX" instead of an invoice they expected simply not appearing -
// the conservative "never silently reassign" rule means this list is
// informational only; there is deliberately no relink action wired to it.
export function getAlreadyLinkedElsewhereInvoices(invoices = [], order = {}) {
  if (!order?.client_id) return [];
  return invoices
    .filter((invoice) => invoice?.customer_id === order.client_id)
    .filter((invoice) => isActiveInvoiceStatus(invoice?.status))
    .filter((invoice) => invoice?.source_order_id && invoice.source_order_id !== order.id)
    .sort((a, b) => String(b.invoice_date || b.created_at || '').localeCompare(String(a.invoice_date || a.created_at || '')));
}

// Active (non-void) invoices already linked to a SPECIFIC order -
// regardless of client, since this is used before the client-identity
// question is even settled. Used by the invoice-first "Link Existing
// Order" flow to warn staff, BEFORE the relational link is confirmed,
// that the order they picked already has one or more active invoices.
// This never blocks the relationship itself - relational linking
// (source_order_id only) stays allowed at any non-void invoice status;
// only item-sync/financial duplication has its own stronger, separate
// protection (InvoiceDetailDrawer's duplicate-invoice-for-this-order
// warning, above the isDraft gate).
export function getActiveInvoicesForOrder(invoices = [], orderId) {
  if (!orderId) return [];
  return invoices
    .filter((invoice) => invoice?.source_order_id === orderId)
    .filter((invoice) => isActiveInvoiceStatus(invoice?.status))
    .sort((a, b) => String(b.invoice_date || b.created_at || '').localeCompare(String(a.invoice_date || a.created_at || '')));
}

// Status-grouping/display metadata for 3D - keeps label/help-text
// decisions in one place instead of scattered inline ternaries.
export const INVOICE_STATUS_GROUPS = {
  draft: { label: 'Draft', order: 0 },
  approved: { label: 'Approved', order: 1 },
  exported: { label: 'Exported', order: 2 },
  imported_to_zoho: { label: 'Exported', order: 2 },
  overdue: { label: 'Overdue', order: 3 },
  partially_paid: { label: 'Partially paid', order: 4 },
  paid: { label: 'Paid', order: 5 },
};

export function invoiceStatusGroupLabel(status) {
  return INVOICE_STATUS_GROUPS[status]?.label || status || 'Unknown';
}

// Non-draft invoices are still safely linkable (relationship-only, no
// financial mutation) - but the action label/help text should say so
// explicitly rather than implying anything will be recalculated.
export function linkActionCopyForStatus(status) {
  if (status === 'draft') {
    return { label: 'Link invoice', helpText: null };
  }
  return {
    label: 'Link invoice',
    helpText: 'Links this invoice to the order. Financial values will not change.',
  };
}
