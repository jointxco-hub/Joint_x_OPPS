import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const SECTION_PATH = "src/components/clients/ClientProductsSection.jsx";
const XOS_API_PATH = "src/api/xosClientProduct.js";
const DATACLIENT_PATH = "src/api/dataClient.js";
const CLIENTS_PAGE_PATH = "src/pages/Clients.jsx";

// XOS Phase C - the OPPS Client Product workspace is a THIN CLIENT of the
// ONE canonical Client Product domain (X LAB migration 20260901150000).
//
//   - read      : get_client_product_full(client_product_id) — identity,
//                 details, variants, pricing, flags, thumbnail, mockup,
//                 source_order, production.components + summary,
//                 required_artwork_placements, artwork, artwork_readiness,
//                 product_readiness. Nothing recomposed OPPS-side.
//   - production : admin_set_client_product_production_components (the ONE
//                 structured writer; derives the flat summary + required
//                 placements + audit in the same txn).
//   - thumbnail  : admin_set_client_product_thumbnail_from_asset (shared,
//                 pointer-only). Mockup: admin_set_client_product_mockup_
//                 from_asset. Kept separate.
//   - artwork    : admin_link_client_product_artwork_from_asset. Shells
//                 render from required_artwork_placements only — never
//                 from a file-less artwork row, never a fake empty row.
//   - readiness  : product_readiness / artwork_readiness rendered as-is.
//                 The OPPS deriveReadinessState classification is retired
//                 from this surface.
//   - create     : admin_create_client_product_from_order ({ client_
//                 product_id, deduplicated, product }) for the "From an
//                 order" path; blank create keeps the RLS-gated ORM
//                 insert. Details / status keep the RLS-gated column
//                 update (pure client_products fields only).
//
// OUT OF SCOPE (reported): the order-drawer "+ Add print option" flow in
// ProductsEditor.jsx keeps its ProductComponent / OrderLineComponent
// Snapshot writes — it needs its own admin_add_order_line_print_option
// RPC in a later batch.

// ── Pure helpers (src/lib/clientProductReadiness.js, unchanged) ────
const { buildClientProductCreatePayload, SENSITIVE_CLIENT_PRODUCT_FIELDS, CLIENT_PRODUCT_STATUSES } =
  await import("../src/lib/clientProductReadiness.js");

test("buildClientProductCreatePayload: client_id + client_facing_name are the only required fields; internal_name trimmed/omitted", () => {
  const p = buildClientProductCreatePayload({ clientId: "c1", clientFacingName: "  Tee  " });
  assert.deepEqual(p, { client_id: "c1", client_facing_name: "Tee", internal_name: undefined, opps_product_id: undefined, inventory_item_id: undefined });
  assert.throws(() => buildClientProductCreatePayload({ clientId: "", clientFacingName: "x" }), /clientId is required/);
  assert.throws(() => buildClientProductCreatePayload({ clientId: "c1", clientFacingName: "   " }), /client-facing name is required/i);
});

test("the sensitive-field list is exactly client_price / visible_in_account / reorder_enabled", () => {
  assert.deepEqual([...SENSITIVE_CLIENT_PRODUCT_FIELDS].sort(), ["client_price", "reorder_enabled", "visible_in_account"]);
});

test("the status list is the audited lifecycle, no invented states", () => {
  assert.deepEqual(CLIENT_PRODUCT_STATUSES, [
    "draft", "ready_for_client_review", "client_changes_requested",
    "client_approved", "ready_to_order", "active", "archived",
  ]);
});

// ── Canonical RPC wrappers ───────────────────────────────────────
test("xosClientProduct wraps every canonical RPC with the exact name + param names, and no second readiness / summary calc", async () => {
  const api = await readSource(XOS_API_PATH);
  assert.match(api, /"get_client_product_full"[\s\S]{0,120}p_client_product_id/);
  assert.match(api, /"admin_set_client_product_production_components"[\s\S]{0,160}p_client_product_id[\s\S]{0,40}p_components/);
  assert.match(api, /"admin_set_client_product_thumbnail_from_asset"[\s\S]{0,160}p_client_product_id[\s\S]{0,60}p_client_asset_id/);
  assert.match(api, /"admin_set_client_product_mockup_from_asset"[\s\S]{0,160}p_client_asset_id/);
  assert.match(api, /"admin_link_client_product_artwork_from_asset"[\s\S]{0,240}p_placement[\s\S]{0,60}p_make_current/);
  assert.match(api, /"admin_preview_client_product_source_import"/);
  assert.match(api, /"admin_import_client_product_from_source"/);
  assert.match(api, /"admin_create_client_product_from_order"[\s\S]{0,200}p_order_id[\s\S]{0,40}p_line_id[\s\S]{0,40}p_overrides/);
  assert.match(api, /"admin_get_client_order_lines"/);
  assert.match(api, /"admin_list_client_assets"/);
  // no OPPS-side readiness / summary / required-placement derivation
  assert.doesNotMatch(api, /_compute_artwork_readiness|deriveReadinessState|print_locations\s*=/);
});

// ── dataClient serializer ────────────────────────────────────────
test("dataClient ClientProduct.serialize passes thumbnail_asset_id / thumbnail_url through (for the drawer's remove-thumbnail null path) and still omits required_artwork_placements", async () => {
  const src = await readSource(DATACLIENT_PATH);
  const block = src.slice(src.indexOf("ClientProduct: {"), src.indexOf("ClientProductArtwork: {"));
  for (const field of ["primary_mockup_asset_id", "thumbnail_asset_id", "thumbnail_url", "reorder_enabled", "internal_notes", "garment_material"]) {
    assert.ok(block.includes(field), `serializer must pass through ${field}`);
  }
  assert.ok(!/required_artwork_placements:/.test(block), "required_artwork_placements stays RPC-derived, never a direct serialized write");
});

// ── Section: client scope, canonical read, primary action ─────────
test("the product list is client-scoped by the query AND re-guarded client-side before render/open", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /ClientProduct\.filter\(\{ client_id: clientId \}/);
  assert.match(src, /\.filter\(\(p\) => p\.client_id === clientId\)/);
});

test("every Client Product detail view reads get_client_product_full and nothing recomposed - no direct product_components / client_product_artwork / readiness-RPC reads in the section", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /getClientProductFull\(product\.id\)/);
  assert.doesNotMatch(src, /\.entities\.ProductComponent\./);
  assert.doesNotMatch(src, /\.entities\.ClientProductArtwork\./);
  assert.doesNotMatch(src, /admin_get_client_product_artwork_readiness|getClientProductArtworkReadiness/);
  assert.doesNotMatch(src, /deriveReadinessState|READINESS_STATES/);
});

test("[Configure Client Product] opens a native drawer with Details / Production / Artwork / Status; Open in X LAB Admin is a demoted secondary <a>", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /function ConfigureClientProductDrawer/);
  for (const t of ["details", "production", "artwork", "status"]) {
    assert.match(src, new RegExp(`<TabsTrigger value="${t}">`));
  }
  assert.match(src, /Open in X LAB Admin/);
  assert.match(src, /XLAB_ADMIN_BASE/);
  assert.doesNotMatch(src, /Advanced · open in X LAB Admin/);
  assert.doesNotMatch(src, /window\.open\(`\$\{XLAB_ADMIN_BASE\}/);
});

test("readiness is rendered from product_readiness / artwork_readiness, never recomputed", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /function CanonicalReadinessPanel/);
  assert.match(src, /productReadiness\?\.checks/);
  assert.match(src, /full\?\.product_readiness/);
  assert.match(src, /full\?\.artwork_readiness/);
  assert.doesNotMatch(src, /\.every\([^)]*status === ['"]approved['"]/);
});

// ── Thumbnail vs mockup ─────────────────────────────────────────
test("thumbnail is set through the shared RPC (never a raw column write); mockup uses its own RPC; the two are separate controls", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /setClientProductThumbnailFromAsset\(product\.id, asset\.id\)/);
  assert.match(src, /setClientProductMockupFromAsset\(product\.id, asset\.id\)/);
  // the only raw client_products write touching thumbnail is the explicit "remove" (null pair)
  assert.match(src, /thumbnail_asset_id: null, thumbnail_url: null/);
  assert.doesNotMatch(src, /thumbnail_asset_id: asset\.id/);
  assert.doesNotMatch(src, /primary_mockup_asset_id: asset\.id/);
  // labelled distinctly
  assert.match(src, /The product&apos;s visual identity/);
  assert.match(src, /The client review \/ approval image/);
});

test("display fallback is thumbnail -> mockup -> nothing and is never persisted as the thumbnail", async () => {
  const api = await readSource(XOS_API_PATH);
  assert.match(api, /function resolveProductThumbRef/);
  assert.match(api, /full\?\.thumbnail\?\.url[\s\S]{0,200}full\?\.mockup\?\.url/);
  const src = await readSource(SECTION_PATH);
  assert.doesNotMatch(src, /thumbnail_url: mockup|persist.*mockup_fallback/i);
});

// ── Artwork shells from required_artwork_placements ──────────────
test("artwork shells render from full.required_artwork_placements only - never a file-less artwork row, never a fake empty row", async () => {
  const src = await readSource(SECTION_PATH);
  const tab = src.slice(src.indexOf("function ArtworkTab"), src.indexOf("// ─── Status tab"));
  assert.match(tab, /full\?\.required_artwork_placements/);
  assert.match(tab, /required\.map\(/);
  assert.doesNotMatch(tab, /RequiredPlacementsEditor|setClientProductRequiredArtworkPlacements/);
  assert.doesNotMatch(tab, /ClientProductArtwork\.(create|update|delete)/);
  // linking goes through the canonical RPC, make_current only when there is no current yet
  assert.match(tab, /linkClientProductArtworkFromAsset\(product\.id, asset\.id, slug, !hasCurrent\)/);
});

test("the artwork-impact conflict from the production writer is surfaced, never swallowed / retried / worked around", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /mapXosCpError\(error\?\.message\)/);
  const api = await readSource(XOS_API_PATH);
  assert.match(api, /CLIENT_PRODUCT_ARTWORK_PLACEMENT_CONFLICT/);
  assert.doesNotMatch(src, /catch[\s\S]{0,80}(retry|linkClientProductArtworkFromAsset)/);
});

// ── Create: from order (canonical) + blank (RLS-gated ORM) ───────
test("New Client Product supports 'From an order' via admin_create_client_product_from_order and handles the { deduplicated } return", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /createClientProductFromOrder\(orderId, lineId, \{\}\)/);
  assert.match(src, /data\?\.deduplicated/);
  assert.match(src, /Existing Client Product found for this order item/i);
  assert.match(src, /onCreated\(data\?\.client_product_id\)/);
  // no alternate raw insert path for order-based creation
  assert.doesNotMatch(src, /ClientProduct\.create\([^)]*created_from_order_id/);
});

test("blank create keeps the RLS-gated ORM insert (pure client_products columns) and lands in the drawer", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /buildClientProductCreatePayload\(\{ clientId, clientFacingName: name, internalName \}\)/);
  assert.match(src, /dataClient\.entities\.ClientProduct\.create\(payload\)/);
  assert.match(src, /onCreated\(created\?\.id\)/);
});

// ── Import missing information ───────────────────────────────────
test("Import missing information = preview -> diff -> confirm -> import -> refetch; never a silent apply", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /function ImportPreviewDialog/);
  assert.match(src, /previewClientProductSourceImport\(product\.id\)/);
  assert.match(src, /importClientProductFromSource\(product\.id\)/);
  assert.match(src, /preview\?\.diff/);
  // the button only shows when there is a source order to import from
  assert.match(src, /full\?\.source_order &&[\s\S]{0,400}Import missing information/);
});

// ── Details / status: pure columns only ─────────────────────────
test("Details save writes only pure client_products columns - never print_method / placement / print_locations / production_instructions, never a sensitive field", async () => {
  const src = await readSource(SECTION_PATH);
  const details = src.slice(src.indexOf("function DetailsTab"), src.indexOf("// ─── Production tab"));
  const payload = details.slice(details.indexOf("ClientProduct.update(product.id, {"), details.indexOf("})", details.indexOf("ClientProduct.update(product.id, {")));
  for (const derived of ["print_method:", "placement:", "print_locations:", "production_instructions:"]) {
    assert.ok(!payload.includes(derived), `Details payload must not write ${derived}`);
  }
  for (const sensitive of ["client_price:", "visible_in_account:", "reorder_enabled:"]) {
    assert.ok(!payload.includes(sensitive), `Details payload must not write ${sensitive}`);
  }
  assert.ok(payload.includes("garment_material:") && payload.includes("internal_notes:"));
});

test("every sensitive change is routed through an explicit confirm step, never a silent save; the DB ready-to-order guard is surfaced verbatim", async () => {
  const src = await readSource(SECTION_PATH);
  const statusTab = src.slice(src.indexOf("function StatusTab"), src.indexOf("function PriceField"));
  assert.match(statusTab, /requestChange\([\s\S]{0,40}\$\{e\.target\.checked \? "Show" : "Hide"\}/);
  assert.match(statusTab, /requestChange\([\s\S]{0,40}\$\{e\.target\.checked \? "Allow" : "Block"\}/);
  assert.match(statusTab, /requestChange\(`Set customer price/);
  assert.match(statusTab, /requestChange\(`Change status/);
  assert.match(statusTab, /pendingChange &&[\s\S]*Confirm change[\s\S]*applyMutation\.mutate\(pendingChange\.payload\)/);
  assert.match(statusTab, /toast\.error\(error\?\.message \|\| "Could not update"\)/);
  assert.doesNotMatch(statusTab, /required_artwork_placements\s*=/);
});

test("internal_notes is rendered only inside an explicit staff-only block", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /Internal only — never shown to the customer[\s\S]{0,220}value=\{form\.internal_notes\}/);
});

// ── Mount + scope guardrails ────────────────────────────────────
test("Clients.jsx mounts ClientProductsSection inside the client account dialog, client-scoped", async () => {
  const src = await readSource(CLIENTS_PAGE_PATH);
  assert.match(src, /import \{ ClientProductsSection \} from "@\/components\/clients\/ClientProductsSection"/);
  assert.match(src, /\{clientId && <ClientProductsSection clientId=\{clientId\} \/>\}/);
});

test("no new storage / tables / statuses introduced; no PayFast / checkout", async () => {
  const api = await readSource(XOS_API_PATH);
  const src = await readSource(SECTION_PATH);
  for (const s of [api, src]) {
    assert.doesNotMatch(s, /opps_client_products|create table|db push/i);
    assert.doesNotMatch(s, /payfast|checkout/i);
  }
});
