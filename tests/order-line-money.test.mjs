import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOrderLineMoney } from "../src/lib/orderLineMoney.js";
import { itemFromProduct, invoiceFromOrder } from "../src/features/invoices/orderToInvoiceItems.js";

const nativeOrder = { id: "o-native", source: "opps" };
const legacyXlabOrder = { id: "o-legacy", source: "xlab", storefront_host: null };
const commerceOrder = { id: "o-commerce", source: "xlab", storefront_host: "gsb-commerce-qa.jointx.co.za" };

// 1. native OPPS {price:100, quantity:2} -> unit R100 / line R200
test("native OPPS line: price is unit price", () => {
  const result = normalizeOrderLineMoney({ price: 100, quantity: 2 }, nativeOrder);
  assert.equal(result.trusted, true);
  assert.equal(result.basis, "native_unit_price");
  assert.equal(result.unitPrice, 100);
  assert.equal(result.lineTotal, 200);
});

// 2. Commerce {unit_price:550, line_total:1100, quantity:2} -> R550 / R1100
test("Commerce storefront line: unit_price/line_total trusted as-is", () => {
  const result = normalizeOrderLineMoney({ unit_price: 550, line_total: 1100, quantity: 2 }, commerceOrder);
  assert.equal(result.trusted, true);
  assert.equal(result.basis, "explicit");
  assert.equal(result.unitPrice, 550);
  assert.equal(result.lineTotal, 1100);
});

// 3. legacy X LAB {price:458, quantity:2} with positively identified legacy source -> unit R229 / line R458
test("legacy X LAB line: price is the line total, divided by quantity for unit price", () => {
  const result = normalizeOrderLineMoney({ price: 458, quantity: 2 }, legacyXlabOrder);
  assert.equal(result.trusted, true);
  assert.equal(result.basis, "legacy_xlab_total");
  assert.equal(result.unitPrice, 229);
  assert.equal(result.lineTotal, 458);
});

// 4. legacy quantity 1 remains unchanged numerically
test("legacy X LAB line at quantity 1: unit price equals line total (no behavior change)", () => {
  const result = normalizeOrderLineMoney({ price: 458, quantity: 1 }, legacyXlabOrder);
  assert.equal(result.trusted, true);
  assert.equal(result.unitPrice, 458);
  assert.equal(result.lineTotal, 458);
});

// 5. missing/ambiguous money fields -> untrusted (Apply total must be disabled)
test("line with no price/unit_price/line_total at all is ambiguous, never treated as free", () => {
  const result = normalizeOrderLineMoney({ quantity: 3 }, nativeOrder);
  assert.equal(result.trusted, false);
  assert.equal(result.basis, "ambiguous");
  assert.equal(result.unitPrice, null);
  assert.equal(result.lineTotal, null);
});

test("legacy X LAB line with price but no resolvable quantity is untrusted, not guessed", () => {
  const result = normalizeOrderLineMoney({ price: 458, quantity: 0 }, legacyXlabOrder);
  assert.equal(result.trusted, false);
  assert.equal(result.basis, "legacy_xlab_total_unresolved_quantity");
  assert.equal(result.unitPrice, null);
});

// AUDIT FOLLOW-UP — a line carrying a (even empty-string) OPPS form key
// has been through the add/edit form at least once, so we can no longer
// be sure `price` is the original bridge total. Blocked (untrusted), not
// guessed as either convention.
test("a line with any OPPS form-authored key on a legacy X LAB order is untrusted, never guessed either way", () => {
  const result = normalizeOrderLineMoney({ price: 90, quantity: 3, catalog_item_id: "cat-1" }, legacyXlabOrder);
  assert.equal(result.trusted, false);
  assert.equal(result.basis, "legacy_xlab_ambiguous_shape");
  assert.equal(result.unitPrice, null);
  assert.equal(result.lineTotal, null);
});

// THE CONFIRMED EDGE CASE — traced directly against ProductsEditor's
// addRow(): a staff member adding a fully custom (non-catalog) line to an
// EXISTING legacy X LAB order produces exactly this shape (every key from
// `emptyRow`, present even when unused). It must never be silently divided
// as if it were a bridge line total - the staff member typed R90 meaning
// R90 per unit, quantity 3, total R270, not R30/unit.
test("ProductsEditor addRow() shape on a legacy X LAB order is untrusted, not divided", () => {
  const addRowShapedLine = {
    name: "Rush fee", quantity: 3, price: 90, size: "", color: "", notes: "",
    catalog_item_id: "", inventory_item_id: "", client_product_id: "",
    image_url: "", category: "", source: "", selected_print_options: [], selected_addons: [],
    line_id: "line-abc123",
  };
  const result = normalizeOrderLineMoney(addRowShapedLine, legacyXlabOrder);
  assert.equal(result.trusted, false);
  assert.equal(result.basis, "legacy_xlab_ambiguous_shape");
  assert.equal(result.unitPrice, null);
  assert.equal(result.lineTotal, null);
});

// The real production bridge shape (confirmed against live X LAB orders:
// exactly these 7 keys, nothing else) is unaffected by the above - it
// carries none of the form-authored keys, so it still resolves correctly.
test("the real X LAB bridge line shape (no form-authored keys) still resolves as a legacy total", () => {
  const realBridgeLine = { color: "Sky Blue", image_url: null, line_id: "l1", name: "JV1 Tee", price: 458, quantity: 2, size: "M" };
  const result = normalizeOrderLineMoney(realBridgeLine, legacyXlabOrder);
  assert.equal(result.trusted, true);
  assert.equal(result.basis, "legacy_xlab_total");
  assert.equal(result.unitPrice, 229);
  assert.equal(result.lineTotal, 458);
});

// A bare `price` field on a Commerce-tenant xlab order (source=xlab, but
// WITH a storefront_host) is never divided - only the legacy, no-host
// variant is.
test("bare price on a Commerce-tenant xlab order (has storefront_host) is treated as unit price, not divided", () => {
  const result = normalizeOrderLineMoney({ price: 90, quantity: 3 }, commerceOrder);
  assert.equal(result.trusted, true);
  assert.equal(result.basis, "native_unit_price");
  assert.equal(result.unitPrice, 90);
});

// 6. mixed order with several lines totals correctly: a genuine untouched
// bridge line (no form keys - resolved as a legacy total) alongside a
// staff-added custom line (has form keys - untrusted, excluded from the
// trusted subtotal rather than guessed).
test("mixed order: bridge line and staff-added line in the same order each resolve independently", () => {
  const lines = [
    { color: "", image_url: null, line_id: "l1", name: "JV1 Tee", price: 100, quantity: 2, size: "M" }, // untouched bridge line
    {
      name: "Rush fee", quantity: 2, price: 458, size: "", color: "", notes: "",
      catalog_item_id: "", inventory_item_id: "", client_product_id: "",
      image_url: "", category: "", source: "", selected_print_options: [], selected_addons: [],
      line_id: "line-added",
    }, // staff-added via addRow()
  ];
  const results = lines.map((line) => normalizeOrderLineMoney(line, legacyXlabOrder));
  assert.equal(results[0].basis, "legacy_xlab_total");
  assert.equal(results[0].unitPrice, 50);
  assert.equal(results[0].lineTotal, 100);
  assert.equal(results[1].trusted, false);
  assert.equal(results[1].basis, "legacy_xlab_ambiguous_shape");
  const total = results.reduce((sum, r) => sum + (r.trusted ? r.lineTotal : 0), 0);
  assert.equal(total, 100);
});

// AUDIT FOLLOW-UP — invoice conversion must never silently invoice an
// untrusted line at a guessed rate; it must be visibly flagged instead.
test("itemFromProduct: an untrusted (ambiguous-shape) legacy line is flagged, not silently rated", () => {
  const addRowShapedLine = {
    name: "Rush fee", quantity: 2, price: 90, size: "", color: "", notes: "",
    catalog_item_id: "", inventory_item_id: "", client_product_id: "",
    image_url: "", category: "", source: "", selected_print_options: [], selected_addons: [],
    line_id: "line-xyz",
  };
  const item = itemFromProduct(addRowShapedLine, 0, legacyXlabOrder);
  assert.equal(item.rate, 0);
  assert.match(item.item_description, /Needs price review/);
  assert.equal(item.source_metadata.needs_price_review, true);
});

test("itemFromProduct: a trusted line is never flagged for review", () => {
  const item = itemFromProduct({ price: 100, quantity: 2, name: "Custom item" }, 0, nativeOrder);
  assert.doesNotMatch(item.item_description, /Needs price review/);
  assert.equal(item.source_metadata.needs_price_review, false);
});

// 7. invoice conversion uses the normalized unit rate for a legacy X LAB line
test("itemFromProduct: legacy X LAB line produces unit rate R229, not R458", () => {
  const item = itemFromProduct({ price: 458, quantity: 2, name: "JV1 Tee" }, 0, legacyXlabOrder);
  assert.equal(item.quantity, 2);
  assert.equal(item.rate, 229);
});

test("invoiceFromOrder: legacy X LAB order produces a correct per-line rate and item count", () => {
  const order = { ...legacyXlabOrder, products: [{ price: 458, quantity: 2, name: "JV1 Tee" }], client_name: "Test Client" };
  const invoice = invoiceFromOrder(order);
  assert.equal(invoice.items.length, 1);
  assert.equal(invoice.items[0].rate, 229);
  assert.equal(invoice.items[0].quantity, 2);
});

// Commerce example must remain exactly unit_price x quantity.
test("itemFromProduct: Commerce line produces unit rate R550 unchanged", () => {
  const item = itemFromProduct({ unit_price: 550, line_total: 1100, quantity: 2, name: "GSB Tee" }, 0, commerceOrder);
  assert.equal(item.rate, 550);
  assert.equal(item.quantity, 2);
});

// 8. native OPPS invoice conversion remains unchanged
test("itemFromProduct: native OPPS line behaves exactly as before (price = unit rate)", () => {
  const item = itemFromProduct({ price: 100, quantity: 2, name: "Custom item" }, 0, nativeOrder);
  assert.equal(item.rate, 100);
  assert.equal(item.quantity, 2);
});

// 9. shipping/discount/tax behavior is untouched by this change
test("invoiceFromOrder: shipping/discount fields are unaffected by line-money normalization", () => {
  const order = {
    ...nativeOrder,
    products: [{ price: 100, quantity: 2, name: "Custom item" }],
    apply_shipping_fee: true,
    shipping_fee: 50,
    client_name: "Test Client",
  };
  const invoice = invoiceFromOrder(order);
  assert.equal(invoice.shipping_charge, 50);
  assert.equal(invoice.adjustment, 0);
  assert.equal(invoice.items[0].discount, 0);
  assert.equal(invoice.items[0].tax_percentage, 0);
});
