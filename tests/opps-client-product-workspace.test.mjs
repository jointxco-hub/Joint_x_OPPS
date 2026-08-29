import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const SECTION_PATH = "src/components/clients/ClientProductsSection.jsx";
const API_PATH = "src/api/clientProducts.js";
const LIB_PATH = "src/lib/clientProductReadiness.js";
const DATACLIENT_PATH = "src/api/dataClient.js";
const CLIENTS_PAGE_PATH = "src/pages/Clients.jsx";

// Phase 1F-A - OPPS Client Product workspace. One shared record: reads and
// writes the SAME client_products / client_product_artwork rows X LAB
// uses, via existing RLS ("Staff manage client products" = is_opps_staff()
// + can_access_tenant) and existing RPCs. No new tables, no second
// artwork/readiness calculation, no new statuses.
//
// LIVE VERIFICATION (disposable BEGIN ... ROLLBACK against the linked
// project, real staff actor, nothing persisted - see the phase return):
//   - create: client_id + client_facing_name is enough; tenant_id filled
//     by the client_products_set_tenant_id trigger; visible_in_account
//     defaults false.
//   - update: extended serializer fields (internal_notes, garment_*,
//     instructions, primary_mockup_asset_id, reorder_enabled, ...) persist
//     through dataClient's RLS-gated UPDATE.
//   - thumbnail: primary_mockup_asset_id = asset.id AND primary_mockup_url
//     = asset.file_url (verbatim) - matches the 7/7 live rows audited.
//   - artwork: find_or_create_client_product_artwork_from_asset links an
//     existing client_assets row as the current revision for a placement;
//     an older revision is superseded (is_current=false), never deleted.
//   - readiness: admin_get_client_product_artwork_readiness returns
//     ready/required_placements/legacy_fallback/artwork/blocking_reasons;
//     NULL requirements -> legacy_fallback true; [] -> ready true; a
//     non-empty list -> ready only when every placement has a current
//     approved family (treatment_id NULL) revision.
//   - cross-client: linking an asset whose client_id != the product's
//     client_id is rejected by the RPC (ARTWORK_ASSET_CLIENT_MISMATCH).
//   - ready_to_order: the DB guard trigger blocks the status change while
//     required_artwork_placements is NULL and artwork rows exist - the UI
//     surfaces that error verbatim, never bypasses it.

// ── Pure helper: deriveReadinessState (classification of the RPC's own
//    output, NOT a recomputation) ──────────────────────────────────────
const { deriveReadinessState, buildClientProductCreatePayload, SENSITIVE_CLIENT_PRODUCT_FIELDS, CLIENT_PRODUCT_STATUSES } =
  await import("../src/lib/clientProductReadiness.js");

test("deriveReadinessState: legacy_fallback (NULL requirements) -> requirements_unconfirmed, whatever else the payload says", () => {
  assert.equal(deriveReadinessState({ legacy_fallback: true, ready: true, required_placements: ["Front"], artwork: [] }), "requirements_unconfirmed");
  assert.equal(deriveReadinessState({ legacy_fallback: true, ready: false, required_placements: [], artwork: [] }), "requirements_unconfirmed");
});

test("deriveReadinessState: explicit empty requirements -> no_artwork_required", () => {
  assert.equal(deriveReadinessState({ legacy_fallback: false, ready: true, required_placements: [], artwork: [] }), "no_artwork_required");
});

test("deriveReadinessState: non-empty requirements and RPC ready -> ready", () => {
  assert.equal(deriveReadinessState({ legacy_fallback: false, ready: true, required_placements: ["Front"], artwork: [{ placement: "Front", revision_id: "r1", status: "approved", is_current: true }] }), "ready");
});

test("deriveReadinessState: not ready, every required placement has an artwork row -> awaiting_approval", () => {
  const r = {
    legacy_fallback: false, ready: false, required_placements: ["Front", "Back"],
    artwork: [
      { placement: "Front", revision_id: "r1", status: "pending", is_current: true },
      { placement: "Back", revision_id: "r2", status: "approved", is_current: true },
    ],
  };
  assert.equal(deriveReadinessState(r), "awaiting_approval");
});

test("deriveReadinessState: not ready, a required placement has no artwork row -> missing_artwork", () => {
  const r = {
    legacy_fallback: false, ready: false, required_placements: ["Front", "Back"],
    artwork: [{ placement: "Front", revision_id: "r1", status: "approved", is_current: true }],
  };
  assert.equal(deriveReadinessState(r), "missing_artwork");
});

test("deriveReadinessState: null / non-object -> unknown", () => {
  assert.equal(deriveReadinessState(null), "unknown");
  assert.equal(deriveReadinessState(undefined), "unknown");
  assert.equal(deriveReadinessState("x"), "unknown");
});

// ── Pure helper: buildClientProductCreatePayload ────────────────────
test("buildClientProductCreatePayload: client_id + client_facing_name are the only required fields; internal_name trimmed/omitted", () => {
  const p = buildClientProductCreatePayload({ clientId: "c1", clientFacingName: "  Tee  " });
  assert.deepEqual(p, { client_id: "c1", client_facing_name: "Tee", internal_name: undefined, opps_product_id: undefined, inventory_item_id: undefined });
  assert.throws(() => buildClientProductCreatePayload({ clientId: "", clientFacingName: "x" }), /clientId is required/);
  assert.throws(() => buildClientProductCreatePayload({ clientId: "c1", clientFacingName: "   " }), /client-facing name is required/i);
  const p2 = buildClientProductCreatePayload({ clientId: "c1", clientFacingName: "Tee", internalName: "  INT  " });
  assert.equal(p2.internal_name, "INT");
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

// ── API wrappers: no second readiness calc, RPC names, empty-array rule ──
test("readiness comes ONLY from admin_get_client_product_artwork_readiness - no separate React calculation", async () => {
  const api = await readSource(API_PATH);
  assert.match(api, /supabase\.rpc\("admin_get_client_product_artwork_readiness"/);
  const lib = await readSource(LIB_PATH);
  // deriveReadinessState classifies the RPC payload; it must not query or
  // recompute readiness from client_product_artwork rows
  assert.doesNotMatch(lib, /is_current|status === ['"]approved['"]/);
  const section = await readSource(SECTION_PATH);
  assert.match(section, /import \{[\s\S]*deriveReadinessState[\s\S]*\} from "@\/api\/clientProducts"/);
  assert.doesNotMatch(section, /\.every\([^)]*status === ['"]approved['"]/);
});

test("required placements are set ONLY through admin_set_client_product_required_artwork_placements; an empty array is allowed, null is refused", async () => {
  const api = await readSource(API_PATH);
  assert.match(api, /supabase\.rpc\("admin_set_client_product_required_artwork_placements"/);
  assert.match(api, /if \(!Array\.isArray\(placements\)\)/);
  assert.match(api, /p_placements: placements/);
});

// ── Serializer extension ───────────────────────────────────────────
test("dataClient ClientProduct.serialize gains the workspace's operational fields and still omits required_artwork_placements", async () => {
  const src = await readSource(DATACLIENT_PATH);
  const block = src.slice(src.indexOf("ClientProduct: {"), src.indexOf("ClientProductArtwork: {"));
  for (const field of [
    "primary_mockup_asset_id", "reorder_enabled", "requires_quote", "internal_notes",
    "garment_material", "garment_gsm", "garment_color", "print_size", "print_locations",
    "production_instructions", "packaging_instructions", "special_instructions", "updated_by",
  ]) {
    assert.ok(block.includes(field), `serializer must pass through ${field}`);
  }
  assert.ok(!/required_artwork_placements:/.test(block), "required_artwork_placements stays RPC-only, never a direct serialized write");
});

// ── Section: client scope, create, mounting ────────────────────────
test("the product list is client-scoped by the query AND re-guarded client-side before render/open", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /ClientProduct\.filter\(\{ client_id: clientId \}/);
  assert.match(src, /\.filter\(\(p\) => p\.client_id === clientId\)/);
});

test("create uses buildClientProductCreatePayload then ClientProduct.create, and lands the user in the new workspace", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /buildClientProductCreatePayload\(\{ clientId, clientFacingName: name, internalName \}\)/);
  assert.match(src, /dataClient\.entities\.ClientProduct\.create\(payload\)/);
  assert.match(src, /onCreated\(created\)/);
  assert.match(src, /setOpenProductId\(created\.id\)/);
});

test("Clients.jsx mounts ClientProductsSection inside the client account dialog, client-scoped", async () => {
  const src = await readSource(CLIENTS_PAGE_PATH);
  assert.match(src, /import \{ ClientProductsSection \} from "@\/components\/clients\/ClientProductsSection"/);
  assert.match(src, /\{clientId && <ClientProductsSection clientId=\{clientId\} \/>\}/);
});

// ── Thumbnail contract ─────────────────────────────────────────────
test("thumbnail sets BOTH primary_mockup_asset_id = asset.id AND primary_mockup_url = asset.file_url (verbatim)", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /primary_mockup_asset_id: asset\.id,\s*\n\s*primary_mockup_url: asset\.file_url,/);
});

// ── Artwork by placement ───────────────────────────────────────────
test("artwork linking goes through find_or_create_client_product_artwork_from_asset with the placement and the product's tenant - never a direct client_product_artwork write", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /findOrCreateClientProductArtworkFromAsset\(\{\s*\n\s*tenantId: product\.tenant_id,\s*\n\s*clientProductId: product\.id,\s*\n\s*clientAssetId: asset\.id,\s*\n\s*placement,/);
  assert.doesNotMatch(src, /ClientProductArtwork\.(create|update|delete)\(/);
});

test("artwork history is preserved and shown, not overwritten - current revision is chosen from is_current, revision count surfaced", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /if \(row\.is_current && !currentByPlacement\.has\(row\.placement\)\)/);
  assert.match(src, /historyCountByPlacement/);
  assert.match(src, /if \(row\.treatment_id\) continue;/); // family scope only, matches the readiness RPC
});

test("the artwork picker reuses the shared ClientAssetPickerModal (existing files + Upload New) for both Mockups and Artwork", async () => {
  const src = await readSource(SECTION_PATH);
  const pickers = src.match(/<ClientAssetPickerModal/g) || [];
  assert.ok(pickers.length >= 2, "one picker for thumbnail (Mockups), one for artwork (Artwork)");
  assert.match(src, /uploadCategory="Mockups"/);
  assert.match(src, /uploadCategory="Artwork"/);
  assert.match(src, /selectionMode="single"/);
});

test("required-placements editor calls the RPC wrapper and states that an empty list = no artwork required", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /setClientProductRequiredArtworkPlacements\(\{\s*\n\s*clientProductId: product\.id,\s*\n\s*placements: Array\.from\(selected\),/);
  assert.match(src, /empty list means .quot;explicitly no artwork required/i);
});

// ── Status / sensitive-field safety ────────────────────────────────
test("Details save never includes a sensitive field - client_price / visible_in_account / reorder_enabled are not keys in the details payload", async () => {
  const src = await readSource(SECTION_PATH);
  const from = src.indexOf("const payload = {", src.indexOf("function DetailsTab"));
  const payloadBlock = src.slice(from, src.indexOf("};", from));
  assert.ok(!/\bclient_price:/.test(payloadBlock));
  assert.ok(!/\bvisible_in_account:/.test(payloadBlock));
  assert.ok(!/\breorder_enabled:/.test(payloadBlock));
  // and it does carry the non-sensitive operational fields
  assert.match(payloadBlock, /internal_notes:/);
  assert.match(payloadBlock, /production_instructions:/);
});

test("every sensitive change is routed through an explicit confirm step (requestChange -> pendingChange -> applyMutation), never a silent save", async () => {
  const src = await readSource(SECTION_PATH);
  const statusTab = src.slice(src.indexOf("function StatusTab"), src.indexOf("function PriceField"));
  assert.match(statusTab, /requestChange\(\s*"visible_in_account"/);
  assert.match(statusTab, /requestChange\(\s*"reorder_enabled"/);
  assert.match(statusTab, /requestChange\(\s*"client_price"/);
  assert.match(statusTab, /requestChange\(\s*"status"/);
  // apply only happens from inside the confirm modal
  assert.match(statusTab, /pendingChange &&[\s\S]*Confirm change[\s\S]*applyMutation\.mutate\(pendingChange\.payload\)/);
  assert.match(statusTab, /setPendingChange\(\{ kind, label, payload \}\)/);
});

test("the DB ready-to-order artwork guard is surfaced verbatim and never bypassed - the UI only sends a status change and shows the resulting error", async () => {
  const src = await readSource(SECTION_PATH);
  const statusTab = src.slice(src.indexOf("function StatusTab"), src.indexOf("function PriceField"));
  assert.match(statusTab, /toast\.error\(error\?\.message \|\| "Could not update"\)/);
  assert.match(statusTab, /blocked by the database until required artwork placements are confirmed/i);
  assert.doesNotMatch(statusTab, /required_artwork_placements/); // no client-side reimplementation of the guard
});

test("internal_notes is rendered only inside an explicit staff-only block", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /Internal only — never shown to the customer[\s\S]{0,200}value=\{form\.internal_notes\}/);
});

// ── Open in X LAB Admin - advanced fallback only ───────────────────
test("Open in X LAB Admin is kept but demoted to a small advanced link, not a primary action", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /Advanced · open in X LAB Admin/);
  assert.match(src, /XLAB_ADMIN_BASE/);
  assert.doesNotMatch(src, /window\.open\(`\$\{XLAB_ADMIN_BASE\}/); // it's an <a>, not a forced popup
});

// ── Scope guardrails ──────────────────────────────────────────────
test("no new storage / tables / statuses / second readiness calc introduced", async () => {
  const api = await readSource(API_PATH);
  const src = await readSource(SECTION_PATH);
  for (const s of [api, src]) {
    assert.doesNotMatch(s, /opps_client_products|create table|db push/i);
    assert.doesNotMatch(s, /payfast|checkout/i);
  }
});
