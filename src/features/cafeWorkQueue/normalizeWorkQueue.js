// Read-only display normalization. Server RPC must authorize and tenant-scope records.
export function normalizeWorkQueue(response) {
  if (!response || !Array.isArray(response.items)) {
    throw new Error('Invalid Cafe work queue response');
  }
  const seen = new Set();
  const items = [];
  for (const item of response.items) {
    if (!item || !['invoice', 'order'].includes(item.type) || typeof item.id !== 'string') continue;
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const balance = item.balanceDue == null ? null : Number(item.balanceDue);
    items.push({
      key,
      id: item.id,
      type: item.type,
      number: String(item.number || ''),
      status: String(item.status || 'unknown'),
      // Preserve the server-authorized linkage so display grouping can work.
      // Do not infer links from invoice/order numbers or browser data.
      sourceOrderId: typeof item.sourceOrderId === 'string' && item.sourceOrderId.length > 0
        ? item.sourceOrderId : null,
      customerName: typeof item.customerName === 'string' ? item.customerName : '',
      balanceDue: balance !== null && Number.isFinite(balance) && balance >= 0 ? balance : null,
      reviewRequired: item.reviewRequired === true,
      invoices: item.type === 'order' && Array.isArray(item.invoices)
        ? item.invoices.filter(invoice => invoice && typeof invoice.id === 'string'
            && invoice.sourceOrderId === item.id)
          .map(invoice => {
            const invoiceBalance = invoice.balanceDue == null ? null : Number(invoice.balanceDue);
            return {
              id: invoice.id,
              number: String(invoice.number || ''),
              status: String(invoice.status || 'unknown'),
              sourceOrderId: invoice.sourceOrderId,
              balanceDue: invoiceBalance !== null && Number.isFinite(invoiceBalance) && invoiceBalance >= 0
                ? invoiceBalance : null,
              reviewRequired: invoice.reviewRequired === true,
            };
          })
        : [],
    });
  }
  return {items, nextCursor: typeof response.nextCursor === 'string' ? response.nextCursor : null};
}
