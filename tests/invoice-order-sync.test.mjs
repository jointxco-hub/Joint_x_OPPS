import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInvoiceOrderSyncPlan, buildOrderInvoiceSyncPlan, buildShippingDiff, canSyncInvoiceToOrder, isOrderProductsLocked } from '../src/features/invoices/orderToInvoiceItems.js';

// ─────────────────────────────────────────────────────────────────────
// PHASE 11 lifecycle distinction: draft/approved allowed, paid/void
// blocked, for invoice -> order specifically (order -> invoice keeps its
// own, unchanged, draft-only rule elsewhere in OrderLinkPanel.jsx).
// ─────────────────────────────────────────────────────────────────────

test('canSyncInvoiceToOrder: draft invoice is allowed', () => {
  assert.equal(canSyncInvoiceToOrder('draft'), true);
});

test('canSyncInvoiceToOrder: approved invoice is allowed - this direction never mutates the invoice', () => {
  assert.equal(canSyncInvoiceToOrder('approved'), true);
});

test('canSyncInvoiceToOrder: paid invoice is blocked', () => {
  assert.equal(canSyncInvoiceToOrder('paid'), false);
});

test('canSyncInvoiceToOrder: void invoice is blocked', () => {
  assert.equal(canSyncInvoiceToOrder('void'), false);
});

test('isOrderProductsLocked: a confirmed order with no manual lock is unlocked', () => {
  assert.equal(isOrderProductsLocked({ status: 'confirmed', products_locked_at: null }), false);
});

test('isOrderProductsLocked: a past-confirmed order is locked', () => {
  assert.equal(isOrderProductsLocked({ status: 'in_production', products_locked_at: null }), true);
});

test('isOrderProductsLocked: a manually-locked order is locked regardless of status', () => {
  assert.equal(isOrderProductsLocked({ status: 'confirmed', products_locked_at: '2026-08-01T00:00:00Z' }), true);
});

const orderLine = (overrides = {}) => ({
  line_id: 'line-1',
  name: 'T-Shirt',
  quantity: 2,
  price: 100,
  size: 'M',
  color: 'Black',
  notes: '',
  category: '',
  image_url: '',
  catalog_item_id: '',
  inventory_item_id: '',
  source: 'catalog',
  selected_print_options: [],
  selected_addons: [],
  ...overrides,
});

const invoiceItem = (overrides = {}) => ({
  source_order_item_id: 'line-1',
  item_name: 'T-Shirt',
  quantity: 2,
  rate: 100,
  item_description: '',
  source_metadata: { size: 'M', color: 'Black' },
  ...overrides,
});

test('invoice -> order: a new invoice-only line becomes a new commercial order line', () => {
  const items = [
    invoiceItem(),
    invoiceItem({ source_order_item_id: null, item_name: 'A4 Colour Prints', quantity: 2, rate: 20, source_metadata: {} }),
  ];
  const { products, diff } = buildInvoiceOrderSyncPlan(items, [orderLine()]);

  assert.equal(products.length, 2);
  const added = products.find((p) => p.name === 'A4 Colour Prints');
  assert.ok(added, 'the new line must be present in the returned products');
  assert.deepEqual(diff.added, ['A4 Colour Prints']);
  assert.equal(added.added_from_invoice, true, 'must be flagged for the "Added from invoice" UI treatment');
  assert.equal(added.catalog_item_id, '', 'must never fabricate a catalog/inventory identity');
  assert.equal(added.inventory_item_id, '');
});

test('invoice-only line gets a fresh, stable line_id - never null, never reused, never derived from description text', () => {
  const items = [invoiceItem({ source_order_item_id: null, item_name: 'Business Cards', quantity: 1, rate: 50, source_metadata: {} })];
  const { products } = buildInvoiceOrderSyncPlan(items, []);
  assert.ok(products[0].line_id, 'must have a line_id');
  assert.notEqual(products[0].line_id, null);
  assert.notEqual(products[0].line_id, 'Business Cards');
});

// PHASE 0 fix: the previous implementation never wrote the new line_id
// back onto opps_invoice_items.source_order_item_id, so every re-sync of
// a still-unmatched invoice item minted another duplicate order line -
// confirmed live on ORD-MT4NPA4O. buildInvoiceOrderSyncPlan now also
// returns the {invoiceItemId, newLineId} pairing the caller
// (apply_invoice_order_sync RPC) must persist to close that gap.
test('invoice -> order: a new line reports its invoiceItemId <-> newLineId pairing for write-back', () => {
  const items = [invoiceItem({ id: 'inv-item-1', source_order_item_id: null, item_name: 'A4 Colour Prints', quantity: 2, rate: 20, source_metadata: {} })];
  const { products, linePairings } = buildInvoiceOrderSyncPlan(items, []);
  assert.equal(linePairings.length, 1);
  assert.equal(linePairings[0].invoiceItemId, 'inv-item-1');
  assert.equal(linePairings[0].newLineId, products[0].line_id);
});

test('invoice -> order: a matched (already-paired) line produces no new pairing', () => {
  const items = [invoiceItem({ id: 'inv-item-1' })]; // source_order_item_id: 'line-1' (default), matches orderLine()
  const { linePairings } = buildInvoiceOrderSyncPlan(items, [orderLine()]);
  assert.deepEqual(linePairings, []);
});

test('invoice -> order: an invoice item with no id (defensive) never produces a pairing', () => {
  const items = [invoiceItem({ id: undefined, source_order_item_id: null, item_name: 'No id', source_metadata: {} })];
  const { linePairings } = buildInvoiceOrderSyncPlan(items, []);
  assert.deepEqual(linePairings, []);
});

// Simulates the full write-back loop apply_invoice_order_sync performs:
// build plan -> caller persists products + writes newLineId onto the
// invoice item's source_order_item_id -> a second sync of the exact same
// (now-paired) invoice items must recognize the existing line instead of
// minting another one. This is the regression test for the duplication
// defect itself, not just the pairing shape.
test('invoice -> order: once a pairing is applied, repeat sync does not duplicate the same invoice item', () => {
  const items = [invoiceItem({ id: 'inv-item-1', source_order_item_id: null, item_name: 'Business Cards', quantity: 1, rate: 50, source_metadata: {} })];

  const first = buildInvoiceOrderSyncPlan(items, []);
  assert.equal(first.products.length, 1);
  assert.equal(first.diff.added.length, 1);
  assert.equal(first.linePairings.length, 1);

  // Apply the write-back exactly as apply_invoice_order_sync does.
  const pairedItems = items.map((item) =>
    item.id === first.linePairings[0].invoiceItemId
      ? { ...item, source_order_item_id: first.linePairings[0].newLineId }
      : item
  );

  const second = buildInvoiceOrderSyncPlan(pairedItems, first.products);
  assert.equal(second.products.length, 1, 'must still be exactly one line, not a duplicate');
  assert.deepEqual(second.diff.added, [], 'the now-paired item must not be treated as new again');
  assert.deepEqual(second.linePairings, [], 'an already-paired item produces no further pairing');

  const third = buildInvoiceOrderSyncPlan(pairedItems, second.products);
  assert.equal(third.products.length, 1, 'idempotent under a third sync too');
});

test('invoice -> order: quantity change is detected and applied, before/after reported', () => {
  const items = [invoiceItem({ quantity: 3 })];
  const { products, diff } = buildInvoiceOrderSyncPlan(items, [orderLine({ quantity: 2 })]);
  assert.equal(products[0].quantity, 3);
  assert.equal(diff.updated.length, 1);
  assert.equal(diff.updated[0].before.quantity, 2);
  assert.equal(diff.updated[0].after.quantity, 3);
});

test('invoice -> order: sell price change is detected and applied, before/after reported', () => {
  const items = [invoiceItem({ rate: 150 })];
  const { products, diff } = buildInvoiceOrderSyncPlan(items, [orderLine({ price: 100 })]);
  assert.equal(products[0].price, 150);
  assert.equal(diff.updated.length, 1);
  assert.equal(diff.updated[0].before.price, 100);
  assert.equal(diff.updated[0].after.price, 150);
});

// PHASE 12 regression: once staff has run Configure Product on an
// invoice-originated line (setting catalog_item_id, and in practice a
// client_product/composition built on top of it), a LATER invoice->order
// sync must never erase that mapping - only the commercial fields the
// sync actually owns may change. buildInvoiceOrderSyncPlan's matched
// branch spreads ...existing first and overrides only name/quantity/
// price/size/color/notes, so any other field (catalog_item_id,
// inventory_item_id, client_product_id, image_url set via Configure
// Product) survives untouched by construction - this proves it
// explicitly rather than relying on the spread order never changing.
test('invoice -> order: catalog_item_id/client_product mapping set via Configure Product survives a later re-sync', () => {
  const configuredLine = orderLine({
    line_id: 'line-1',
    catalog_item_id: 'cat-jet-tshirt',
    client_product_id: 'cp-123',
    image_url: 'https://example.com/mockup.jpg',
    added_from_invoice: true,
  });
  const items = [invoiceItem({ quantity: 3, rate: 194 })]; // a later commercial-only change
  const { products, diff } = buildInvoiceOrderSyncPlan(items, [configuredLine]);

  assert.equal(products[0].catalog_item_id, 'cat-jet-tshirt', 'Configure Product mapping must survive re-sync');
  assert.equal(products[0].client_product_id, 'cp-123', 'client_product association must survive re-sync');
  assert.equal(products[0].image_url, 'https://example.com/mockup.jpg', 'explicitly set thumbnail must survive re-sync');
  assert.equal(products[0].quantity, 3, 'commercial fields the sync owns still update');
  assert.equal(products[0].price, 194);
  assert.equal(diff.updated.length, 1, 'the commercial change is still reported');
});

test('invoice -> order: matching an existing line never fabricates inventory/composition identity, and preserves what was already there', () => {
  const order = orderLine({ catalog_item_id: 'cat-1', inventory_item_id: 'inv-1', selected_print_options: [{ name: 'DTF' }] });
  const items = [invoiceItem({ quantity: 5 })];
  const { products } = buildInvoiceOrderSyncPlan(items, [order]);
  assert.equal(products[0].catalog_item_id, 'cat-1', 'existing catalog identity must survive a commercial-only sync');
  assert.equal(products[0].inventory_item_id, 'inv-1');
  assert.deepEqual(products[0].selected_print_options, [{ name: 'DTF' }]);
});

// Configure Product correction: a line matched to a stock/inventory item
// (inventory_item_id) or pointed at a standalone client_product
// (client_product_id, no catalog/inventory parent) must survive a later
// commercial-only invoice re-sync exactly like the catalog_item_id case
// above - re-sync only ever updates the commercial fields it owns
// (name/quantity/price/size/color/notes), so any production identity
// already on the line is preserved by the existing spread-then-override
// order in buildInvoiceOrderSyncPlan's matched branch, not by anything
// new. Proven explicitly here since Configure Product introduced these
// two fields after this test file was first written.
test('invoice -> order: inventory_item_id and client_product_id both survive a commercial-only re-sync', () => {
  const stockLine = orderLine({ line_id: 'line-stock', inventory_item_id: 'inv-42', catalog_item_id: '' });
  const clientProductLine = orderLine({ line_id: 'line-cp', client_product_id: 'cp-99', catalog_item_id: '', inventory_item_id: '' });
  const items = [
    invoiceItem({ source_order_item_id: 'line-stock', quantity: 3 }),
    invoiceItem({ source_order_item_id: 'line-cp', item_name: 'Custom Labels', rate: 20 }),
  ];
  const { products } = buildInvoiceOrderSyncPlan(items, [stockLine, clientProductLine]);

  const stockAfter = products.find((p) => p.line_id === 'line-stock');
  const cpAfter = products.find((p) => p.line_id === 'line-cp');
  assert.equal(stockAfter.inventory_item_id, 'inv-42', 'inventory identity must survive re-sync');
  assert.equal(stockAfter.catalog_item_id, '', 'must never fabricate a catalog_item_id for a stock line');
  assert.equal(stockAfter.quantity, 3, 'commercial field the sync owns still updates');
  assert.equal(cpAfter.client_product_id, 'cp-99', 'standalone client_product link must survive re-sync');
});

test('an order line whose invoice counterpart is gone defaults to Keep - never silently dropped', () => {
  const order = orderLine({ line_id: 'line-1' });
  const otherOrder = orderLine({ line_id: 'line-2', name: 'Business Cards' });
  const items = [invoiceItem({ source_order_item_id: 'line-1' })]; // line-2 has no invoice counterpart
  const { products, diff } = buildInvoiceOrderSyncPlan(items, [order, otherOrder]);

  assert.equal(products.length, 2, 'line-2 must still be present (kept), not removed');
  assert.ok(products.some((p) => p.line_id === 'line-2'));
  assert.deepEqual(diff.missingFromInvoice, [{ line_id: 'line-2', name: 'Business Cards' }]);
});

test('repeated invoice -> order sync with no changes is idempotent (no-op)', () => {
  const order = orderLine();
  const items = [invoiceItem()];
  const first = buildInvoiceOrderSyncPlan(items, [order]);
  assert.deepEqual(first.diff.added, []);
  assert.deepEqual(first.diff.updated, []);
  assert.deepEqual(first.diff.missingFromInvoice, []);

  const second = buildInvoiceOrderSyncPlan(items, first.products);
  assert.deepEqual(second.diff.added, []);
  assert.deepEqual(second.diff.updated, []);
  assert.deepEqual(second.diff.missingFromInvoice, []);
});

test('shipping diff: ON with an amount vs a different invoice charge differs', () => {
  const diff = buildShippingDiff({ orderApplyShippingFee: true, orderShippingFee: 120, invoiceShippingCharge: 0 });
  assert.equal(diff.orderAmount, 120);
  assert.equal(diff.invoiceAmount, 0);
  assert.equal(diff.differs, true);
});

test('shipping diff: OFF always reports zero regardless of a stale shipping_fee value', () => {
  const diff = buildShippingDiff({ orderApplyShippingFee: false, orderShippingFee: 120, invoiceShippingCharge: 0 });
  assert.equal(diff.orderAmount, 0);
  assert.equal(diff.differs, false);
});

test('shipping diff: matching amounts do not differ', () => {
  const diff = buildShippingDiff({ orderApplyShippingFee: true, orderShippingFee: 120, invoiceShippingCharge: 120 });
  assert.equal(diff.differs, false);
});

test('order -> invoice sync plan also carries a shipping diff when shipping context is passed', () => {
  const { diff } = buildOrderInvoiceSyncPlan([orderLine()], [invoiceItem()], {
    orderApplyShippingFee: true,
    orderShippingFee: 120,
    invoiceShippingCharge: 0,
  });
  assert.ok(diff.shipping);
  assert.equal(diff.shipping.differs, true);
  assert.equal(diff.shipping.orderAmount, 120);
});

test('order -> invoice sync plan omits shipping diff when no shipping context is passed (backward compatible)', () => {
  const { diff } = buildOrderInvoiceSyncPlan([orderLine()], [invoiceItem()]);
  assert.equal(diff.shipping, undefined);
});
