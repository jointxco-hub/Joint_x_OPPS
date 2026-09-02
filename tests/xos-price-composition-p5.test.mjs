import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  itemFromProduct,
  invoiceFromOrder,
  sanitizeInvoicePriceBreakdown,
  isBillableOrderLine,
  buildOrderInvoiceSyncPlan,
} from "../src/features/invoices/orderToInvoiceItems.js";
import { calculateInvoiceTotals, normalizeInvoiceItems } from "../src/features/invoices/invoiceCalculations.js";

async function readSource(rel) {
  const raw = await readFile(new URL(`../${rel}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// A canonical P4-expanded OPPS order: parent + setup companion (+ frozen breakdown w/ component_id).
const composedOrder = {
  id: "0dd00001-0000-0000-0000-00000000d001",
  order_number: "XL-1",
  client_id: "c1",
  client_name: "Lazi",
  products: [
    {
      line_id: "11111111-1111-4111-8111-111111111111",
      line_role: "product",
      name: "JET T-Shirt",
      quantity: 10,
      price: 250,
      line_total: 2500,
      client_product_id: "cp1",
      price_breakdown: {
        mode: "composed",
        per_unit: [
          { label: "Blank T-Shirt", role: "base", amount: 120, component_id: "d1" },
          { label: "Front DTF", role: "print", amount: 65, production_method: "dtf", placement: "Front", component_id: "d2" },
          { label: "Back DTF", role: "print", amount: 65, production_method: "dtf", placement: "Back", component_id: "d3" },
        ],
        reconciled: true, difference: 0, unit_price: 250,
      },
    },
    {
      line_id: "22222222-2222-4222-8222-222222222222",
      line_role: "setup_fee",
      parent_line_id: "11111111-1111-4111-8111-111111111111",
      name: "Artwork Setup",
      quantity: 1,
      price: 300,
      line_total: 300,
      breakdown_role: "setup",
    },
  ],
  total_amount: 2800,
};

// §A/B/C — composed parent + setup companion invoice items
test("composed order -> parent billable item + setup companion billable item, breakdown as metadata (§A,§B,§C)", () => {
  const inv = invoiceFromOrder(composedOrder);
  assert.equal(inv.items.length, 2);
  const parent = inv.items.find((i) => i.item_name === "JET T-Shirt");
  const setup = inv.items.find((i) => i.item_name === "Artwork Setup");
  assert.equal(parent.quantity, 10);
  assert.equal(parent.rate, 250);
  assert.equal(setup.quantity, 1);
  assert.equal(setup.rate, 300);
  assert.equal(setup.item_type, "services");
  assert.equal(setup.source_order_item_id, "22222222-2222-4222-8222-222222222222");
  assert.equal(setup.source_metadata.parent_order_line_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(setup.source_metadata.fee_role, "setup");
  assert.equal(parent.source_metadata.price_breakdown.mode, "composed");
  assert.equal(parent.source_metadata.price_breakdown.per_unit.length, 3);
});

// §5 / §28 — component_id stripped, whitelist only
test("persisted price_breakdown is customer-safe: no component_id, no once_per_order_fees, no cost", () => {
  const pb = sanitizeInvoicePriceBreakdown(composedOrder.products[0].price_breakdown);
  assert.ok(!JSON.stringify(pb).includes("component_id"));
  assert.ok(!("once_per_order_fees" in pb));
  assert.deepEqual(Object.keys(pb).sort(), ["difference", "mode", "per_unit", "reconciled", "unit_price"]);
  for (const row of pb.per_unit) {
    assert.deepEqual(Object.keys(row).sort(), ["amount", "label", "placement", "production_method", "role"]);
  }
  assert.equal(sanitizeInvoicePriceBreakdown({ mode: "single" }), null);
  assert.equal(sanitizeInvoicePriceBreakdown(null), null);
});

// §D / §21 — NO DOUBLE COUNT
test("no double count: billable total = 2500 + 300 = 2800; informational rows add nothing", () => {
  const inv = invoiceFromOrder(composedOrder);
  const totals = calculateInvoiceTotals({ shipping_charge: 0, adjustment: 0 }, inv.items);
  assert.equal(totals.subtotal, 2800, "Σ line_subtotal (JET 2500 + Setup 300)");
  assert.equal(totals.total, 2800);
  // the per-unit breakdown (120+65+65) must NOT be summed
  assert.ok(totals.subtotal !== 2800 + 120 + 65 + 65);
});

// §E — multiple setup fees
test("multiple setup companions -> each is one billable line, each billed once", () => {
  const order = JSON.parse(JSON.stringify(composedOrder));
  order.products.push({
    line_id: "33333333-3333-4333-8333-333333333333", line_role: "setup_fee",
    parent_line_id: "11111111-1111-4111-8111-111111111111",
    name: "Embroidery digitising", quantity: 1, price: 350, line_total: 350, breakdown_role: "setup",
  });
  order.total_amount = 3150;
  const inv = invoiceFromOrder(order);
  assert.equal(inv.items.length, 3);
  const totals = calculateInvoiceTotals({ shipping_charge: 0, adjustment: 0 }, inv.items);
  assert.equal(totals.total, 250 * 10 + 300 + 350); // 3150
});

// §F / §23 — mismatch preserved
test("mismatch: parent price 240 billed, breakdown still sums 250, reconciled false (§F,§23)", () => {
  const order = JSON.parse(JSON.stringify(composedOrder));
  order.products[0].price = 240;
  order.products[0].line_total = 2400;
  order.products[0].price_breakdown.reconciled = false;
  order.products[0].price_breakdown.difference = -10;
  order.products[0].price_breakdown.unit_price = 240;
  order.total_amount = 2700;
  const inv = invoiceFromOrder(order);
  const parent = inv.items.find((i) => i.item_name === "JET T-Shirt");
  assert.equal(parent.rate, 240);
  assert.equal(parent.source_metadata.price_breakdown.per_unit.reduce((s, r) => s + r.amount, 0), 250);
  assert.equal(parent.source_metadata.price_breakdown.reconciled, false);
  const totals = calculateInvoiceTotals({ shipping_charge: 0, adjustment: 0 }, inv.items);
  assert.equal(totals.total, 2400 + 300); // 2700 — no forced reconciliation
});

// §H / §24 — legacy order unchanged shape
test("legacy order (no line_role, no price_breakdown) -> byte-shape-compatible items, no new metadata", () => {
  const legacy = { id: "o2", order_number: "XL-2", products: [
    { line_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Plain Tee", quantity: 5, price: 100, line_total: 500 },
  ] };
  const inv = invoiceFromOrder(legacy);
  assert.equal(inv.items.length, 1);
  const it = inv.items[0];
  assert.equal(it.item_type, "goods");
  assert.ok(!("price_breakdown" in it.source_metadata));
  assert.ok(!("line_role" in it.source_metadata));
  assert.ok(!("parent_order_line_id" in it.source_metadata));
});

// §3 — breakdown-role order lines never become invoice items
test("reserved line_role='breakdown' order line is excluded from invoice items and sync plan", () => {
  const order = JSON.parse(JSON.stringify(composedOrder));
  order.products.push({ line_id: "44444444-4444-4444-8444-444444444444", line_role: "breakdown", name: "info", quantity: 1, price: 0 });
  assert.equal(isBillableOrderLine(order.products[2]), false);
  const inv = invoiceFromOrder(order);
  assert.ok(!inv.items.some((i) => i.item_name === "info"));
  const plan = buildOrderInvoiceSyncPlan(order.products, []);
  assert.ok(!plan.items.some((i) => i.item_name === "info"));
});

// §I / §25 — sync line matching: parent + setup match independently, no false missing
test("order<->invoice sync: parent + setup match by line_id <-> source_order_item_id, no false missing (§I,§25)", () => {
  const inv = invoiceFromOrder(composedOrder);
  // simulate the persisted invoice items round-tripping back
  const persisted = inv.items.map((i, ix) => ({ ...i, id: `ii-${ix}` }));
  const plan = buildOrderInvoiceSyncPlan(composedOrder.products, persisted);
  assert.equal(plan.diff.added.length, 0, "nothing spuriously added");
  assert.equal(plan.diff.removedFromOrder.length, 0, "nothing spuriously removed");
  assert.equal(plan.items.length, 2, "parent + setup both present");
});

// §N — no internal/cost leakage into persisted invoice metadata
test("no cost/supplier/margin/internal/component_id in any mapped invoice item", () => {
  const inv = invoiceFromOrder(composedOrder);
  const blob = JSON.stringify(inv.items);
  assert.ok(!/component_id|unit_cost|supplier|margin|procurement|internal_notes/i.test(blob));
});

// invoiceCalculations defensively drops an informational item
test("normalizeInvoiceItems drops a line_role='breakdown' item if one ever appears", () => {
  const kept = normalizeInvoiceItems([
    { item_name: "JET", quantity: 10, rate: 250 },
    { item_name: "info", quantity: 1, rate: 999, source_metadata: { line_role: "breakdown" } },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].item_name, "JET");
});

// ── server-side total invariant wiring (the invariant itself is proven in the disposable SQL suite) ──
test("save_opps_invoice_with_items P5 wiring: p_allow_total_override threaded + friendly error copy", async () => {
  const api = await readSource("src/api/invoices.js");
  assert.ok(api.includes("p_allow_total_override: Boolean(allowTotalOverride)"));
  assert.ok(api.includes("INVOICE_TOTAL_MISMATCH:") && api.includes("INVOICE_TOTAL_OVERRIDE_REASON_REQUIRED:"));
  const mig = await readSource("supabase/migrations/20260902120000_xos_price_composition_p5_invoice_total_validation.sql");
  assert.ok(mig.includes("INVOICE_TOTAL_MISMATCH"));
  assert.ok(mig.includes("drop function if exists public.save_opps_invoice_with_items(uuid, uuid, jsonb, jsonb, timestamptz, integer);"), "old 6-arg signature dropped before the 7-arg create");
  assert.ok(mig.includes("total_override_reason") && mig.includes("total_override_by") && mig.includes("total_override_at"));
  assert.ok(mig.includes("<> 'breakdown'"), "billable-only sum excludes breakdown lines");
  assert.ok(!/product_components|_derive_client_product_price_composition|default_sell_price/.test(mig), "invoice validation never reads Client Product pricing (§2)");
});

// §18 / §19 — reconciliation uses the ORDER's frozen data, never current Client Product pricing
test("order<->invoice reconciliation reads frozen order data only; setup + breakdown metadata move with the parent (§18,§19)", async () => {
  const src = await readSource("src/features/invoices/orderToInvoiceItems.js");
  // sync plan is built purely from orderProducts + currentItems
  assert.ok(src.includes("export function buildOrderInvoiceSyncPlan(orderProducts = [], currentItems = [], shipping)"));
  assert.ok(!/client_products|product_components|_derive_client_product_price_composition|default_sell_price/.test(src),
    "the order->invoice layer never touches Client Product / component pricing");
  assert.ok(src.includes("source_metadata: mapped.source_metadata"), "informational price_breakdown metadata rides with the matched parent, not a separate sync line");
  // reopen_invoice / apply_invoice_order_sync are NOT modified by P5
  const migFiles = await readSource("supabase/migrations/20260902120000_xos_price_composition_p5_invoice_total_validation.sql");
  assert.ok(!/function public\.(apply_invoice_order_sync|reopen_invoice|link_invoice_to_order_relational)\b/.test(migFiles),
    "P5 does not touch the order/invoice sync or reopen RPCs");
});

// UI + PDF render the breakdown as informational, not billable rows
test("ClientInvoiceView + InvoiceDetailDrawer + PDF render price_breakdown as informational sub-rows", async () => {
  for (const f of ["src/features/invoices/ClientInvoiceView.jsx", "src/features/invoices/InvoiceDetailDrawer.jsx"]) {
    const s = await readSource(f);
    assert.ok(s.includes('item.source_metadata?.price_breakdown?.mode === "composed"'), `${f} guards on composed breakdown`);
    assert.ok(s.includes("/ item"), `${f} shows per-item amounts`);
    assert.ok(s.includes("reconciled === false"), `${f} shows the mismatch note`);
  }
  const pdf = await readSource("src/features/invoices/invoicePdfBuilder.js");
  assert.ok(pdf.includes("price_breakdown") && pdf.includes("flatMap"), "PDF summary appends breakdown sub-lines, not billable rows");
});
