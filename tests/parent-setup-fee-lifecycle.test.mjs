import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ORDERS CLIENT-PRODUCT REUSE — PHASE 1 bugfix. removeRow must cascade a
// composed parent's deletion onto its own setup_fee companion(s), by
// exact parent_line_id, never by label/name, never a whole-order sweep.

async function readSource(rel) {
  const raw = await readFile(new URL(`../${rel}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const EDITOR = "src/components/orders/drawer/ProductsEditor.jsx";

test("removeRow cascades onto setup_fee companions by exact parent_line_id, never by label/name matching", async () => {
  const src = await readSource(EDITOR);
  const start = src.indexOf("const removeRow = (");
  const end = src.indexOf("\n  };", start);
  const body = src.slice(start, end);
  assert.ok(body.includes('target.line_role === "product"'), "cascade only triggers for a composed parent line");
  assert.ok(body.includes('candidate.line_role === "setup_fee"'));
  assert.ok(body.includes("candidate.parent_line_id === targetLineId"), "matched by exact provenance (parent_line_id), never by label/name");
  assert.ok(!body.includes(".name ===") && !body.includes(".label ==="), "never matches a companion by name/label");
});

// Behavioral simulation of the exact filter predicate removeRow uses -
// mirrors the real function without needing a React render.
function cleanProduct(item) {
  if (item && typeof item === "object") return item;
  return { name: String(item || "Item"), quantity: 1 };
}
function simulateRemoveRow(products, idx) {
  const target = cleanProduct(products[idx]);
  const targetLineId = target.line_id;
  return products.filter((raw, i) => {
    if (i === idx) return false;
    if (target.line_role === "product" && targetLineId) {
      const candidate = cleanProduct(raw);
      if (candidate.line_role === "setup_fee" && candidate.parent_line_id === targetLineId) return false;
    }
    return true;
  });
}

test("deleting a composed parent removes its own setup_fee companion in the same edit", () => {
  const products = [
    { line_id: "parent-1", line_role: "product", name: "Tee" },
    { line_id: "fee-1", line_role: "setup_fee", parent_line_id: "parent-1", name: "Screen setup" },
  ];
  const result = simulateRemoveRow(products, 0);
  assert.deepEqual(result, [], "both the parent and its companion are gone");
});

test("deleting one parent never touches a DIFFERENT parent's setup_fee companion, even with the same label", () => {
  const products = [
    { line_id: "parent-1", line_role: "product", name: "Tee A" },
    { line_id: "fee-1", line_role: "setup_fee", parent_line_id: "parent-1", name: "Screen setup" },
    { line_id: "parent-2", line_role: "product", name: "Tee B" },
    { line_id: "fee-2", line_role: "setup_fee", parent_line_id: "parent-2", name: "Screen setup" },
  ];
  const result = simulateRemoveRow(products, 0);
  assert.deepEqual(result.map((p) => p.line_id), ["parent-2", "fee-2"], "the second parent + its own companion (same label) survive untouched");
});

test("deleting a setup_fee line by itself removes only that one line - it has no companions", () => {
  const products = [
    { line_id: "parent-1", line_role: "product", name: "Tee" },
    { line_id: "fee-1", line_role: "setup_fee", parent_line_id: "parent-1", name: "Screen setup" },
  ];
  const result = simulateRemoveRow(products, 1);
  assert.deepEqual(result.map((p) => p.line_id), ["parent-1"], "the parent survives; only the setup fee is gone");
});

test("a generic/legacy line (no line_role) or a 'product' line with no setup_fee children behaves exactly as before - plain removal, no cascade", () => {
  const legacy = [{ name: "Custom item", quantity: 1 }, { name: "Another item", quantity: 1 }];
  assert.deepEqual(simulateRemoveRow(legacy, 0), [{ name: "Another item", quantity: 1 }]);

  const noChildren = [{ line_id: "parent-1", line_role: "product", name: "Tee" }, { name: "Unrelated custom item" }];
  assert.deepEqual(simulateRemoveRow(noChildren, 0), [{ name: "Unrelated custom item" }]);
});

test("removing a parent whose id happens to collide with an unrelated line's parent_line_id-shaped string still only matches exact equality", () => {
  const products = [
    { line_id: "p1", line_role: "product" },
    { line_id: "fee-x", line_role: "setup_fee", parent_line_id: "p1x" }, // NOT an exact match to "p1"
  ];
  const result = simulateRemoveRow(products, 0);
  assert.deepEqual(result.map((p) => p.line_id), ["fee-x"], "a near-miss parent_line_id (p1x vs p1) is never treated as a match");
});
