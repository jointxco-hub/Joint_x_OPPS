import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(rel) {
  const raw = await readFile(new URL(`../${rel}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ── OPPS-side P4 wiring (the canonical reshape / snapshot / validation
// lives in the X LAB P4 migration + its disposable suite). ──

test("xosClientProduct.js exposes the canonical composed-add wrapper", async () => {
  const src = await readSource("src/api/xosClientProduct.js");
  assert.ok(src.includes("export async function xosAddComposedClientProductToOrder"));
  assert.ok(src.includes('"xos_add_composed_client_product_to_order"'), "calls the canonical RPC");
  assert.ok(/p_order_id:\s*orderId[\s\S]{0,120}p_client_product_id:\s*clientProductId[\s\S]{0,120}p_quantity/.test(src), "passes order / cp / quantity");
});

test("mapXosCpError maps the new P4 error codes", async () => {
  const src = await readSource("src/api/xosClientProduct.js");
  for (const code of ["ORDER_SETUP_FEE_PARENT_NOT_FOUND", "ORDER_LINE_ROLE_INVALID", "XOS_PRICE_BREAKDOWN_INVALID", "TENANT_ACCESS_DENIED"]) {
    assert.ok(src.includes(code), `maps ${code}`);
  }
});

test("ProductsEditor: composed-add UI is wired to the wrapper + re-syncs from the persisted order", async () => {
  const src = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(src.includes("xosAddComposedClientProductToOrder(order.id, clientProductId, quantity)"));
  assert.ok(src.includes("const addComposedMutation = useMutation("));
  assert.ok(src.includes("onUpdate(order.id, { products: freshOrder.products })"), "re-syncs from what the RPC persisted, not a client rebuild");
  assert.ok(src.includes('addComposedMutation.mutate({ clientProductId: composedCpId'), "the Add-product panel button fires it");
});

test('§21: "+ Add print option" stays LEGACY and is guarded off canonical composed lines', async () => {
  const src = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  // handler guard (in the onStartAddPrintOption arrow)
  assert.ok(src.includes('onStartAddPrintOption={() => {'), "onStartAddPrintOption is an arrow with a body");
  assert.ok(src.includes('if (p.line_role === "setup_fee" || (p.line_role === "product" && p?.price_breakdown?.mode === "composed")) {'), "click handler blocks composed / setup lines");
  assert.ok(src.includes("Edit prices in the Pricing tab, not here."), "with a clear staff message");
  // mutation-level defence in depth
  const mStart = src.indexOf("const addPrintOptionMutation = useMutation({");
  const body = src.slice(mStart, mStart + 900);
  assert.ok(body.includes('orderLine?.line_role === "setup_fee"') && body.includes('orderLine?.price_breakdown?.mode === "composed"'), "mutationFn also refuses");
  // it is NOT routed into the canonical helper — still its own legacy path
  assert.ok(src.includes("buildSetupFeeCompanionPayload"), "legacy setup-fee companion writer still present (deliberate)");
});

test("§10 / §19: setup_fee companion is billable once (in subtotal) but NOT a unit", async () => {
  const src = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const sub = src.indexOf("const productLineTotal = products.reduce(");
  const block = src.slice(sub, sub + 500);
  assert.ok(block.includes('if (product.line_role === "breakdown") return sum;'), "breakdown lines excluded from the commercial subtotal");
  assert.ok(block.includes('if (product.line_role && product.line_role !== "product") return sum;'), "only product lines count as units");
});

test("no raw product_components pricing read on the sync/native path in the wrapper", async () => {
  const src = await readSource("src/api/xosClientProduct.js");
  const start = src.indexOf("export async function xosAddComposedClientProductToOrder");
  const end = src.indexOf("export async function getClientOrderLinesForImport");
  const body = src.slice(start, end);
  assert.ok(!/product_components|default_sell_price|production_pricing_defaults/.test(body), "the wrapper is a thin RPC call — no client-side pricing");
});
