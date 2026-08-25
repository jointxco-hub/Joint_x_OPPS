import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// Order Line Coherence Phase 1A - Orders list thumbnail + lightbox.
// Zero schema, purely additive: reuses the exact same canonical
// batched-context RPC, resolver, gallery builder, and FileLightbox
// already proven by OrdersProductionSummary/ProductionSummaryOrderCard
// and OrderQuickPrintSheet - no second resolver, no new lightbox, no
// N+1 (one useQuery for the whole filtered/visible list, not per-row).
// ─────────────────────────────────────────────────────────────────────

test("OrderListThumbnail resolves via the canonical resolveOrderPrimaryImage/orderPrimaryImage.js authority - no second/local resolver invented", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const start = source.indexOf("function OrderListThumbnail");
  const end = source.indexOf("function DrawerLoadingFallback");
  assert.notEqual(start, -1);
  const body = source.slice(start, end);
  assert.ok(body.includes("resolveOrderPrimaryImage(order, contextRows)"), "must resolve via the shared authority, given contextRows as a prop, never fetch its own data");
  assert.ok(!/getOrderPrimaryImageContext/.test(body), "must never call the RPC itself - only the parent's batched query may do that");
});

test("the list-view batched query is scoped to the filtered/visible order set and only fires for the list view, matching the established staleTime convention", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const queryStart = source.indexOf('queryKey: ["orderPrimaryImageContext", "list", filteredOrderIds]');
  assert.notEqual(queryStart, -1);
  const queryBody = source.slice(queryStart, queryStart + 300);
  assert.ok(queryBody.includes("dataClient.files.getOrderPrimaryImageContext(filteredOrderIds)"));
  assert.ok(queryBody.includes('enabled: viewMode === "list"'));
  assert.ok(queryBody.includes("staleTime: 15_000"), "matches OrdersProductionSummary's existing staleTime convention");
});

test("filteredOrderIds is derived from the filtered (visible, post-search/status/assignee-filter) order list, not the raw unfiltered 200-row fetch", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const start = source.indexOf("const filteredOrderIds = useMemo(");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 200);
  assert.ok(body.includes("filtered.map(order => order.id)"));
});

test("thumbnail groups context via groupPrimaryImageContextByOrder (the same batching helper Production Summary uses) rather than filtering the flat row array per-order inline", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.ok(source.includes("const listPrimaryImageContextByOrder = useMemo(\n    () => groupPrimaryImageContextByOrder(listPrimaryImageContextRows),"));
});

test("clicking a thumbnail with a resolved image opens the shared FileLightbox with this order's canonical gallery (buildOrderPrimaryImageGallery), and stops click propagation so it never also opens the order drawer", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const start = source.indexOf("function OrderListThumbnail");
  const end = source.indexOf("function DrawerLoadingFallback");
  const body = source.slice(start, end);
  assert.ok(body.includes("event.stopPropagation();"));
  assert.ok(body.includes("onOpenGallery(order);"));

  const lightboxStart = source.indexOf("{imageGalleryOrder && (");
  assert.notEqual(lightboxStart, -1);
  const lightboxBody = source.slice(lightboxStart, lightboxStart + 500);
  assert.ok(lightboxBody.includes("buildOrderPrimaryImageGallery(imageGalleryOrder"));
  assert.ok(lightboxBody.includes("preserveIdentity: false"), "matches the established non-commentable, plain-URL gallery contract already used by Production Summary");
  assert.ok(lightboxBody.includes("<FileLightbox"));
});

test("no image resolved -> a clean placeholder renders instead of an empty/broken image, and it is not clickable (no gallery to open)", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const start = source.indexOf("function OrderListThumbnail");
  const end = source.indexOf("function DrawerLoadingFallback");
  const body = source.slice(start, end);
  const ifNoRefIdx = body.indexOf("if (!ref) {");
  assert.notEqual(ifNoRefIdx, -1);
  const placeholderBlock = body.slice(ifNoRefIdx, ifNoRefIdx + 300);
  assert.ok(placeholderBlock.includes("<Package"), "placeholder must render a clean icon, not a broken image tag");
  assert.ok(!placeholderBlock.includes("<button"), "the no-image state must not be a clickable button - nothing to open");
});

test("the thumbnail is compact (40-56px) via an explicit size prop, not a hardcoded Tailwind class duplicated per call site", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const start = source.indexOf("function OrderListThumbnail");
  const end = source.indexOf("function DrawerLoadingFallback");
  const body = source.slice(start, end);
  assert.ok(body.includes("size = 44"), "default size must fall within 40-56px");
  // Two call sites total (mobile + desktop) - both within the 40-56px range.
  const allSizes = [...source.matchAll(/<OrderListThumbnail[\s\S]*?size=\{(\d+)\}/g)].map((m) => Number(m[1]));
  assert.ok(allSizes.length >= 2, "expected both a mobile and a desktop OrderListThumbnail call site");
  for (const size of allSizes) {
    assert.ok(size >= 40 && size <= 56, `size ${size} must be within the 40-56px compact range`);
  }
});

test("this phase never writes to orders.primary_image_asset_id - a line/list thumbnail is never promoted to the explicit order primary", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const start = source.indexOf("function OrderListThumbnail");
  const end = source.indexOf("function DrawerLoadingFallback");
  const thumbnailBody = source.slice(start, end);
  assert.ok(!/primary_image_asset_id/.test(thumbnailBody));
  // The list-view query wiring itself must also never call an update/set-
  // primary mutation - it is read-only image display.
  const queryStart = source.indexOf('queryKey: ["orderPrimaryImageContext", "list"');
  const queryEnd = source.indexOf("const listPrimaryImageContextByOrder");
  const queryBody = source.slice(queryStart, queryEnd);
  assert.ok(!/updateMutation\.mutate|primary_image_asset_id/.test(queryBody));
});

test("FileLightbox's existing keyboard/arrow gallery navigation is reused as-is - no new lightbox or navigation implementation added for this phase", async () => {
  const lightboxSource = await readSource("src/components/files/FileLightbox.jsx");
  assert.ok(lightboxSource.includes("ArrowLeft"));
  assert.ok(lightboxSource.includes("ArrowRight"));
  const ordersSource = await readSource("src/pages/Orders.jsx");
  // Orders.jsx must import the shared component, never define its own.
  assert.ok(ordersSource.includes('import FileLightbox from "@/components/files/FileLightbox";'));
  assert.ok(!/function FileLightbox/.test(ordersSource));
});
