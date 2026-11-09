// Issue #107: pure event model; does not dispatch push or infer recipients.
// Inputs must originate from a committed, tenant-authorized server event.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const transitions = Object.freeze({
  invoice: Object.freeze({ approved: 'INVOICE_APPROVED', paid: 'INVOICE_PAID', void: 'INVOICE_VOIDED' }),
  quote: Object.freeze({ sent: 'QUOTE_SENT', accepted: 'QUOTE_ACCEPTED', declined: 'QUOTE_DECLINED' }),
});
const okText = value => typeof value === 'string' && value.length > 0 && value.length <= 128;

export function describeDocumentTransition({ tenantId, kind, documentId, revisionId, fromStatus, toStatus, sourceEventId }) {
  if (!uuid.test(tenantId || '') || !uuid.test(documentId || '') ||
      !uuid.test(sourceEventId || '') || !okText(toStatus) || !okText(fromStatus) ||
      !['invoice', 'quote'].includes(kind)) return null;
  if (fromStatus === toStatus) return null;
  const eventType = transitions[kind][toStatus];
  if (!eventType) return null;
  // Stable audit-event identity: refetching or reopening cannot change it.
  const eventKey = [tenantId, kind, documentId, sourceEventId].join(':');
  return Object.freeze({ tenantId, kind, documentId, revisionId: revisionId || null, eventType, eventKey });
}
export function describeLowStockCrossing({ tenantId, itemId, before, after, reorderPoint, movementId }) {
  if (![tenantId, itemId, movementId].every(x => uuid.test(x || '')) ||
      ![before, after, reorderPoint].every(x => Number.isFinite(x) && x >= 0)) return null;
  if (!(before > reorderPoint && after <= reorderPoint)) return null;
  return Object.freeze({
    tenantId, itemId, eventType: 'INVENTORY_LOW',
    eventKey: [tenantId, 'inventory', itemId, movementId].join(':'),
  });
}
export const notificationEventTypes = Object.freeze({
  INVOICE_APPROVED: Object.freeze({ title: 'Invoice approved', path: '/Invoices' }),
  INVOICE_PAID: Object.freeze({ title: 'Invoice paid', path: '/Invoices' }),
  INVOICE_VOIDED: Object.freeze({ title: 'Invoice voided', path: '/Invoices' }),
  QUOTE_SENT: Object.freeze({ title: 'Quote sent', path: '/Quotes' }),
  QUOTE_ACCEPTED: Object.freeze({ title: 'Quote accepted', path: '/Quotes' }),
  QUOTE_DECLINED: Object.freeze({ title: 'Quote declined', path: '/Quotes' }),
  INVENTORY_LOW: Object.freeze({ title: 'Low stock', path: '/Inventory' }),
});
