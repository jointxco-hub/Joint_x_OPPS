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

// Mirrors what the real get_order_primary_image_context RPC guarantees by
// construction: folder_kind is "client_category" for the real category
// subfolders provision_order_asset_folders creates (confirmed via a
// read-only production metadata check), and file_url is always a member
// of the order's own file_urls (the RPC's own join condition). Individual
// tests that need to violate one of these invariants do so explicitly.
function makeRow(overrides = {}) {
  return {
    order_id: "order-1",
    asset_id: "asset-1",
    file_url: "private-upload://uploads/x/photo.jpg",
    file_type: "image/jpeg",
    folder_id: "folder-1",
    folder_name: "Mockups",
    folder_kind: "client_category",
    asset_client_id: CLIENT_ID,
    asset_tenant_id: TENANT_ID,
    ...overrides,
  };
}

// ─────────────────────── explicit primary resolution ───────────────────────

test("valid explicit ClientAsset primary wins", () => {
  const order = makeOrder({ primary_image_asset_id: "asset-1", file_urls: ["private-upload://a.jpg"] });
  const rows = [makeRow({ asset_id: "asset-1", file_url: "private-upload://a.jpg" })];
  const result = resolveOrderPrimaryImage(order, rows);
  assert.equal(result.ref, "private-upload://a.jpg");
  assert.equal(result.assetId, "asset-1");
  assert.equal(result.source, "explicit");
});

test("wrong client rejected", () => {
  const order = makeOrder({
    primary_image_asset_id: "asset-1",
    file_urls: ["private-upload://a.jpg", "private-upload://fallback.jpg"],
  });
  const rows = [makeRow({ asset_id: "asset-1", asset_client_id: "someone-else", file_url: "private-upload://a.jpg" })];
  const result = resolveOrderPrimaryImage(order, rows);
  assert.notEqual(result.source, "explicit");
  assert.equal(isSelectablePrimaryCandidate(order, rows[0]), false);
  assert.equal(validateExplicitPrimary(order, rows, "asset-1"), false);
});

test("wrong tenant rejected", () => {
  const order = makeOrder({ primary_image_asset_id: "asset-1", file_urls: ["private-upload://a.jpg"] });
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

// Defense in depth (section 4 of the final hardening pass): the resolver
// does not merely trust that every row it's handed is currently linked -
// a row whose file_url isn't in order.file_urls is rejected by the pure
// helper itself, not just by the RPC's own join. This matters because the
// helper is documented as safe even for a caller that assembles context
// rows outside the RPC (a test, or a future non-RPC source).
test("a context row whose file_url is NOT in order.file_urls is rejected (resolver's own relationship guard)", () => {
  const order = makeOrder({ primary_image_asset_id: "asset-1", file_urls: ["private-upload://fallback.jpg"] });
  const staleRow = makeRow({ asset_id: "asset-1", file_url: "private-upload://no-longer-linked.jpg" });
  assert.equal(isSelectablePrimaryCandidate(order, staleRow), false);
  const result = resolveOrderPrimaryImage(order, [staleRow]);
  assert.notEqual(result.source, "explicit");
  assert.equal(result.ref, "private-upload://fallback.jpg");
});

test("a synthetic row explicitly marked archived is rejected, however it is named", () => {
  const order = makeOrder({ primary_image_asset_id: "asset-1", file_urls: ["private-upload://a.jpg"] });
  const archivedViaIsArchived = makeRow({ asset_id: "asset-1", file_url: "private-upload://a.jpg", is_archived: true });
  assert.equal(isSelectablePrimaryCandidate(order, archivedViaIsArchived), false);
  const archivedViaAssetIsArchived = makeRow({ asset_id: "asset-1", file_url: "private-upload://a.jpg", asset_is_archived: true });
  assert.equal(isSelectablePrimaryCandidate(order, archivedViaAssetIsArchived), false);
  const result = resolveOrderPrimaryImage(order, [archivedViaIsArchived]);
  assert.notEqual(result.source, "explicit");
  assert.notEqual(result.assetId, "asset-1");
});

test("non-image asset is rejected", () => {
  const order = makeOrder({ primary_image_asset_id: "asset-1", file_urls: ["private-upload://doc.pdf", "private-upload://fallback.jpg"] });
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
  const order = makeOrder({ primary_image_asset_id: "asset-1", file_urls: ["private-upload://a.jpg"] });
  const row = makeRow({ asset_id: "asset-1", file_url: "private-upload://a.jpg" });
  delete row.order_id;
  const result = resolveOrderPrimaryImage(order, [row]);
  assert.equal(result.source, "explicit");
  assert.equal(result.ref, "private-upload://a.jpg");
});

// ─────────────────────── canonical Mockups requires folder_kind ───────────────────────

test("client_category + Mockups is canonical", () => {
  const order = makeOrder({ file_urls: ["private-upload://mockup.jpg"] });
  const rows = [makeRow({ folder_kind: "client_category", folder_name: "Mockups", file_url: "private-upload://mockup.jpg" })];
  const result = resolveOrderPrimaryImage(order, rows);
  assert.equal(result.source, "canonical-mockups");
  assert.equal(result.ref, "private-upload://mockup.jpg");
});

test("wrong folder_kind + Mockups name is NOT canonical", () => {
  const order = makeOrder({
    file_urls: ["private-upload://legacy-mockups-folder.jpg", "private-upload://other.jpg"],
  });
  const rows = [makeRow({ folder_kind: "order_category", folder_name: "Mockups", file_url: "private-upload://legacy-mockups-folder.jpg" })];
  const result = resolveOrderPrimaryImage(order, rows);
  assert.notEqual(result.source, "canonical-mockups");
  // Falls through to the generic order-file tier instead - the file is
  // still a real image, it just isn't the automatic canonical pick.
  assert.equal(result.source, "order-file");
});

test("client_category + a non-Mockups name is NOT canonical", () => {
  const order = makeOrder({ file_urls: ["private-upload://artwork.jpg"] });
  const rows = [makeRow({ folder_kind: "client_category", folder_name: "Artwork", file_url: "private-upload://artwork.jpg" })];
  const result = resolveOrderPrimaryImage(order, rows);
  assert.notEqual(result.source, "canonical-mockups");
  assert.equal(result.source, "order-file");
});

// ─────────────────────── fallback priority ───────────────────────

test("canonical Mockups beats a product image", () => {
  const order = makeOrder({
    products: [{ image_url: "private-upload://product.jpg" }],
    file_urls: ["private-upload://mockup.jpg"],
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

test("getSelectablePrimaryCandidates filters out non-image, mismatched-ownership, and unlinked rows", () => {
  const order = makeOrder({
    file_urls: ["private-upload://a.jpg", "private-upload://a.pdf", "private-upload://b.jpg", "private-upload://c.jpg"],
  });
  const rows = [
    makeRow({ asset_id: "ok", file_url: "private-upload://a.jpg" }),
    makeRow({ asset_id: "bad-ext", file_url: "private-upload://a.pdf" }),
    makeRow({ asset_id: "bad-client", asset_client_id: "someone-else", file_url: "private-upload://b.jpg" }),
    makeRow({ asset_id: "bad-linkage", file_url: "private-upload://not-in-file-urls.jpg" }),
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

// Section 12: an unconditional Clear Primary action must exist at the
// Order Files header level, independent of whether the ClientAsset
// context resolved - staff must never lose the ability to clear a stale/
// unresolvable primary.
test("OrderFilesTab: an unconditional header-level Clear Primary action exists whenever a primary is set", () => {
  const headerBlock = orderFilesTabSource.match(/\{primaryAssetId && \(([\s\S]*?)\n {6}\)\}/);
  assert.ok(headerBlock, "unconditional primary-image header block not found");
  const block = headerBlock[1];
  assert.match(block, /onClick=\{clearPrimaryImage\}/);
  assert.match(block, /Clear primary image/);
  // Must not be gated behind contextRow/loading/error checks - it renders
  // whenever primaryAssetId is set, full stop.
  assert.doesNotMatch(block, /\{primaryImageContextLoading && \(/);
});

test("OrderFilesTab: distinguishes an RPC failure from a file still syncing to the client library", () => {
  assert.match(orderFilesTabSource, /Could not load primary-image context/);
  assert.match(orderFilesTabSource, /Still syncing to client library/);
  const actionFn = orderFilesTabSource.match(/function PrimaryImageAction\([\s\S]*?\n {2}\}/);
  assert.ok(actionFn, "PrimaryImageAction not found");
  assert.match(actionFn[0], /if \(queryError\) \{/);
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
});

test("Orders.jsx: the list view fetches primary-image context in ONE batched query for the filtered/visible order set, not per-row", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.match(source, /getOrderPrimaryImageContext\(filteredOrderIds\)/);
});

test("Orders.jsx: exactly two getOrderPrimaryImageContext call sites exist (Production Summary's activeOrderIds, list view's filteredOrderIds) - never a third, and never one nested inside a per-row/per-card render function", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const calls = source.match(/getOrderPrimaryImageContext\(/g) || [];
  assert.equal(calls.length, 2);
  // Both call sites must live inside a component-level useQuery, not inside
  // a per-item render function (OrderListThumbnail/ProductionSummaryOrderCard
  // themselves never call the RPC - they only ever receive already-fetched
  // contextRows as a prop).
  const thumbnailBody = source.slice(source.indexOf("function OrderListThumbnail"), source.indexOf("function DrawerLoadingFallback"));
  assert.doesNotMatch(thumbnailBody, /getOrderPrimaryImageContext/);
  const cardBody = source.slice(source.indexOf("function ProductionSummaryOrderCard"), source.indexOf("function PrintDatum"));
  assert.doesNotMatch(cardBody, /getOrderPrimaryImageContext/);
});

test("Orders.jsx: Production Summary priority excludes portal-visible files (delegates entirely to the shared resolver)", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.doesNotMatch(source, /function getOrderThumbnail/);
  assert.doesNotMatch(source, /function getOrderImageGallery/);
  assert.match(source, /resolveOrderPrimaryImage\(/);
  assert.match(source, /buildOrderPrimaryImageGallery\(/);
});

test("Orders.jsx: Production Summary print waits for context (loading/error) and unresolved explicit primaries", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const summaryMatch = source.match(/function OrdersProductionSummary[\s\S]*?\nfunction ProductionSummaryOrderCard/);
  assert.ok(summaryMatch, "OrdersProductionSummary body not found");
  const body = summaryMatch[0];
  assert.match(body, /isLoading: primaryImageContextLoading/);
  assert.match(body, /isError: primaryImageContextError/);
  assert.match(body, /const contextResolved = !primaryImageContextLoading && !primaryImageContextError;/);
  assert.match(body, /const printReady = imageResolutionReady && contextResolved && !hasUnresolvedExplicitPrimary;/);
});

test("Orders.jsx: a client-linked card does not show a false fallback while context is pending", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.match(source, /contextPending=\{Boolean\(order\.client_id\) && primaryImageContextLoading\}/);
  const cardMatch = source.match(/function ProductionSummaryOrderCard\([\s\S]*?\n\}/);
  assert.ok(cardMatch, "ProductionSummaryOrderCard body not found");
  assert.match(cardMatch[0], /const thumb = contextPending \? "" : resolveOrderPrimaryImage\(order, primaryImageContext\)\.ref;/);
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

// Section 6: the RPC rejects (never silently truncates) an oversized
// input, and the client wrapper chunks so no caller ever actually sends
// more than the RPC's own limit.
test("dataClient.js: getOrderPrimaryImageContext chunks input at <= 200 ids per RPC call, never one call per order", async () => {
  const source = await readSource("src/api/dataClient.js");
  assert.match(source, /PRIMARY_IMAGE_CONTEXT_CHUNK_SIZE = 200/);
  const fnMatch = source.match(/async getOrderPrimaryImageContext\(orderIds = \[\]\) \{[\s\S]*?\n    \},/);
  assert.ok(fnMatch, "getOrderPrimaryImageContext body not found");
  assert.match(fnMatch[0], /for \(let i = 0; i < ids\.length; i \+= PRIMARY_IMAGE_CONTEXT_CHUNK_SIZE\)/);
  assert.match(fnMatch[0], /chunks\.push\(ids\.slice\(i, i \+ PRIMARY_IMAGE_CONTEXT_CHUNK_SIZE\)\)/);
  assert.match(fnMatch[0], /Promise\.all\(/);
  // Exactly one supabase.rpc call site inside the chunk-mapping loop, not
  // one per id/order.
  const rpcCalls = fnMatch[0].match(/supabase\.rpc\(/g) || [];
  assert.equal(rpcCalls.length, 1);
});

test("migration: the rejected production_thumbnail_url migration file no longer exists", async () => {
  await assert.rejects(
    readFile(new URL("../supabase/migrations/202608060005_add_order_production_thumbnail.sql", import.meta.url)),
    /ENOENT/
  );
});

let migrationSource;
test.before(async () => {
  migrationSource = await readSource("supabase/migrations/202608100001_order_primary_image.sql");
});

test("migration: canonical primary_image_asset_id migration adds the FK, validation trigger, and RPC", async () => {
  assert.match(migrationSource, /add column if not exists primary_image_asset_id uuid null/);
  assert.match(migrationSource, /references public\.client_assets\(id\)/);
  assert.match(migrationSource, /on delete set null/);
  assert.match(migrationSource, /create or replace function public\.validate_order_primary_image/);
  assert.match(migrationSource, /create or replace function public\.get_order_primary_image_context/);
  assert.doesNotMatch(migrationSource, /update public\.orders set primary_image_asset_id/i);
});

test("migration: the image-extension regex is dollar-quoted, not a plain single-quoted string", () => {
  const dollarQuoted = "$img$\\.(png|jpe?g|webp|gif|avif|svg)(\\?|#|$)$img$";
  const occurrences = migrationSource.split(dollarQuoted).length - 1;
  // Used once in the order-side trigger and once in the ClientAsset
  // lifecycle backstop - both must use the unambiguous form.
  assert.equal(occurrences, 2);
  assert.doesNotMatch(migrationSource, /!~\* '\\\.\(png/);
});

test("migration: image extensions match src/lib/imageReference.js exactly (no video)", () => {
  // Extract the actual extension-alternation substring used inside the
  // dollar-quoted regex and check THAT, not the whole file - a prose word
  // like "moved" contains "mov" as a substring and would otherwise
  // false-positive against a whole-file search.
  const match = migrationSource.match(/\$img\$\\\.\(([^)]+)\)/);
  assert.ok(match, "extension alternation not found");
  assert.equal(match[1], "png|jpe?g|webp|gif|avif|svg");
});

// Section 3: a ClientAsset lifecycle backstop must exist, scoped to only
// the columns that actually affect primary-image validity.
test("migration: a ClientAsset lifecycle trigger invalidates a stale primary when the asset itself changes", () => {
  assert.match(migrationSource, /create or replace function public\.invalidate_stale_order_primary_image/);
  assert.match(
    migrationSource,
    /after update of is_archived, client_id, tenant_id, file_url\s*\n\s*on public\.client_assets/
  );
  // Never fires on folder/title/notes/tags/approval metadata changes.
  assert.doesNotMatch(migrationSource, /after update of[^\n]*folder_id[^\n]*on public\.client_assets/);
});

test("migration: the ClientAsset lifecycle trigger only clears the SPECIFIC order(s) referencing the changed asset (row-scoped, not a backfill)", () => {
  const fnMatch = migrationSource.match(/create or replace function public\.invalidate_stale_order_primary_image[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "invalidate_stale_order_primary_image body not found");
  assert.match(fnMatch[0], /where o\.primary_image_asset_id = new\.id/);
  assert.match(fnMatch[0], /coalesce\(new\.is_archived, false\)/);
  assert.match(fnMatch[0], /new\.client_id is distinct from o\.client_id/);
  assert.match(fnMatch[0], /new\.tenant_id is distinct from o\.tenant_id/);
});

test("migration: RPC rejects an oversized input instead of silently truncating it", () => {
  const fnMatch = migrationSource.match(/create or replace function public\.get_order_primary_image_context[\s\S]*?\$\$;/);
  assert.ok(fnMatch, "get_order_primary_image_context body not found");
  assert.doesNotMatch(fnMatch[0], /limit 200/i);
  assert.match(fnMatch[0], /if v_count > 200 then/);
  assert.match(fnMatch[0], /ORDER_PRIMARY_IMAGE_CONTEXT_TOO_MANY_ORDERS/);
});

test("migration: RPC still resolves linkage via orders.file_urls, never client_assets.order_id", () => {
  const fnMatch = migrationSource.match(/create or replace function public\.get_order_primary_image_context[\s\S]*?\$\$;/);
  assert.match(fnMatch[0], /jsonb_array_elements_text/);
  assert.doesNotMatch(fnMatch[0], /ca\.order_id/);
});

test("migration: trigger functions revoke direct execute from ordinary roles", () => {
  assert.match(migrationSource, /revoke all on function public\.validate_order_primary_image\(\) from public, anon, authenticated;/);
  assert.match(migrationSource, /revoke all on function public\.invalidate_stale_order_primary_image\(\) from public, anon, authenticated;/);
  assert.match(migrationSource, /revoke all on function public\.get_order_primary_image_context\(uuid\[\]\) from public, anon;/);
  assert.match(migrationSource, /grant execute on function public\.get_order_primary_image_context\(uuid\[\]\) to authenticated;/);
});

test("migration: no historical backfill of any kind", () => {
  assert.doesNotMatch(migrationSource, /^update /im);
});
