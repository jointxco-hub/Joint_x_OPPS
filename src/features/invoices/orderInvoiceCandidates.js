// Same-client, same-tenant candidate filtering for "Link existing invoice"
// in the order drawer. This is a UX-layer filter/display concern only -
// the actual safety enforcement lives server-side in
// link_invoice_to_order_relational() (supabase/migrations/
// 202608180003_invoice_relational_link_and_reopen.sql), which re-checks
// customer_id/tenant_id itself and cannot be bypassed even if this filter
// were ever wrong. `invoices` here is already tenant-scoped by the query
// that fetched them (listInvoices()'s .eq("tenant_id", ...)).
//
// Status eligibility was previously hard-restricted to 'draft' only.
// Extended to every status except 'void' - a void invoice is dead and
// should never become the target of a new order relationship. This does
// not by itself make an invoice's line items/totals editable; that stays
// gated separately (draft-only, or via reopen_invoice()).
export function getLinkableInvoiceCandidates(invoices = [], order = {}) {
  if (!order?.client_id) return [];
  return invoices
    .filter((invoice) => invoice?.customer_id === order.client_id)
    .filter((invoice) => invoice?.status !== 'void')
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
    .filter((invoice) => invoice?.status !== 'void')
    .filter((invoice) => invoice?.source_order_id && invoice.source_order_id !== order.id)
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
