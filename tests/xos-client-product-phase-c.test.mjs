import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// XOS Phase C — OPPS and X LAB are two interfaces over ONE client_product_id.
// This suite encodes the phase's definition of done and the ONE deliberate
// boundary that is out of scope (the order-drawer "+ Add print option"
// flow, which needs its own server RPC).

const SECTION = "src/components/clients/ClientProductsSection.jsx";
const EDITOR = "src/components/clients/CanonicalProductionEditor.jsx";
const XOS_API = "src/api/xosClientProduct.js";
const CATALOG = "src/pages/CatalogManagement.jsx";
const PRODUCTS_EDITOR = "src/components/orders/drawer/ProductsEditor.jsx";

test("the canonical projection is the single read for every Client Product surface (drawer, cards, Catalog Management)", async () => {
  const section = await readSource(SECTION);
  const catalog = await readSource(CATALOG);
  assert.match(section, /getClientProductFull\(product\.id\)/);        // drawer
  assert.match(section, /queryKey: \["xosClientProductFull", product\.id\][\s\S]{0,120}getClientProductFull/); // card
  assert.match(catalog, /getClientProductFull\(selectedClientProductId\)/); // catalog
});

test("production is written ONLY through admin_set_client_product_production_components — no raw product_components writer anywhere on the Client Product surface", async () => {
  for (const p of [SECTION, EDITOR, CATALOG]) {
    const src = await readSource(p);
    assert.doesNotMatch(src, /\.entities\.ProductComponent\.(create|update|delete)\(/, `${p} must not write product_components directly`);
    assert.doesNotMatch(src, /\.entities\.(GarmentVariant|Treatment|VariantTreatmentMapping)\.(create|update|delete)\(/, `${p} must not write the variant/treatment tables`);
  }
  const section = await readSource(SECTION);
  const catalog = await readSource(CATALOG);
  assert.match(section, /setClientProductProductionComponents\(product\.id, components\)/);
  assert.match(catalog, /setClientProductProductionComponents\(selectedClientProductId, components\)/);
});

test("thumbnail + mockup are ONLY written through their shared RPCs (pointer-only); the retired composition editors are unmounted everywhere", async () => {
  for (const p of [SECTION, CATALOG]) {
    const src = await readSource(p);
    assert.doesNotMatch(src, /ScopedComponentsEditor|GarmentVariantsSection|TreatmentsSection/, `${p} must not mount the retired editors`);
  }
  const section = await readSource(SECTION);
  assert.match(section, /setClientProductThumbnailFromAsset\(/);
  assert.match(section, /setClientProductMockupFromAsset\(/);
});

test("no fabrication: the workspace never invents GSM / price / material and never writes client_price on create", async () => {
  const section = await readSource(SECTION);
  assert.doesNotMatch(section, /garment_gsm:\s*['"][0-9]/);          // no hardcoded gsm
  assert.doesNotMatch(section, /client_price:\s*[0-9]/);              // never a fabricated price
  const api = await readSource(XOS_API);
  assert.doesNotMatch(api, /parseInt\([^)]*gsm|Number\([^)]*gsm/i);   // no gsm parsing heuristic
});

test("source order is shown as plain text, not a fragile in-app route", async () => {
  const section = await readSource(SECTION);
  assert.match(section, /Created from \{full\.source_order\.order_number\}/);
  assert.doesNotMatch(section, /navigate\(`?\/orders/);
});

test("BOUNDARY (reported, out of scope): the order-drawer '+ Add print option' flow still owns its ProductComponent / OrderLineComponentSnapshot writes — untouched this phase", async () => {
  const src = await readSource(PRODUCTS_EDITOR);
  // still present — this is the deliberate carve-out, tracked for a later
  // admin_add_order_line_print_option RPC. If this ever changes, Phase C's
  // scope decision needs revisiting.
  assert.match(src, /const addPrintOptionMutation = useMutation\(/);
  assert.match(src, /dataClient\.entities\.ProductComponent\.create\(/);
  assert.match(src, /dataClient\.entities\.OrderLineComponentSnapshot\.create\(/);
});

test("the canonical readiness result is identical shape to X LAB's — six checks, missing_count, ready", async () => {
  const api = await readSource(XOS_API);
  assert.match(api, /PRODUCT_READINESS_ROWS/);
  for (const row of ["product_name", "thumbnail", "client_price", "production", "artwork", "reorder_enabled"]) {
    assert.ok(api.includes(`"${row}"`), `readiness row ${row}`);
  }
  const section = await readSource(SECTION);
  assert.match(section, /missing_count/);
  assert.match(section, /productReadiness\.ready/);
});
