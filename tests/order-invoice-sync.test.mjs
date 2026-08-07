import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  backfillOrderProductLineIds,
  buildOrderInvoiceSyncPlan,
  orderProductKey,
} from "../src/features/invoices/orderToInvoiceItems.js";

// src/api/invoices.js talks to Supabase directly (no test double exists for
// it anywhere in this repo - see the source-pattern tests already at the
// bottom of invoice-reliability.test.mjs for the same constraint) so these
// regression tests pin the exact control flow in source rather than
// executing it. They exist to catch the JET T-Shirt production bug: creating
// or syncing an invoice from an order must not touch the client's reusable
// saved item template.
async function readInvoicesApiSource() {
  return readFile(new URL("../src/api/invoices.js", import.meta.url), "utf8");
}

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

// ── Regression: order-driven saves must not fight the client saved-item
// change_reason guard (production bug: "Explain why JET T-Shirt changed
// before updating this client's saved item." on Create OPPS invoice from
// order) ──────────────────────────────────────────────────────────────────

test("createInvoice skips syncClientItemTemplates entirely in preserve mode (JET T-Shirt reproduction: create-from-order must not touch the client's saved item)", async () => {
  const source = await readInvoicesApiSource();
  assert.match(
    source,
    /const linkedItems = templateSyncMode === "preserve"\s*\?\s*withOrderSyncChangeReason\(items\)\s*:\s*await syncClientItemTemplates\(items, input\.customer_id, tenantId, userId\);/,
    "createInvoice must route order-driven saves (templateSyncMode: 'preserve') away from syncClientItemTemplates, the function that matches by name and rewrites the client's reusable saved item"
  );
});

test("updateInvoice (used by linkInvoiceToOrder and syncInvoiceItemsFromOrder) also skips syncClientItemTemplates in preserve mode", async () => {
  const source = await readInvoicesApiSource();
  assert.match(
    source,
    /const linkedItems = templateSyncMode === "preserve"\s*\?\s*items\s*:\s*await syncClientItemTemplates\(items, input\.customer_id, tenantId, userId\);/,
    "updateInvoice must not call syncClientItemTemplates when linking/syncing an invoice from an order"
  );
});

test("preserve mode supplies an automatic change reason before assertInvoiceItemChangeReasons runs, so link/sync cannot hit a second, different change_reason throw", async () => {
  const source = await readInvoicesApiSource();
  assert.match(
    source,
    /if \(hasItems && templateSyncMode === "preserve"\) \{\s*items = withOrderSyncChangeReason\(items\);\s*\}\s*if \(hasItems\) \{\s*try \{\s*assertInvoiceItemsReadyForSave/,
    "the order-driven change reason must be applied before the invoice's own item change-reason guard, not after"
  );
});

test("withOrderSyncChangeReason never overwrites a change_reason the caller already supplied", async () => {
  const source = await readInvoicesApiSource();
  assert.match(
    source,
    /function withOrderSyncChangeReason\(items\) \{\s*return items\.map\(\(item\) => \(\s*item\.source_order_item_id && !String\(item\.change_reason \|\| ""\)\.trim\(\)\s*\? \{ \.\.\.item, change_reason: ORDER_SYNC_CHANGE_REASON \}\s*: item/,
    "an item that already carries an explicit reason must be left alone, not silently relabelled 'Synced from linked order'"
  );
});

test("withOrderSyncChangeReason only applies to order-derived lines (source_order_item_id boundary) - invoice-only/manual lines must never inherit the automatic reason", async () => {
  const source = await readInvoicesApiSource();
  assert.match(
    source,
    /function withOrderSyncChangeReason\(items\) \{\s*return items\.map\(\(item\) => \(\s*item\.source_order_item_id && !String\(item\.change_reason \|\| ""\)\.trim\(\)/,
    "the automatic reason must be gated on item.source_order_item_id, not applied to every item in the save - an invoice-only line (no source_order_item_id) must fall through to the existing manual change-reason guard, unaffected by Link/Sync running at the same time"
  );
});

// withOrderSyncChangeReason has no Supabase dependency of its own, so unlike
// the rest of this file it can be extracted from source and actually
// executed, proving the boundary scenario behaviorally rather than only
// structurally: a mixed Link/Sync save containing both an order-derived line
// and an untouched invoice-only line.
test("boundary scenario: order-derived JET T-Shirt gets the automatic reason, invoice-only Rush fee does not", async () => {
  const source = await readInvoicesApiSource();
  const fnSource = source.match(/const ORDER_SYNC_CHANGE_REASON = "[^"]+";\s*function withOrderSyncChangeReason\(items\) \{[\s\S]*?\r?\n\}\r?\n/)?.[0];
  assert.ok(fnSource, "withOrderSyncChangeReason must be present and extractable");

  // eslint-disable-next-line no-new-func
  const withOrderSyncChangeReason = new Function(`${fnSource}\nreturn withOrderSyncChangeReason;`)();

  const items = [
    { item_name: "JET T-Shirt", source_order_item_id: "order-line-1", rate: 155 },
    { item_name: "Rush fee", source_order_item_id: null, rate: 500 },
  ];
  const result = withOrderSyncChangeReason(items);

  const jetShirt = result.find((item) => item.item_name === "JET T-Shirt");
  const rushFee = result.find((item) => item.item_name === "Rush fee");

  assert.equal(jetShirt.change_reason, "Synced from linked order", "the order-derived line (has source_order_item_id) must receive the automatic reason");
  assert.equal(rushFee.change_reason, undefined, "the invoice-only line (no source_order_item_id) must NOT receive an automatic reason - if it actually changed since its previous version, the existing manual change-reason guard must still be free to reject it");
});

test("manual saved-item template protection is untouched: syncClientItemTemplates still guards every non-order-driven save with the original message", async () => {
  const source = await readInvoicesApiSource();
  assert.match(
    source,
    /async function syncClientItemTemplates\(items, clientId, tenantId, userId\) \{/,
    "syncClientItemTemplates must still run unconditionally for normal (non-preserve) saves"
  );
  assert.match(
    source,
    /throw new Error\(`Explain why \$\{name\} changed before updating this client's saved item\.`\);/,
    "the manual-edit guard message must be unchanged - normal invoice creation/editing must still require a reason for a real saved-item change"
  );
});

test("all three order-driven entry points opt into preserve mode", async () => {
  const invoicesSource = await readInvoicesApiSource();
  const buttonSource = await readFile(new URL("../src/features/invoices/CreateInvoiceFromOrderButton.jsx", import.meta.url), "utf8");

  assert.match(
    buttonSource,
    /createInvoice\(invoiceFromOrder\(order, totalPaid, defaults\), \{ templateSyncMode: "preserve" \}\)/,
    "Create OPPS invoice from order must request preserve mode"
  );

  const linkBody = invoicesSource.match(/export async function linkInvoiceToOrder\([\s\S]*?\n\}/)?.[0];
  assert.ok(linkBody, "linkInvoiceToOrder must exist");
  assert.match(linkBody, /\}, \{ templateSyncMode: "preserve" \}\);/, "linkInvoiceToOrder must request preserve mode");

  const syncBody = invoicesSource.match(/export async function syncInvoiceItemsFromOrder\([\s\S]*?\n\}/)?.[0];
  assert.ok(syncBody, "syncInvoiceItemsFromOrder must exist");
  assert.match(syncBody, /\}, \{ templateSyncMode: "preserve" \}\);/, "syncInvoiceItemsFromOrder must request preserve mode");
});

test("ordinary manual invoice save/edit (Invoices.jsx save handler) does not opt into preserve mode", async () => {
  const pageSource = await readFile(new URL("../src/pages/Invoices.jsx", import.meta.url), "utf8");
  assert.match(pageSource, /await updateInvoice\(invoice\.id, invoice\)/, "manual edit must keep calling updateInvoice with no options (default 'normal' mode)");
  assert.match(pageSource, /await createInvoice\(invoice\)/, "manual create must keep calling createInvoice with no options (default 'normal' mode)");
  assert.doesNotMatch(
    pageSource,
    /templateSyncMode/,
    "the manual save handler must stay untouched by this fix - it must keep requiring change_reason for real saved-item edits"
  );
});
