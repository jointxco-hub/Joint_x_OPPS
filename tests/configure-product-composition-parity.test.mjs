import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// Configure Product (Phases 4-6, corrected) reuses the EXISTING
// Production panel / addPrintOptionMutation path for every production-
// capable identity a line can carry (catalog, stock/inventory, or a
// standalone client_product) - it must never fork a second, invoice- or
// source-specific composition editor, and it must never fabricate a
// catalog_item_id to force a stock/inventory line through the old
// catalog-only gate. These tests guard that "genuine reuse across all
// three identity types, not a parallel implementation" property.
//
// The original version of this file asserted the OLD, incomplete gate
// (`p.catalog_item_id && p.line_id`) as correct - that gate is exactly
// the bug this correction fixes (it silently hid Production from stock-
// sourced and standalone-client_product lines), so those assertions
// have been replaced, not just extended.
// ─────────────────────────────────────────────────────────────────────

const OLD_CATALOG_ONLY_GATE = "p.catalog_item_id && p.line_id &&";
const NEW_GATE = "isProductionCapableLine(p)";

test("the Production panel render gate is isProductionCapableLine(p), appears exactly once, and the old catalog-only gate is gone", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const newGateOccurrences = source.split(NEW_GATE).length - 1;
  assert.ok(newGateOccurrences >= 1, "the corrected gate must be present");
  assert.equal(newGateOccurrences, 1, "the gate must not be duplicated into a second, competing composition-editor condition");
  assert.ok(
    !source.includes(OLD_CATALOG_ONLY_GATE),
    "the old catalog-only gate must not still be present as a leftover/parallel condition - stock and standalone client_product lines were silently excluded by it"
  );
});

test("isProductionCapableLine is imported from lineConfiguration, not reimplemented inline", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(
    /import\s*\{[^}]*isProductionCapableLine[^}]*\}\s*from\s*"@\/features\/orders\/lineConfiguration"/.test(source),
    "the predicate must be the single shared helper, not a second inline copy"
  );
});

test("addPrintOptionMutation still exists and resolves via clientProductForLine first (catalog, stock, or standalone), not a catalog-only lookup", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("const addPrintOptionMutation = useMutation("), "addPrintOptionMutation must still be the same function");

  const start = source.indexOf("const addPrintOptionMutation = useMutation(");
  const body = source.slice(start, start + 1600);
  assert.ok(
    body.includes("let clientProduct = clientProductForLine(orderLine);"),
    "must resolve via the shared clientProductForLine (catalog -> stock -> standalone), not clientProductByCatalogItemId directly"
  );
  assert.ok(
    body.includes("orderLine.inventory_item_id") && body.includes("inventory_item_id: orderLine.inventory_item_id"),
    "must be able to on-demand-create a client_product from a stock line's inventory_item_id, preserving that identity"
  );
  assert.ok(
    !/opps_product_id:\s*orderLine\.inventory_item_id/.test(body),
    "must never write an inventory item's id into opps_product_id - that column references products, not inventory"
  );
});

test("createClientProductMutation handles a stock-sourced pick without discarding it into a bare standalone client_product", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const createClientProductMutation = useMutation(");
  assert.notEqual(start, -1, "createClientProductMutation must still exist");
  const body = source.slice(start, start + 2200);
  assert.ok(
    body.includes('pickedItem.source === "stock"'),
    "picking a stock item in Create Client Product must be handled explicitly, not silently fall through to the no-item-picked branch"
  );
  assert.ok(
    body.includes("clientProductByInventoryItemId"),
    "must reuse an existing client_product already keyed by this inventory item before creating a new one"
  );
});

test("client_products lookup covers all three identities: catalog, inventory/stock, and direct client_product_id", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("clientProductByCatalogItemId"), "catalog lookup must still exist");
  assert.ok(source.includes("clientProductByInventoryItemId"), "stock/inventory lookup must exist");
  assert.ok(source.includes("clientProductsById"), "direct client_product_id lookup must still exist");
  const resolverStart = source.indexOf("const clientProductForLine = (line) =>");
  assert.notEqual(resolverStart, -1);
  const resolverBody = source.slice(resolverStart, resolverStart + 400);
  assert.ok(resolverBody.includes("clientProductByCatalogItemId.get"));
  assert.ok(resolverBody.includes("clientProductByInventoryItemId.get"));
});

test("dataClient's ClientProduct.create serializer includes inventory_item_id - otherwise it would be silently dropped on write", async () => {
  const source = await readSource("src/api/dataClient.js");
  const start = source.indexOf("ClientProduct: {");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 1200);
  assert.ok(body.includes("inventory_item_id: payload.inventory_item_id"), "the serialize() allowlist must pass inventory_item_id through");
});
