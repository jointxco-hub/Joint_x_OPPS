import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildOrderPrimaryImageGallery,
  getSelectablePrimaryCandidates,
  groupPrimaryImageContextByOrder,
  isSelectablePrimaryCandidate,
  resolveOrderPrimaryImage,
  resolveUnlinkPrimaryImagePatch,
  validateExplicitPrimary,
} from "../src/lib/orderPrimaryImage.js";

// src/lib/orderPrimaryImage.js is pure/React-free/Supabase-free (see its
// header comment), so it is exercised directly here (behavioral).
// OrderFilesTab.jsx pulls in React hooks and react-query, which this
// repo's plain `node --test` runner cannot execute without a bundler/DOM
// (same constraint noted throughout tests/file-gallery.test.mjs) - its
// atomic-unlink / copy-alias / category-move behavior is pinned with
// source-structure assertions at the bottom of this file instead, as this
// repo's existing suites already do for React components with the same
// constraint.

const CLIENT_ID = "client-1";
const TENANT_ID = "tenant-1";

function makeOrder(overrides = {}) {
  return {
    id: "order-1",
    client_id: CLIENT_ID,
    tenant_id: TENANT_ID,
    primary_image_asset_id: null,
    file_urls: [],
    mockup_urls: [],
    portal_visible_file_urls: [],
    account_visible_file_urls: [],
    products: [],
    ...overrides,
  };
}

function makeRow(overrides = {}) {
  return {
    order_id: "order-1",
    asset_id: "asset-1",
    file_url: "private-upload://uploads/x/photo.jpg",
    file_type: "image/jpeg",
    folder_id: "folder-1",
    folder_name: "Mockups",
    folder_kind: null,
    asset_client_id: CLIENT_ID,
    asset_tenant_id: TENANT_ID,
    ...overrides,
  };
}

// ─────────────────────── explicit primary resolution ───────────────────────

test("valid explicit ClientAsset primary wins", () => {
  const order = makeOrder({ primary_image_asset_id: "asset-1" });
  const rows = [makeRow({ asset_id: "asset-1", file_url: "private-upload://a.jpg" })];
  const result = resolveOrderPrimaryImage(order, rows);
  assert.equal(result.ref, "private-upload://a.jpg");
  assert.equal(result.assetId, "asset-1");
  assert.equal(result.source, "explicit");
});

test("wrong client rejected", () => {
  const order = makeOrder({ primary_image_asset_id: "asset-1", file_urls: ["private-upload://fallback.jpg"] });
  const rows = [makeRow({ asset_id: "asset-1", asset_client_id: "someone-else", file_url: "private-upload://a.jpg" })];
  const result = resolveOrderPrimaryImage(order, rows);
  assert.notEqual(result.source, "explicit");
  assert.equal(isSelectablePrimaryCandidate(order, rows[0]), false);
  assert.equal(validateExplicitPrimary(order, rows, "asset-1"), false);
});

test("wrong tenant rejected", () => {
  const order = makeOrder({ primary_image_asset_id: "asset-1" });
  const rows = [makeRow({ asset_id: "asset-1", asset_tenant_id: "someone-else-tenant", file_url: "private-upload://a.jpg" })];
  const result = resolveOrderPrimaryImage(order, rows);
  assert.notEqual(result.source, "explicit");
  assert.equal(isSelectablePrimaryCandidate(order, rows[0]), false);
});

test("URL no longer linked to the order is rejected (no matching context row)", () => {
  // If a file is unlinked from the order, the RPC simply stops returning a
  // context row for it - there is nothing left to explicitly select.
  const order = makeOrder({ primary_image_asset_id: "asset-1", file_urls: ["private-upload://fallback.jpg"] });
  const rows = []; // asset-1 no longer appears in context at all
  const result = resolveOrderPrimaryImage(order, rows);
  assert.notEqual(result.source, "explicit");
  assert.equal(result.ref, "private-upload://fallback.jpg");
  assert.equal(result.source, "order-file");
});

test("archived asset is rejected (server excludes it from context, so it never resolves as explicit)", () => {
  // The RPC filters is_archived = false server-side, so an archived asset
  // never appears as a context row - functionally identical at this layer
  // to "no longer linked": the explicit branch has nothing to select.
  const order = makeOrder({ primary_image_asset_id: "asset-archived" });
  const rows = [makeRow({ asset_id: "asset-live", file_url: "private-upload://live.jpg" })];
  const result = resolveOrderPrimaryImage(order, rows);
  assert.notEqual(result.assetId, "asset-archived");
});

test("non-image asset is rejected", () => {
  const order = makeOrder({ primary_image_asset_id: "asset-1", file_urls: ["private-upload://fallback.jpg"] });
  const rows = [makeRow({ asset_id: "asset-1", file_url: "private-upload://doc.pdf" })];
  const result = resolveOrderPrimaryImage(order, rows);
  assert.notEqual(result.source, "explicit");
  assert.equal(result.ref, "private-upload://fallback.jpg");
});

test("a differing/absent client_assets.order_id (origin order) never affects validity", () => {
  // Context rows never even carry an "origin order" field - only order_id
  // (the order currently being resolved, via the RPC's grouping), asset_id,
  // and the ownership/linkage fields. A row missing any origin-order
  // concept entirely still resolves normally.
  const order = makeOrder({ primary_image_asset_id: "asset-1" });
  const row = makeRow({ asset_id: "asset-1", file_url: "private-upload://a.jpg" });
  delete row.order_id;
  const result = resolveOrderPrimaryImage(order, [row]);
  assert.equal(result.source, "explicit");
  assert.equal(result.ref, "private-upload://a.jpg");
});

// ─────────────────────── fallback priority ───────────────────────

test("canonical Mockups beats a product image", () => {
  const order = makeOrder({
    products: [{ image_url: "private-upload://product.jpg" }],
  });
  const rows = [makeRow({ folder_name: "Mockups", file_url: "private-upload://mockup.jpg" })];
  const result = resolveOrderPrimaryImage(order, rows);
  assert.equal(result.ref, "private-upload://mockup.jpg");
  assert.equal(result.source, "canonical-mockups");
});

test("product image beats a generic order file", () => {
  const order = makeOrder({
    products: [{ image_url: "private-upload://product.jpg" }],
    file_urls: ["private-upload://generic.jpg"],
  });
  const result = resolveOrderPrimaryImage(order, []);
  assert.equal(result.ref, "private-upload://product.jpg");
  assert.equal(result.source, "product");
});

test("generic order file is used when no mockups/product image exists", () => {
  const order = makeOrder({ file_urls: ["private-upload://generic.jpg"] });
  const result = resolveOrderPrimaryImage(order, []);
  assert.equal(result.ref, "private-upload://generic.jpg");
  assert.equal(result.source, "order-file");
});

test("legacy mockup_urls is only used as a last-resort compatibility fallback", () => {
  const order = makeOrder({ mockup_urls: ["private-upload://legacy.jpg"] });
  const result = resolveOrderPrimaryImage(order, []);
  assert.equal(result.ref, "private-upload://legacy.jpg");
  assert.equal(result.source, "legacy-mockup-urls");
});

test("no image anywhere resolves to an empty ref", () => {
  const result = resolveOrderPrimaryImage(makeOrder(), []);
  assert.equal(result.ref, "");
  assert.equal(result.source, "none");
});

test("portal_visible_file_urls never participates in primary selection", () => {
  const order = makeOrder({ portal_visible_file_urls: ["private-upload://portal-only.jpg"] });
  const result = resolveOrderPrimaryImage(order, []);
  assert.equal(result.ref, "");
});

test("account_visible_file_urls never participates in primary selection", () => {
  const order = makeOrder({ account_visible_file_urls: ["private-upload://account-only.jpg"] });
  const result = resolveOrderPrimaryImage(order, []);
  assert.equal(result.ref, "");
});

test("canonical Mockups selection is deterministic: orders.file_urls order wins, not row order", () => {
  const order = makeOrder({ file_urls: ["private-upload://second.jpg", "private-upload://first.jpg"] });
  const rows = [
    makeRow({ asset_id: "asset-a", folder_name: "Mockups", file_url: "private-upload://first.jpg" }),
    makeRow({ asset_id: "asset-b", folder_name: "Mockups", file_url: "private-upload://second.jpg" }),
  ];
  const result = resolveOrderPrimaryImage(order, rows);
  // "second.jpg" appears first in file_urls, so it wins even though
  // "first.jpg"'s row was listed first in the RPC result array.
  assert.equal(result.ref, "private-upload://second.jpg");
  assert.equal(result.assetId, "asset-b");
});

// ─────────────────────── gallery ───────────────────────

test("gallery puts the resolved primary first", () => {
  const order = makeOrder({
    primary_image_asset_id: "asset-1",
    file_urls: ["private-upload://other.jpg", "private-upload://primary.jpg"],
  });
  const rows = [makeRow({ asset_id: "asset-1", file_url: "private-upload://primary.jpg" })];
  const gallery = buildOrderPrimaryImageGallery(order, rows);
  assert.equal(gallery[0], "private-upload://primary.jpg");
  assert.ok(gallery.includes("private-upload://other.jpg"));
});

test("gallery dedupes a url that appears in multiple candidate sources", () => {
  const order = makeOrder({
    primary_image_asset_id: "asset-1",
    file_urls: ["private-upload://shared.jpg"],
  });
  const rows = [makeRow({ asset_id: "asset-1", file_url: "private-upload://shared.jpg" })];
  const gallery = buildOrderPrimaryImageGallery(order, rows);
  assert.equal(gallery.filter((url) => url === "private-upload://shared.jpg").length, 1);
});

// ─────────────────────── grouping ───────────────────────

test("groupPrimaryImageContextByOrder groups a flat batched result by order_id", () => {
  const rows = [
    makeRow({ order_id: "order-a", asset_id: "a1" }),
    makeRow({ order_id: "order-b", asset_id: "b1" }),
    makeRow({ order_id: "order-a", asset_id: "a2" }),
  ];
  const grouped = groupPrimaryImageContextByOrder(rows);
  assert.equal(grouped.get("order-a").length, 2);
  assert.equal(grouped.get("order-b").length, 1);
  assert.equal(grouped.get("order-c"), undefined);
});

test("getSelectablePrimaryCandidates filters out non-image and mismatched-ownership rows", () => {
  const order = makeOrder();
  const rows = [
    makeRow({ asset_id: "ok", file_url: "private-upload://a.jpg" }),
    makeRow({ asset_id: "bad-ext", file_url: "private-upload://a.pdf" }),
    makeRow({ asset_id: "bad-client", asset_client_id: "someone-else", file_url: "private-upload://b.jpg" }),
  ];
  const candidates = getSelectablePrimaryCandidates(order, rows);
  assert.deepEqual(candidates.map((r) => r.asset_id), ["ok"]);
});

// ─────────────────────── unlink ───────────────────────

test("unlinking the file that IS the selected primary clears primary_image_asset_id", () => {
  const order = makeOrder({ primary_image_asset_id: "asset-1" });
  const rows = [makeRow({ asset_id: "asset-1", file_url: "private-upload://primary.jpg" })];
  const patch = resolveUnlinkPrimaryImagePatch(order, rows, "private-upload://primary.jpg");
  assert.deepEqual(patch, { primary_image_asset_id: null });
});

test("unlinking an unrelated file does not touch primary_image_asset_id", () => {
  const order = makeOrder({ primary_image_asset_id: "asset-1" });
  const rows = [makeRow({ asset_id: "asset-1", file_url: "private-upload://primary.jpg" })];
  const patch = resolveUnlinkPrimaryImagePatch(order, rows, "private-upload://unrelated.jpg");
  assert.deepEqual(patch, {});
});

test("no patch is produced when no primary is currently selected", () => {
  const order = makeOrder({ primary_image_asset_id: null });
  const patch = resolveUnlinkPrimaryImagePatch(order, [], "private-upload://anything.jpg");
  assert.deepEqual(patch, {});
});

// ───────────────────── OrderFilesTab.jsx source-structure pins ─────────────────────
// React/react-query component - see the file-header note on why these are
// pinned structurally rather than executed.

const readSource = async (relativePath) => {
  const text = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return text.replace(/\r\n/g, "\n");
};

let orderFilesTabSource;
test.before(async () => {
  orderFilesTabSource = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
});

test("OrderFilesTab: production_thumbnail_url is fully removed", () => {
  assert.doesNotMatch(orderFilesTabSource, /production_thumbnail_url/);
});

test("OrderFilesTab: 'Set as primary image' / 'Clear primary image' use a real ClientAsset id, never a UI-only id or raw URL", () => {
  assert.match(orderFilesTabSource, /Set as primary image/);
  assert.match(orderFilesTabSource, /Clear primary image/);
  assert.match(orderFilesTabSource, /onSet\(contextRow\.asset_id\)/);
  assert.doesNotMatch(orderFilesTabSource, /primary_image_asset_id:\s*entry\.id/);
  assert.doesNotMatch(orderFilesTabSource, /primary_image_asset_id:\s*entry\.url/);
});

test("OrderFilesTab: loads canonical context via getOrderPrimaryImageContext, never a per-file lookup", () => {
  assert.match(orderFilesTabSource, /dataClient\.files\.getOrderPrimaryImageContext\(\[safeOrder\.id\]\)/);
});

test("OrderFilesTab: removing a real file link atomically clears primary in ONE patch when it is the selected primary", () => {
  const removeFn = orderFilesTabSource.match(/const removeFileLink = \(entry\) => \{[\s\S]*?\n  \};/);
  assert.ok(removeFn, "removeFileLink not found");
  assert.match(removeFn[0], /resolveUnlinkPrimaryImagePatch\(safeOrder, primaryImageContext, entry\.url\)/);
  assert.match(removeFn[0], /\.\.\.primaryPatch/);
  // Exactly one onUpdate call in this branch - not two separate writes.
  const updateCalls = removeFn[0].match(/onUpdate\(/g) || [];
  assert.equal(updateCalls.length, 1);
});

test("OrderFilesTab: removing a copy alias never touches primary (early return, no primary patch)", () => {
  const removeFn = orderFilesTabSource.match(/const removeFileLink = \(entry\) => \{([\s\S]*?)\n  \};/);
  assert.ok(removeFn);
  const copyBranch = removeFn[1].slice(0, removeFn[1].indexOf("if (!window.confirm"));
  assert.match(copyBranch, /if \(entry\.isCopy\) \{/);
  assert.doesNotMatch(copyBranch, /primary_image_asset_id/);
  assert.doesNotMatch(copyBranch, /resolveUnlinkPrimaryImagePatch/);
});

test("OrderFilesTab: moving a file's category never touches primary", () => {
  const moveFn = orderFilesTabSource.match(/const moveFile = \(entry, folderId\) => \{[\s\S]*?\n  \};/);
  assert.ok(moveFn, "moveFile not found");
  assert.doesNotMatch(moveFn[0], /primary_image_asset_id/);
  assert.doesNotMatch(moveFn[0], /resolveUnlinkPrimaryImagePatch/);
});

test("OrderFilesTab: renaming a file label never touches primary", () => {
  const renameFn = orderFilesTabSource.match(/const renameFileWithName = \(entry, name\) => \{[\s\S]*?\n  \};/);
  assert.ok(renameFn, "renameFileWithName not found");
  assert.doesNotMatch(renameFn[0], /primary_image_asset_id/);
});

test("OrderFilesTab: toggling client-visible never touches primary", () => {
  const toggleFn = orderFilesTabSource.match(/const toggleClientVisible = \(url, checked\) => \{[\s\S]*?\n  \};/);
  assert.ok(toggleFn, "toggleClientVisible not found");
  assert.doesNotMatch(toggleFn[0], /primary_image_asset_id/);
});

// ───────────────────── Orders.jsx / dataClient.js / migration pins ─────────────────────

test("Orders.jsx: production_thumbnail_url is fully removed", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.doesNotMatch(source, /production_thumbnail_url/);
});

test("Orders.jsx: Production Summary fetches primary-image context in ONE batched query, not per-card", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.match(source, /getOrderPrimaryImageContext\(activeOrderIds\)/);
  // Only one call site for the batched query - no second (per-card) call.
  const calls = source.match(/getOrderPrimaryImageContext\(/g) || [];
  assert.equal(calls.length, 1);
});

test("Orders.jsx: Production Summary priority excludes portal-visible files (delegates entirely to the shared resolver)", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.doesNotMatch(source, /function getOrderThumbnail/);
  assert.doesNotMatch(source, /function getOrderImageGallery/);
  assert.match(source, /resolveOrderPrimaryImage\(/);
  assert.match(source, /buildOrderPrimaryImageGallery\(/);
});

test("dataClient.js: production_thumbnail_url is fully removed", async () => {
  const source = await readSource("src/api/dataClient.js");
  assert.doesNotMatch(source, /production_thumbnail_url/);
});

test("dataClient.js: primary_image_asset_id serializes null explicitly, distinct from omission", async () => {
  const source = await readSource("src/api/dataClient.js");
  const block = source.match(/primary_image_asset_id:\s*\n(?:[^\n]*\n){0,4}?[^\n]*idOrUndefined\(payload\.primary_image_asset_id\)/);
  assert.ok(block, "primary_image_asset_id serialize block not found");
  assert.match(block[0], /payload\.primary_image_asset_id === null\s*\n\s*\? null/);
});

test("dataClient.js: getOrderPrimaryImageContext calls the RPC and normalizes input", async () => {
  const source = await readSource("src/api/dataClient.js");
  assert.match(source, /async getOrderPrimaryImageContext\(orderIds = \[\]\) \{/);
  assert.match(source, /supabase\.rpc\('get_order_primary_image_context', \{/);
});

test("migration: the rejected production_thumbnail_url migration file no longer exists", async () => {
  await assert.rejects(
    readFile(new URL("../supabase/migrations/202608060005_add_order_production_thumbnail.sql", import.meta.url)),
    /ENOENT/
  );
});

test("migration: canonical primary_image_asset_id migration adds the FK, validation trigger, and RPC", async () => {
  const source = await readSource("supabase/migrations/202608100001_order_primary_image.sql");
  assert.match(source, /add column if not exists primary_image_asset_id uuid null/);
  assert.match(source, /references public\.client_assets\(id\)/);
  assert.match(source, /on delete set null/);
  assert.match(source, /create or replace function public\.validate_order_primary_image/);
  assert.match(source, /create or replace function public\.get_order_primary_image_context/);
  assert.doesNotMatch(source, /update public\.orders set primary_image_asset_id/i);
});
