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

test("addPrintOptionMutation still exists and resolves via the shared helper (catalog, stock, or standalone), not a catalog-only lookup", async () => {
  // The create-or-reuse logic was extracted into
  // resolveOrCreateClientProductForLine (shared with Review for My
  // Products, Phase 5) - addPrintOptionMutation now just calls it.
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("const addPrintOptionMutation = useMutation("), "addPrintOptionMutation must still be the same function");

  const mutationStart = source.indexOf("const addPrintOptionMutation = useMutation(");
  const mutationBody = source.slice(mutationStart, mutationStart + 400);
  assert.ok(
    mutationBody.includes("resolveOrCreateClientProductForLine(orderLine)"),
    "must resolve via the shared helper, not reimplement the lookup inline"
  );

  const helperStart = source.indexOf("const resolveOrCreateClientProductForLine = async (orderLine) => {");
  assert.notEqual(helperStart, -1, "the shared resolve-or-create helper must exist");
  const helperBody = source.slice(helperStart, helperStart + 1600);
  assert.ok(
    helperBody.includes("let clientProduct = clientProductForLine(orderLine);"),
    "must resolve via the shared clientProductForLine (catalog -> stock -> standalone), not clientProductByCatalogItemId directly"
  );
  assert.ok(
    helperBody.includes("orderLine.inventory_item_id") && helperBody.includes("inventory_item_id: orderLine.inventory_item_id"),
    "must be able to on-demand-create a client_product from a stock line's inventory_item_id, preserving that identity"
  );
  assert.ok(
    !/opps_product_id:\s*orderLine\.inventory_item_id/.test(helperBody),
    "must never write an inventory item's id into opps_product_id - that column references products, not inventory"
  );
});

test("Review for My Products reuses the exact same resolve-or-create helper as + Add print option", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const reviewForMyProductsMutation = useMutation(");
  assert.notEqual(start, -1, "reviewForMyProductsMutation must exist");
  const body = source.slice(start, start + 500);
  assert.ok(body.includes("resolveOrCreateClientProductForLine(orderLine)"), "must reuse the shared helper, not a second identity model");
  assert.ok(!/opps_product_id:\s*clientProduct/.test(body), "must never mutate the resolved client_product's own identity fields");
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

// Runtime safety: isProductionCapableLine(p) can be true (stock/inventory
// or standalone client_product identity present) before any
// client_products row has actually been created for that identity yet -
// e.g. a stock-matched line before staff ever clicks "+ Add print
// option". clientProductForLine(p) resolves to null in that window, and
// LineProduction is rendered with clientProduct: null. This guards the
// one raw `.id` dereference against that null and confirms beginAttach
// itself refuses to run with no clientProductId, rather than relying
// only on the render-conditional button that currently makes it
// unreachable in practice.
test("beginAttach never dereferences a null client product's .id, and guards itself independently of the caller", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(
    source.includes("beginAttach(p.line_id, clientProductForLine(p)?.id, p)"),
    "the call site must use optional chaining, not a raw .id dereference"
  );
  const fnStart = source.indexOf("const beginAttach = async (lineId, clientProductId, orderLine) => {");
  assert.notEqual(fnStart, -1);
  const fnBody = source.slice(fnStart, fnStart + 700);
  assert.ok(
    /if\s*\(\s*!clientProductId\s*\)\s*\{/.test(fnBody),
    "beginAttach must guard against a missing clientProductId on its own terms, not just via the caller's render structure"
  );
});

test("dataClient's ClientProduct.create serializer includes inventory_item_id - otherwise it would be silently dropped on write", async () => {
  const source = await readSource("src/api/dataClient.js");
  const start = source.indexOf("ClientProduct: {");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 1200);
  assert.ok(body.includes("inventory_item_id: payload.inventory_item_id"), "the serialize() allowlist must pass inventory_item_id through");
});

// ─────────────────────────────────────────────────────────────────────
// Private-upload thumbnail fix (Phase 4): order-line thumbnails must
// resolve private-upload://... references to a short-lived signed URL
// at render time, reusing the existing src/lib/privateFiles.js /
// SecureImage.jsx resolver already used in 13 other OPPS files - never
// a new resolver, never a raw <img src="private-upload://..."> (which
// renders as a broken image, exactly the live bug reported on order
// XL-260810-5822 / line b760fc31-...).
// ─────────────────────────────────────────────────────────────────────

test("order-line thumbnails render through SecureImage, not a raw <img>, and the old raw-img ternary is gone", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(
    source.includes('import SecureImage from "@/components/common/SecureImage";'),
    "must reuse the existing SecureImage component, not build a new resolver"
  );
  assert.ok(
    !source.includes('{resolvedThumb ? <img src={resolvedThumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Package className="m-3 h-6 w-6 text-muted-foreground/50" />}'),
    "the old raw <img> ternary for the order-line thumbnail must be gone - it could never resolve a private-upload:// reference"
  );
  const secureImageUsageIndex = source.indexOf("<SecureImage");
  assert.notEqual(secureImageUsageIndex, -1);
  const usageBlock = source.slice(secureImageUsageIndex, secureImageUsageIndex + 250);
  assert.ok(usageBlock.includes("value={resolvedThumb}"), "must resolve the same precedence-computed thumbnail value SecureImage is handed");
  // Package fallback moved to a sibling non-clickable branch (Phase 5-12
  // quick-preview wiring: only a real, resolvable image is clickable) -
  // still present, just no longer passed as SecureImage's own fallback prop.
  assert.ok(source.includes("<Package className=\"m-3 h-6 w-6 text-muted-foreground/50\" />"), "must keep the existing generic-placeholder icon for lines with no thumbnail at all");
});

test("Set/Change thumbnail persists the durable raw reference (asset.file_url), never a resolved signed URL", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const applyThumbnail = (pickedAssets) => {");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 400);
  assert.ok(body.includes("image_url: asset.file_url"), "must store the asset's raw file_url (durable reference - private-upload://... or a normal URL), not a signed URL");
  assert.ok(!/getSignedFileUrl|useSignedFileUrl|signedUrl/i.test(body), "must never resolve/persist a signed URL into orders.products - signing happens only at render time via SecureImage");
});

// ─────────────────────────────────────────────────────────────────────
// Review for My Products (Phase 5)
// ─────────────────────────────────────────────────────────────────────

test("reviewForMyProductsMutation persists client_product_id onto the line without touching price/quantity, and never sets status/visible_in_account", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const reviewForMyProductsMutation = useMutation({");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 900);
  assert.ok(body.includes("client_product_id: clientProduct.id"), "must persist client_product_id onto the order line");
  assert.ok(!/\bprice\s*:|\bquantity\s*:/.test(body), "must never write price/quantity as part of this action");
  assert.ok(!/\bstatus\s*:|\bvisible_in_account\s*:/.test(body), "must never set status/visible_in_account - the client_product stays on its draft/hidden column defaults, this action never publishes");
  assert.ok(body.includes("if (!orderLine.client_product_id)"), "must not overwrite an already-set client_product_id on repeat use - reuse, not reassign");
});

test("reviewForMyProductsMutation deep-links to the existing X LAB Admin client-products page - does not build a second review/publish UI in OPPS", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const reviewForMyProductsMutation = useMutation({");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 1200);
  assert.ok(body.includes("https://xlab.jointx.co.za/admin/client-products/"), "must deep-link to the authoritative X LAB Admin review/publish surface");
  assert.ok(
    !/import\s+\w+\s+from\s+["'].*AdminClientProductDetail|<ReadinessChecklist|<PublishForClientReview/.test(source),
    "must not import or render any part of the X LAB Admin review UI inside OPPS - a comment referencing it by name for context is fine, an actual import/usage is not"
  );
});
