// Presentation-only grouping. Never treat a work card as a payment or receipt.
// Input is the server-authorized, normalized queue items. Grouping is limited to
// one fetched page; the server must own canonical grouping before pagination.
export function groupWorkCards(items) {
  if (!Array.isArray(items)) throw new Error("Invalid Cafe work queue items");
  const byOrder = new Map();
  const standalone = [];
  const pendingInvoices = [];
  const seen = new Set();

  for (const item of items) {
    if (!item || !['order', 'invoice'].includes(item.type) ||
        typeof item.id !== 'string' || !item.id) continue;
    const key = item.type + ':' + item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.type === 'order') {
      const card = { kind: 'order', key, order: item, invoices: [] };
      byOrder.set(item.id, card);
      standalone.push(card);
    } else {
      pendingInvoices.push(item);
    }
  }

  for (const invoice of pendingInvoices) {
    const linked = typeof invoice.sourceOrderId === 'string'
      ? byOrder.get(invoice.sourceOrderId)
      : null;
    if (linked) {
      linked.invoices.push(invoice);
    } else {
      standalone.push({
        kind: 'invoice',
        key: 'invoice:' + invoice.id,
        invoice,
        // Could be a linked order on another page: not necessarily standalone.
        linkedOrderNotOnPage: Boolean(invoice.sourceOrderId),
      });
    }
  }
  return standalone;
}
