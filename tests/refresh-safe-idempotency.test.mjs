import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ORDERS CLIENT-PRODUCT REUSE — PHASE 1: refresh-safe idempotency. The
// original design kept the pending-add identity in a React ref alone,
// lost on a hard refresh. The fix reuses ALREADY-DURABLE, order-scoped
// state (order.products + order_line_component_snapshots, both already
// fetched) as the "is there an incomplete attempt for this exact
// product" signal — no new column, no new table, no localStorage.

async function readSource(rel) {
  const raw = await readFile(new URL(`../${rel}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const EDITOR = "src/components/orders/drawer/ProductsEditor.jsx";

test("findIncompleteLineFor reads durable order state - products + lineSnapshots - never browser storage", async () => {
  const src = await readSource(EDITOR);
  const start = src.indexOf("const findIncompleteLineFor = (clientProductId) => {");
  assert.notEqual(start, -1);
  const end = src.indexOf("\n  };", start);
  const body = src.slice(start, end);
  assert.ok(body.includes("lineSnapshots"));
  assert.ok(body.includes('p.line_role === "product"'));
  assert.ok(body.includes("p.client_product_id === clientProductId"));
  assert.ok(body.includes("!snapshottedLineIds.has(p.line_id)"), "a line with a current snapshot is never treated as incomplete");
  assert.ok(!/localStorage|sessionStorage|window\.name/.test(body));
});

test("the mutation checks for a resumable line BEFORE minting a key or calling the add RPC", async () => {
  const src = await readSource(EDITOR);
  const start = src.indexOf("const addComposedClientProductMutation = useMutation({");
  const end = src.indexOf("onSuccess:", start);
  const body = src.slice(start, end);

  const resumableCheckAt = body.indexOf("const resumable = findIncompleteLineFor(clientProductId);");
  const keyMintAt = body.indexOf("if (!composedAddIdempotencyKeyRef.current) composedAddIdempotencyKeyRef.current = newLineId();");
  const rpcCallAt = body.indexOf("await xosAddComposedClientProductToOrder(");
  assert.ok(resumableCheckAt > -1 && resumableCheckAt < keyMintAt && keyMintAt < rpcCallAt,
    "resumable check happens first, key minting and the RPC call only happen in the non-resumable branch");
});

test("when resuming, the RPC is never called again - the existing parent_line_id drives straight into resolveComposition/writeAttachSnapshots", async () => {
  const src = await readSource(EDITOR);
  const start = src.indexOf("const addComposedClientProductMutation = useMutation({");
  const ifResumableStart = src.indexOf("if (resumable) {", start);
  const elseStart = src.indexOf("} else {", ifResumableStart);
  const resumableBranch = src.slice(ifResumableStart, elseStart);
  assert.ok(resumableBranch.includes("parentLineId = resumable.line_id;"));
  assert.ok(!resumableBranch.includes("xosAddComposedClientProductToOrder"), "resuming never re-calls the add RPC");
});

// Behavioral simulation of findIncompleteLineFor's exact predicate,
// mirroring the real function without a React render.
function cleanProduct(item) {
  if (item && typeof item === "object") return item;
  return { name: String(item || "Item"), quantity: 1 };
}
function simulateFindIncompleteLineFor(products, lineSnapshots, clientProductId) {
  const snapshottedLineIds = new Set(lineSnapshots.map((s) => s.line_id));
  return products
    .map((raw) => cleanProduct(raw))
    .find((p) => p.line_role === "product" && p.client_product_id === clientProductId && !snapshottedLineIds.has(p.line_id));
}

test("an incomplete prior attempt (server-confirmed, no snapshot yet) for the SAME product is found and reused as the resume target", () => {
  const products = [{ line_id: "parent-1", line_role: "product", client_product_id: "cp-A" }];
  const found = simulateFindIncompleteLineFor(products, [], "cp-A");
  assert.equal(found?.line_id, "parent-1");
});

test("once ANY current snapshot exists for that line, it is no longer treated as incomplete - a later add of the same product mints a genuinely new line", () => {
  const products = [{ line_id: "parent-1", line_role: "product", client_product_id: "cp-A" }];
  const lineSnapshots = [{ line_id: "parent-1" }]; // at least one current snapshot now exists
  const found = simulateFindIncompleteLineFor(products, lineSnapshots, "cp-A");
  assert.equal(found, undefined, "a completed line is never mistaken for a pending one - intentional re-add still works");
});

test("an incomplete line for a DIFFERENT client product is never matched", () => {
  const products = [{ line_id: "parent-1", line_role: "product", client_product_id: "cp-A" }];
  const found = simulateFindIncompleteLineFor(products, [], "cp-B");
  assert.equal(found, undefined);
});

test("a setup_fee line is never mistaken for an incomplete product line, even with a matching client_product_id", () => {
  const products = [{ line_id: "fee-1", line_role: "setup_fee", client_product_id: "cp-A", parent_line_id: "parent-1" }];
  const found = simulateFindIncompleteLineFor(products, [], "cp-A");
  assert.equal(found, undefined);
});

test("the idempotency ref is cleared (not reused) when resuming - it belongs only to the fresh-RPC-call path", async () => {
  const src = await readSource(EDITOR);
  const ifResumableStart = src.indexOf("if (resumable) {");
  const elseStart = src.indexOf("} else {", ifResumableStart);
  const resumableBranch = src.slice(ifResumableStart, elseStart);
  assert.ok(resumableBranch.includes('composedAddIdempotencyKeyRef.current = "";'));
});
