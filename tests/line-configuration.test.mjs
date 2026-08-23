import assert from "node:assert/strict";
import test from "node:test";
import {
  needsConfiguration,
  needsConfigurationBannerText,
  applyMatchExistingProduct,
  applyKeepCommercialOnly,
  resolveLineThumbnail,
  isProductionCapableLine,
} from "../src/features/orders/lineConfiguration.js";

const invoiceLine = (overrides = {}) => ({
  line_id: "line-1",
  name: "X1 - Satin Labels",
  price: 100,
  quantity: 2,
  added_from_invoice: true,
  catalog_item_id: "",
  inventory_item_id: "",
  image_url: "",
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────
// needsConfiguration
// ─────────────────────────────────────────────────────────────────────

test("needsConfiguration: true for a bare invoice-added line", () => {
  assert.equal(needsConfiguration(invoiceLine()), true);
});

test("needsConfiguration: false once catalog_item_id is set", () => {
  assert.equal(needsConfiguration(invoiceLine({ catalog_item_id: "cat-1" })), false);
});

test("needsConfiguration: false once client_product_id is set", () => {
  assert.equal(needsConfiguration(invoiceLine({ client_product_id: "cp-1" })), false);
});

// Regression for the drift bug this correction fixes: needsConfiguration
// previously only checked catalog_item_id/client_product_id/
// commercial_only_confirmed, so a line matched to a stock item via
// Configure Product (inventory_item_id set, catalog_item_id still "")
// kept showing "Added from invoice / Production setup required" forever.
test("needsConfiguration: false once inventory_item_id is set - a stock-matched line must not keep showing the banner", () => {
  assert.equal(needsConfiguration(invoiceLine({ inventory_item_id: "inv-1" })), false);
});

test("needsConfiguration: false once commercial_only_confirmed is set", () => {
  assert.equal(needsConfiguration(invoiceLine({ commercial_only_confirmed: true })), false);
});

// Generalization (this correction): eligibility no longer depends on
// added_from_invoice at all - a stock/legacy line, an X LAB-checkout
// line synced in via sync-to-opps, or a manually-typed custom line all
// have the exact same underlying gap (a line_id with no production
// identity) and must all be configurable, not just invoice-added ones.
// Confirmed live: sync-to-opps never sets any identity field for ANY
// line regardless of origin - this was never an invoice-specific
// problem, just first discovered there.
test("needsConfiguration: true for a non-invoice line with no identity - a manually-added or sync-to-opps custom line must also trigger the banner", () => {
  const manualLine = invoiceLine({ added_from_invoice: false, name: "Custom Manual Item" });
  assert.equal(needsConfiguration(manualLine), true);
});

test("needsConfiguration: true for a line with no added_from_invoice field at all (undefined, not false) - matches the real live shape from sync-to-opps", () => {
  // The real live shape (order XL-260810-5822, line b760fc31-...): no
  // added_from_invoice key at all, just name/size/color/price/line_id/
  // quantity/image_url. Confirming undefined behaves the same as false.
  const syncedLine = {
    name: "X1 Crochet Wide Leg Pant", size: "M", color: "", price: 10,
    line_id: "b760fc31-5f67-4bfd-8c05-7944dcf91b52", quantity: 1,
    image_url: "private-upload://uploads/6d371f51-274c-4b49-8d59-2aeaf5e89088/uploads/2026/08/19/x.png",
  };
  assert.equal(needsConfiguration(syncedLine), true, "a real sync-to-opps line with no identity must be configurable");
});

test("needsConfiguration: false for a non-invoice line once it has any production identity", () => {
  const manualLine = invoiceLine({ added_from_invoice: false, catalog_item_id: "cat-1" });
  assert.equal(needsConfiguration(manualLine), false);
});

test("needsConfigurationBannerText: invoice origin shows the provenance-labeled text", () => {
  assert.equal(needsConfigurationBannerText(invoiceLine()), "Added from invoice · Production setup required");
});

test("needsConfigurationBannerText: non-invoice origin (or no added_from_invoice field at all) shows the generic text", () => {
  assert.equal(needsConfigurationBannerText(invoiceLine({ added_from_invoice: false })), "Production setup required");
  assert.equal(needsConfigurationBannerText({ name: "X" }), "Production setup required");
});

test("needsConfiguration: added_from_invoice is never required to be cleared - it can stay true forever once configured", () => {
  const configured = applyMatchExistingProduct(invoiceLine(), { id: "cat-1", source: "catalog", image_url: "" });
  assert.equal(configured.added_from_invoice, true, "provenance must be preserved");
  assert.equal(needsConfiguration(configured), false, "banner must stop showing once catalog_item_id is set");
});

// ─────────────────────────────────────────────────────────────────────
// isProductionCapableLine - the single gate for Production/+ Add print
// option/artwork/thumbnail/related-file controls. Replaces the earlier
// `p.catalog_item_id && p.line_id` check, which incorrectly hid all of
// this from stock/inventory-sourced lines (never fabricated a
// catalog_item_id, so they had nowhere to attach) and from lines pointed
// directly at a standalone client_product with no catalog/inventory
// parent at all.
// ─────────────────────────────────────────────────────────────────────

test("isProductionCapableLine: true for a catalog-sourced line", () => {
  assert.equal(isProductionCapableLine({ line_id: "line-1", catalog_item_id: "cat-1" }), true);
});

test("isProductionCapableLine: true for a stock/inventory-sourced line - no fabricated catalog_item_id required", () => {
  const line = { line_id: "line-1", catalog_item_id: "", inventory_item_id: "inv-1" };
  assert.equal(isProductionCapableLine(line), true);
  assert.equal(line.catalog_item_id, "", "must never fabricate a catalog_item_id for a stock line");
});

test("isProductionCapableLine: true for a standalone client_product line (no catalog/inventory parent)", () => {
  const line = { line_id: "line-1", catalog_item_id: "", inventory_item_id: "", client_product_id: "cp-1" };
  assert.equal(isProductionCapableLine(line), true);
});

test("isProductionCapableLine: false with no identity at all, even with a line_id", () => {
  assert.equal(isProductionCapableLine({ line_id: "line-1", catalog_item_id: "", inventory_item_id: "" }), false);
});

test("isProductionCapableLine: false with no line_id, even with a catalog identity - snapshots/tracking/artwork are all keyed by line_id", () => {
  assert.equal(isProductionCapableLine({ line_id: "", catalog_item_id: "cat-1" }), false);
});

test("isProductionCapableLine: false for a commercial-only line with no identity - Keep commercial only stays the explicit opt-out, not a fourth identity type", () => {
  const line = { line_id: "line-1", catalog_item_id: "", inventory_item_id: "", commercial_only_confirmed: true };
  assert.equal(isProductionCapableLine(line), false);
});

// ─────────────────────────────────────────────────────────────────────
// applyMatchExistingProduct
// ─────────────────────────────────────────────────────────────────────

test("applyMatchExistingProduct: preserves line_id/price/quantity/added_from_invoice", () => {
  const product = invoiceLine({ line_id: "line-42", price: 250, quantity: 7 });
  const picked = { id: "cat-9", source: "catalog", name: "Hoodie", price: 999, image_url: "https://x/hoodie.jpg" };
  const result = applyMatchExistingProduct(product, picked);
  assert.equal(result.line_id, "line-42");
  assert.equal(result.price, 250, "price must never be touched by matching a catalog product");
  assert.equal(result.quantity, 7);
  assert.equal(result.added_from_invoice, true);
});

test("applyMatchExistingProduct: sets catalog_item_id for a catalog-sourced pick", () => {
  const result = applyMatchExistingProduct(invoiceLine(), { id: "cat-9", source: "catalog", image_url: "" });
  assert.equal(result.catalog_item_id, "cat-9");
  assert.equal(result.inventory_item_id, "");
});

test("applyMatchExistingProduct: sets inventory_item_id for a stock-sourced pick", () => {
  const result = applyMatchExistingProduct(invoiceLine(), { id: "inv-3", source: "stock", image_url: "" });
  assert.equal(result.inventory_item_id, "inv-3");
  assert.equal(result.catalog_item_id, "");
});

test("applyMatchExistingProduct: backfills empty image_url from the picked item", () => {
  const result = applyMatchExistingProduct(invoiceLine({ image_url: "" }), {
    id: "cat-9", source: "catalog", image_url: "https://x/hoodie.jpg",
  });
  assert.equal(result.image_url, "https://x/hoodie.jpg");
});

test("applyMatchExistingProduct: does NOT overwrite an existing non-empty image_url", () => {
  const result = applyMatchExistingProduct(invoiceLine({ image_url: "https://x/existing.jpg" }), {
    id: "cat-9", source: "catalog", image_url: "https://x/hoodie.jpg",
  });
  assert.equal(result.image_url, "https://x/existing.jpg");
});

test("applyMatchExistingProduct: preserves other existing fields untouched", () => {
  const product = invoiceLine({ notes: "rush order", selected_addons: [{ name: "gift wrap" }] });
  const result = applyMatchExistingProduct(product, { id: "cat-9", source: "catalog", image_url: "" });
  assert.equal(result.notes, "rush order");
  assert.deepEqual(result.selected_addons, [{ name: "gift wrap" }]);
});

// ─────────────────────────────────────────────────────────────────────
// applyKeepCommercialOnly
// ─────────────────────────────────────────────────────────────────────

test("applyKeepCommercialOnly: only adds the flag, changes nothing else", () => {
  const product = invoiceLine({ notes: "fee line", price: 55 });
  const result = applyKeepCommercialOnly(product);
  assert.equal(result.commercial_only_confirmed, true);
  assert.equal(result.notes, "fee line");
  assert.equal(result.price, 55);
  assert.equal(result.catalog_item_id, "");
  assert.equal(result.added_from_invoice, true);
});

// ─────────────────────────────────────────────────────────────────────
// resolveLineThumbnail
// ─────────────────────────────────────────────────────────────────────

test("resolveLineThumbnail: tier 1 - product.image_url wins over everything else", () => {
  const url = resolveLineThumbnail(
    { image_url: "https://x/product.jpg" },
    { clientProduct: { primary_mockup_url: "https://x/mockup.jpg" }, catalogItem: { image_url: "https://x/catalog.jpg" } }
  );
  assert.equal(url, "https://x/product.jpg");
});

test("resolveLineThumbnail: tier 2 - clientProduct.primary_mockup_url used when product.image_url is empty", () => {
  const url = resolveLineThumbnail(
    { image_url: "" },
    { clientProduct: { primary_mockup_url: "https://x/mockup.jpg" }, catalogItem: { image_url: "https://x/catalog.jpg" } }
  );
  assert.equal(url, "https://x/mockup.jpg");
});

test("resolveLineThumbnail: tier 3 - catalogItem.image_url used when product and clientProduct have none", () => {
  const url = resolveLineThumbnail(
    { image_url: "" },
    { clientProduct: null, catalogItem: { image_url: "https://x/catalog.jpg" } }
  );
  assert.equal(url, "https://x/catalog.jpg");
});

test("resolveLineThumbnail: tier 4 - empty string when nothing resolves (caller shows placeholder)", () => {
  const url = resolveLineThumbnail({ image_url: "" }, {});
  assert.equal(url, "");
});

test("resolveLineThumbnail: handles no options object passed at all", () => {
  const url = resolveLineThumbnail({ image_url: "" });
  assert.equal(url, "");
});
