import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// Configure Product (Phases 4-6) reuses the EXISTING Production panel /
// addPrintOptionMutation path once catalog_item_id + client_product_id
// are set on a line - it must never fork a second, invoice-specific
// composition editor or a competing render gate. These tests guard
// that "genuine reuse, not a parallel implementation" property.
// ─────────────────────────────────────────────────────────────────────

const GATE = "p.catalog_item_id && p.line_id";

test("the Production panel render gate is still exactly `p.catalog_item_id && p.line_id`, and appears exactly once", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const occurrences = source.split(GATE).length - 1;
  assert.ok(occurrences >= 1, "the original gate condition must still be present verbatim");
  assert.equal(occurrences, 1, "the gate must not be duplicated into a second, competing composition-editor condition");
});

test("no second/duplicated Production-panel gate was introduced (e.g. keyed off client_product_id instead)", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(
    !source.includes("p.client_product_id && p.line_id"),
    "Configure Product must not introduce a parallel gate keyed off client_product_id - the Production panel stays gated on catalog_item_id only"
  );
});

test("addPrintOptionMutation still exists, unmodified in its core client_product reuse-or-create logic", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("const addPrintOptionMutation = useMutation("), "addPrintOptionMutation must still be the same function");
  assert.ok(
    source.includes("clientProductByCatalogItemId.get(orderLine.catalog_item_id)"),
    "addPrintOptionMutation's on-demand client_product reuse-or-create lookup must be untouched"
  );
});
