export function getLinkableInvoiceCandidates(invoices = [], order = {}) {
  if (!order?.client_id) return [];
  return invoices
    .filter((invoice) => invoice?.customer_id === order.client_id)
    .filter((invoice) => invoice?.status === 'draft')
    .filter((invoice) => !invoice?.source_order_id)
    .sort((a, b) => String(b.invoice_date || b.created_at || '').localeCompare(String(a.invoice_date || a.created_at || '')));
}
