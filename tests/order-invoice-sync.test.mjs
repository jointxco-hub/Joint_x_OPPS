import assert from "node:assert/strict";
import test from "node:test";
import {
  backfillOrderProductLineIds,
  buildOrderInvoiceSyncPlan,
  orderProductKey,
} from "../src/features/invoices/orderToInvoiceItems.js";

test("a fresh link adds every order product with no existing invoice items", () => {
  const products = [
    { line_id: "a", name: "T-shirt", quantity: 10, price: 100 },
    { line_id: "b", name: "Hoodie", quantity: 5, price: 250 },
  ];
  const plan = buildOrderInvoiceSyncPlan(products, []);
  assert.equal(plan.items.length, 2);
  assert.deepEqual(plan.diff.added, ["T-shirt", "Hoodie"]);
  assert.equal(plan.diff.updated.length, 0);
  assert.equal(plan.diff.removedFromOrder.length, 0);
  assert.equal(plan.diff.keptInvoiceOnly.length, 0);
  assert.equal(plan.items[0].source_order_item_id, "a");
  assert.equal(plan.items[0].line_number, 1);
  assert.equal(plan.items[1].line_number, 2);
});

test("a matched line is refreshed from the order but keeps its invoice-only fields", () => {
  const products = [{ line_id: "a", name: "T-shirt (updated name)", quantity: 20, price: 120 }];
  const currentItems = [
    {
      id: "inv-item-1",
      source_order_item_id: "a",
      item_name: "T-shirt",
      quantity: 10,
      rate: 100,
      discount: 5,
      tax_name: "VAT",
      tax_percentage: 15,
      proofs: [{ url: "proof.png" }],
    },
  ];
  const plan = buildOrderInvoiceSyncPlan(products, currentItems);
  assert.equal(plan.items.length, 1);
  const merged = plan.items[0];
  assert.equal(merged.id, "inv-item-1", "existing invoice item id must be preserved");
  assert.equal(merged.item_name, "T-shirt (updated name)", "name must refresh from the order");
  assert.equal(merged.quantity, 20);
  assert.equal(merged.rate, 120);
  assert.equal(merged.discount, 5, "invoice-only financial fields must survive a sync");
  assert.equal(merged.tax_name, "VAT");
  assert.deepEqual(merged.proofs, [{ url: "proof.png" }]);
  assert.deepEqual(plan.diff.updated, ["T-shirt (updated name)"]);
});

test("an unchanged matched line is not reported as updated", () => {
  const products = [{ line_id: "a", name: "T-shirt", quantity: 10, price: 100 }];
  const currentItems = [{ id: "inv-item-1", source_order_item_id: "a", item_name: "T-shirt", quantity: 10, rate: 100 }];
  const plan = buildOrderInvoiceSyncPlan(products, currentItems);
  assert.equal(plan.diff.updated.length, 0);
});

test("an invoice-only line with no source_order_item_id is always preserved, never touched by sync", () => {
  const products = [{ line_id: "a", name: "T-shirt", quantity: 10, price: 100 }];
  const currentItems = [
    { id: "inv-item-1", source_order_item_id: "a", item_name: "T-shirt", quantity: 10, rate: 100 },
    { id: "inv-item-2", source_order_item_id: null, item_name: "Rush fee", quantity: 1, rate: 500 },
  ];
  const plan = buildOrderInvoiceSyncPlan(products, currentItems);
  assert.equal(plan.items.length, 2);
  const rushFee = plan.items.find((item) => item.id === "inv-item-2");
  assert.equal(rushFee.item_name, "Rush fee");
  assert.equal(rushFee.rate, 500);
  assert.deepEqual(plan.diff.keptInvoiceOnly, ["Rush fee"]);
});

test("an invoice line whose order product was removed is dropped and reported", () => {
  const products = []; // the order no longer has any products
  const currentItems = [{ id: "inv-item-1", source_order_item_id: "a", item_name: "T-shirt", quantity: 10, rate: 100 }];
  const plan = buildOrderInvoiceSyncPlan(products, currentItems);
  assert.equal(plan.items.length, 0);
  assert.deepEqual(plan.diff.removedFromOrder, ["T-shirt"]);
});

test("a custom (non-catalog) order product with only a line_id still matches reliably across syncs", () => {
  // Custom items have no id/catalog_item_id/inventory_item_id at all - line_id
  // is the only stable identity they ever have.
  const products = [{ line_id: "custom-1", name: "Embroidered patch", quantity: 3, price: 40, source: "custom" }];
  const firstPlan = buildOrderInvoiceSyncPlan(products, []);
  assert.equal(firstPlan.items[0].source_order_item_id, "custom-1");

  const updatedProducts = [{ line_id: "custom-1", name: "Embroidered patch", quantity: 6, price: 40, source: "custom" }];
  const secondPlan = buildOrderInvoiceSyncPlan(updatedProducts, firstPlan.items);
  assert.equal(secondPlan.items.length, 1, "must update the existing line, not add a duplicate");
  assert.equal(secondPlan.items[0].quantity, 6);
  assert.deepEqual(secondPlan.diff.added, []);
});

test("orderProductKey falls back to catalog/inventory id for legacy products with no line_id", () => {
  const catalogId = "11111111-1111-4111-8111-111111111111";
  const inventoryId = "22222222-2222-4222-8222-222222222222";
  assert.equal(orderProductKey({ catalog_item_id: catalogId }), catalogId);
  assert.equal(orderProductKey({ inventory_item_id: inventoryId }), inventoryId);
  assert.equal(orderProductKey({ name: "No id at all" }), null);
  assert.equal(orderProductKey({ line_id: "line-1", catalog_item_id: catalogId }), "line-1", "line_id takes priority");
});

test("backfillOrderProductLineIds only assigns ids to products missing one", () => {
  const products = [{ line_id: "already-has-one", name: "A" }, { name: "B" }];
  const result = backfillOrderProductLineIds(products);
  assert.notEqual(result, null);
  assert.equal(result[0].line_id, "already-has-one");
  assert.ok(result[1].line_id, "product with no line_id must get one assigned");
});

test("backfillOrderProductLineIds returns null when nothing needs to change", () => {
  const products = [{ line_id: "a", name: "A" }, { line_id: "b", name: "B" }];
  assert.equal(backfillOrderProductLineIds(products), null);
});

test("line_number is always renumbered sequentially after a merge, regardless of original numbering", () => {
  const products = [
    { line_id: "a", name: "First", quantity: 1, price: 10 },
    { line_id: "b", name: "Second", quantity: 1, price: 10 },
    { line_id: "c", name: "Third", quantity: 1, price: 10 },
  ];
  const currentItems = [{ id: "x", source_order_item_id: "b", item_name: "Second", quantity: 1, rate: 10, line_number: 99 }];
  const plan = buildOrderInvoiceSyncPlan(products, currentItems);
  assert.deepEqual(plan.items.map((item) => item.line_number), [1, 2, 3]);
});
