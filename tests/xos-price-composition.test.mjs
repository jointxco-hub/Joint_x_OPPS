import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  readPricing,
  bearingComponents,
  activeBaseCount,
  derivedComponentLabel,
  billingModeIsEditable,
  defaultBillingModeFor,
  roleForType,
  buildPricingSavePayload,
  wouldBreakSingleBase,
  formatMoney,
  PRICE_BEARING_TYPES,
} from "../src/lib/xosPriceComposition.js";

async function readSource(rel) {
  const raw = await readFile(new URL(`../${rel}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ── Fixtures shaped exactly like get_client_product_full() output ──
const composedFull = {
  pricing: {
    mode: "composed", client_price: 250, currency: "ZAR", requires_quote: false,
    computed_unit_price: 250, computed_once_per_order_total: 300, reconciled: true, difference: 0,
    allow_multiple_base: false,
    breakdown: {
      per_unit: [
        { label: "Blank T-Shirt", role: "base", amount: 120, billing_mode: "per_unit" },
        { label: "DTF Front", role: "print", amount: 65, billing_mode: "per_unit" },
        { label: "DTF Back", role: "print", amount: 65, billing_mode: "per_unit" },
      ],
      once_per_order: [{ label: "Artwork setup", role: "setup", amount: 300, billing_mode: "once_per_order" }],
    },
  },
  production: {
    components: [
      { id: "b1", component_type: "blank_garment", is_active: true, default_sell_price: 120, price_label: "Blank T-Shirt", billing_mode: "per_unit", sort_order: 0 },
      { id: "p1", component_type: "print_service", production_method: "dtf", placement: "Front", is_active: true, default_sell_price: 65, billing_mode: "per_unit", sort_order: 1 },
      { id: "p2", component_type: "print_service", production_method: "dtf", placement: "Back", is_active: true, default_sell_price: 65, billing_mode: "per_unit", sort_order: 2 },
      { id: "s1", component_type: "setup_fee", production_method: "dtf", is_active: true, default_sell_price: 300, price_label: "Artwork setup", billing_mode: "once_per_order", sort_order: 3 },
      { id: "m1", component_type: "material", is_active: true, default_sell_price: 40, billing_mode: "per_unit", sort_order: 4 },
    ],
  },
};
const legacyFull = { pricing: { mode: "single", client_price: 199, currency: "ZAR", requires_quote: false, computed_unit_price: null, computed_once_per_order_total: null, reconciled: null, difference: null, allow_multiple_base: false, breakdown: { per_unit: [], once_per_order: [] } }, production: { components: [] } };
const unpricedFull = { pricing: { mode: "single", client_price: null, currency: "ZAR", computed_unit_price: null, reconciled: null, difference: null, allow_multiple_base: false, breakdown: { per_unit: [], once_per_order: [] } }, production: { components: [
  { id: "b1", component_type: "blank_garment", is_active: true, default_sell_price: null, sort_order: 0 },
  { id: "p1", component_type: "print_service", production_method: "dtf", placement: "Front", is_active: true, default_sell_price: null, sort_order: 1 },
] } };
const mismatchFull = JSON.parse(JSON.stringify(composedFull));
mismatchFull.pricing.client_price = 240; mismatchFull.pricing.reconciled = false; mismatchFull.pricing.difference = -10;

// P2L 1
test("legacy single-price product reads as mode 'single'", () => {
  const p = readPricing(legacyFull);
  assert.equal(p.mode, "single");
  assert.equal(p.clientPrice, 199);
  assert.deepEqual(p.perUnit, []);
});
// P2L 2
test("composed product exposes mode + breakdown + totals", () => {
  const p = readPricing(composedFull);
  assert.equal(p.mode, "composed");
  assert.equal(p.perUnit.length, 3);
  assert.equal(p.oncePerOrder.length, 1);
});
// P2L 3
test("unpriced components still listed; computed price null tolerated", () => {
  const p = readPricing(unpricedFull);
  assert.equal(p.computedUnitPrice, null);
  assert.equal(bearingComponents(unpricedFull).length, 2);
});
// P2L 4
test("per-item total from the server, not a local re-sum", () => {
  assert.equal(readPricing(composedFull).computedUnitPrice, 250);
});
// P2L 5
test("once-per-order total from the server", () => {
  assert.equal(readPricing(composedFull).computedOnceTotal, 300);
});
// P2L 6
test("mismatch: reconciled=false + difference surfaced, amounts not redistributed", () => {
  const p = readPricing(mismatchFull);
  assert.equal(p.reconciled, false);
  assert.equal(p.difference, -10);
  assert.equal(p.perUnit.reduce((s, r) => s + r.amount, 0), 250);
  assert.equal(p.clientPrice, 240);
});
// P2L 7
test("addon rendering: role addon, billing editable only for addons", () => {
  assert.equal(roleForType("addon"), "addon");
  assert.equal(billingModeIsEditable("addon"), true);
  assert.equal(billingModeIsEditable("setup_fee"), false);
  assert.equal(defaultBillingModeFor("setup_fee"), "once_per_order");
  assert.deepEqual([...PRICE_BEARING_TYPES].sort(), ["addon", "blank_garment", "print_service", "setup_fee"]);
});
// P2L 8
test("base component guard mirrors the RPC rule", () => {
  const twoBases = [{ component_type: "blank_garment", is_active: true }, { component_type: "blank_garment", is_active: true }];
  assert.equal(wouldBreakSingleBase(twoBases, false), true);
  assert.equal(wouldBreakSingleBase(twoBases, true), false);
  assert.equal(activeBaseCount(composedFull), 1);
});
// P2L 9
test("null reader tolerance: readPricing never throws", () => {
  for (const bad of [undefined, null, {}, { pricing: null }, { pricing: {} }, { pricing: { breakdown: null } }]) {
    const p = readPricing(bad);
    assert.equal(typeof p.mode, "string");
    assert.ok(Array.isArray(p.perUnit) && Array.isArray(p.oncePerOrder));
  }
  assert.deepEqual(bearingComponents(undefined), []);
  assert.equal(formatMoney(null), "—");
});
// P2L 10
test("cross-app canonical RPC usage — OPPS reads full.pricing, writes via the shared RPC only", async () => {
  const section = await readSource("src/components/clients/CanonicalPriceComposition.jsx");
  assert.ok(section.includes('from "@/lib/xosPriceComposition"'));
  assert.ok(section.includes("readPricing(full)"));
  const container = await readSource("src/components/clients/ClientProductsSection.jsx");
  assert.ok(container.includes("<CanonicalPriceComposition"));
  assert.ok(/function PricingTab[\s\S]{0,400}setClientProductProductionComponents\(product\.id, components\)/.test(container), "PricingTab writes through the canonical RPC");
  assert.ok(container.includes('<TabsTrigger value="pricing">Pricing</TabsTrigger>'), "dedicated Pricing tab, not buried in Production");
});
// P2L 11
test("no local recomputation divergence — buildPricingSavePayload preserves ALL components + structural fields", () => {
  const payload = buildPricingSavePayload(composedFull, { p1: { default_sell_price: 70, price_label: "Front graphic" } });
  assert.equal(payload.length, 5);
  const p1 = payload.find((c) => c.id === "p1");
  assert.equal(p1.default_sell_price, 70);
  assert.equal(p1.price_label, "Front graphic");
  assert.equal(p1.production_method, "dtf");
  const m1 = payload.find((c) => c.id === "m1");
  assert.equal(m1.default_sell_price, 40, "non-bearing component price passes straight through, never nulled");
});
// P2L 12
test("no cost / supplier / margin field anywhere in the pricing UI", async () => {
  const section = await readSource("src/components/clients/CanonicalPriceComposition.jsx");
  assert.ok(!/(cost|margin|supplier|procurement|acquisition)/i.test(section.replace(/never cost/gi, "")), "no cost/margin/supplier text in the pricing section");
});

// Production editor must carry price fields through a structural save + guard base count
test("CanonicalProductionEditor structural save carries billing_mode / default_sell_price / price_label; blocks multi-base", async () => {
  const src = await readSource("src/components/clients/CanonicalProductionEditor.jsx");
  assert.ok(src.includes("_billing_mode: c?.billing_mode"));
  assert.ok(src.includes("_default_sell_price: c?.default_sell_price"));
  assert.ok(src.includes("r._default_sell_price != null ? { default_sell_price: r._default_sell_price }"));
  assert.ok(src.includes("baseConflict") && src.includes("disabled={!dirty || saving || baseConflict}"));
});

// The error mapper knows the new P1 error codes
test("mapXosCpError maps the new P1 errors", async () => {
  const src = await readSource("src/api/xosClientProduct.js");
  assert.ok(src.includes("XOS_CP_MULTIPLE_BASE_COMPONENTS"));
  assert.ok(src.includes("XOS_CP_SELL_PRICE_INVALID"));
});
