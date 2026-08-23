import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// Source-order traceability: client_products.created_from_order_id (FK
// -> public.orders(id), confirmed live) was silently dropped on every
// create path - both because dataClient.js's ClientProduct.serialize()
// never allowlisted it (the same class of bug found for
// inventory_item_id two passes ago), and because none of the three
// create call sites (resolveOrCreateClientProductForLine's two
// branches, createClientProductMutation's three branches) ever passed
// it. Confirmed live: 0 of 5 existing client_products had it set before
// this fix; the one narrowly-provable row (Jai's X1 Crochet Wide Leg
// Pant, unambiguously referenced by exactly one order via
// client_product_id) was backfilled separately, out of band from this
// code fix - the other 4 were left untouched (not provably traceable).
// ─────────────────────────────────────────────────────────────────────

test("dataClient's ClientProduct.serialize() allowlist includes created_from_order_id - otherwise it is silently dropped on every create", async () => {
  const source = await readSource("src/api/dataClient.js");
  const start = source.indexOf("ClientProduct: {");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 1200);
  assert.ok(body.includes("created_from_order_id: payload.created_from_order_id"), "the serialize() allowlist must pass created_from_order_id through");
});

test("resolveOrCreateClientProductForLine passes created_from_order_id on BOTH the catalog-backed and inventory-backed create branches", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const resolveOrCreateClientProductForLine = async (orderLine) => {");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 1400);
  const occurrences = (body.match(/created_from_order_id: order\.id/g) || []).length;
  assert.equal(occurrences, 2, "both the catalog_item_id branch and the inventory_item_id branch must set created_from_order_id: order.id on creation");
});

test("createClientProductMutation passes created_from_order_id on all three create branches (catalog-matched, stock-matched, standalone)", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const createClientProductMutation = useMutation({");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 2000);
  const occurrences = (body.match(/created_from_order_id: order\.id/g) || []).length;
  assert.equal(occurrences, 3, "the catalog-matched, stock-matched, and standalone create calls must all set created_from_order_id: order.id");
});

test("reusing an already-existing client_product never calls .create() again - an existing non-null created_from_order_id can never be overwritten by this code path", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  // Every reuse branch in both functions is `if (!clientProduct) { ... .create(...) }`
  // or the equivalent `let clientProduct = X.get(...); if (!clientProduct) { .create(...) }`
  // shape - .create() is only ever reachable when no existing row was found.
  // This is a structural proof: count that every ClientProduct.create( call
  // site is preceded (within 300 chars) by a `!clientProduct` guard.
  const createIndices = [];
  let idx = source.indexOf("dataClient.entities.ClientProduct.create(");
  while (idx !== -1) {
    createIndices.push(idx);
    idx = source.indexOf("dataClient.entities.ClientProduct.create(", idx + 1);
  }
  assert.equal(createIndices.length, 5, "expected exactly 5 ClientProduct.create() call sites (2 in resolveOrCreateClientProductForLine, 3 in createClientProductMutation)");
  for (const createIdx of createIndices) {
    const preceding = source.slice(Math.max(0, createIdx - 400), createIdx);
    assert.ok(
      /if \(!clientProduct/.test(preceding) || /const clientProduct = await dataClient\.entities\.ClientProduct\.create\($/.test(source.slice(Math.max(0, createIdx - 60), createIdx)),
      "every create call must be gated on no existing client_product being found, or be the deliberately-always-new standalone branch"
    );
  }
});
