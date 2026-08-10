import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// OrderQuickPrintSheet.jsx, Orders.jsx, and OrderFilesTab.jsx pull in React
// hooks, react-dom, and the Supabase client, which this repo's plain
// `node --test` runner cannot execute without a bundler/DOM (same
// constraint noted in tests/file-gallery.test.mjs and every other suite in
// this repo). They are pinned with source-structure assertions instead, as
// this repo's existing test suites already do for React components with
// the same constraint.

const readSource = async (relativePath) => {
  const text = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return text.replace(/\r\n/g, "\n");
};

let quickPrintSource;
test.before(async () => {
  quickPrintSource = await readSource("src/components/orders/drawer/OrderQuickPrintSheet.jsx");
});

// 1: imports and renders the shared FileLightbox.
test("OrderQuickPrintSheet: imports and renders the shared FileLightbox", () => {
  assert.match(quickPrintSource, /import FileLightbox from "@\/components\/files\/FileLightbox"/);
  assert.match(quickPrintSource, /<FileLightbox\b/);
});

// 2: does not define a second custom full-screen viewer (no duplicated
// prev/next keyboard handling or chevron controls outside FileLightbox).
test("OrderQuickPrintSheet: does not define a second custom full-screen viewer", () => {
  assert.doesNotMatch(quickPrintSource, /ArrowLeft|ArrowRight/);
  assert.doesNotMatch(quickPrintSource, /ChevronLeft|ChevronRight/);
  assert.doesNotMatch(quickPrintSource, /addEventListener\(["']keydown["']/);
});

// 3: clicking a production image opens the shared FileLightbox.
test("OrderQuickPrintSheet: clicking a production image opens the lightbox", () => {
  assert.match(quickPrintSource, /onClick=\{\(\) => openImagePreview\(url\)\}/);
  assert.match(quickPrintSource, /\{printImagePreview && \(/);
});

// 4: multiple images are passed as a collection (files=, not a single file=).
test("OrderQuickPrintSheet: passes a files collection, not a single file", () => {
  assert.match(quickPrintSource, /buildOrderPrimaryImageGallery\(order, primaryImageContext\)/);
  assert.match(quickPrintSource, /buildLightboxItems\(gallery/);
  assert.match(quickPrintSource, /files=\{printImagePreview\.files\}/);
  assert.doesNotMatch(quickPrintSource, /<FileLightbox[^>]*\bfile=\{/);
});

// 5: the clicked image determines the starting index.
test("OrderQuickPrintSheet: clicked image resolves the starting index", () => {
  assert.match(quickPrintSource, /resolveLightboxIndex\(files, clickedUrl\)/);
  assert.match(quickPrintSource, /index=\{printImagePreview\.index\}/);
});

// 6: the resolved Order Primary Image is preferred first in the gallery -
// via the shared Phase 1B.2 resolver, not a bare url column, and not
// restricted to this sheet's own local "mockups folder" candidate list
// (imageTargets only governs what's rendered on the printed page itself).
test("OrderQuickPrintSheet: primary image is resolved via the shared canonical resolver, not a url pin", () => {
  assert.match(quickPrintSource, /import \{ buildOrderPrimaryImageGallery, resolveOrderPrimaryImage \} from "@\/lib\/orderPrimaryImage"/);
  assert.doesNotMatch(quickPrintSource, /production_thumbnail_url/);
});

// 7 & 8: raw canonical refs are passed to FileLightbox - resolved signed
// print URLs never leak into the gallery/identity.
test("OrderQuickPrintSheet: gallery is built from raw refs, not resolved signed print URLs", () => {
  const openPreviewMatch = quickPrintSource.match(/const openImagePreview = \(clickedUrl\) => \{[\s\S]*?\n  \};/);
  assert.ok(openPreviewMatch, "openImagePreview function body not found");
  const body = openPreviewMatch[0];
  assert.doesNotMatch(body, /resolvedImages/);
  assert.doesNotMatch(body, /resolved\.url/);
  assert.match(body, /buildOrderPrimaryImageGallery\(order, primaryImageContext\)/);
});

// Canonical context is fetched once via the batched, read-only RPC -
// never a per-file/per-click lookup, and never client_assets.order_id.
test("OrderQuickPrintSheet: fetches canonical primary-image context via the batched RPC wrapper", () => {
  assert.match(quickPrintSource, /dataClient\.files\.getOrderPrimaryImageContext\(\[order\.id\]\)/);
});

// Print must not falsely enable while a pinned primary is still resolving.
test("OrderQuickPrintSheet: print readiness accounts for primary-image context still loading", () => {
  assert.match(quickPrintSource, /printReady = imageResolutionReady && !\(order\.primary_image_asset_id && primaryImageContextLoading\)/);
});

// 9: synthetic/UI ids are never passed through as persisted ClientAsset ids.
test("OrderQuickPrintSheet: gallery items are built with preserveIdentity: false", () => {
  assert.match(quickPrintSource, /buildLightboxItems\(gallery, \{ preserveIdentity: false \}\)/);
});

// 10: the existing getSignedFileUrl print-signing flow remains untouched.
test("OrderQuickPrintSheet: existing print-signing flow (getSignedFileUrl) remains", () => {
  assert.match(quickPrintSource, /import \{ getSignedFileUrl \} from "@\/lib\/privateFiles"/);
  assert.match(quickPrintSource, /getSignedFileUrl\(ref, \{ expiresIn: PRINT_SIGNED_URL_TTL_SECONDS \}\)/);
});

// 11: print readiness gating remains.
test("OrderQuickPrintSheet: print-readiness gating remains", () => {
  assert.match(quickPrintSource, /import \{ computeImageReadiness \} from "@\/lib\/printReadiness"/);
  assert.match(quickPrintSource, /computeImageReadiness\(/);
  assert.match(quickPrintSource, /disabled=\{!printReady\}/);
});

// 12: @media print neutralizes the click affordance and hides the lightbox.
test("OrderQuickPrintSheet: @media print hides interactive lightbox controls", () => {
  const printBlockMatch = quickPrintSource.match(/@media print \{([\s\S]*?)\n        \}\n      `\}<\/style>/);
  assert.ok(printBlockMatch, "@media print block not found");
  const printBlock = printBlockMatch[1];
  assert.match(printBlock, /\.order-print-image-trigger\s*\{[^}]*cursor:\s*default\s*!important/);
  assert.match(printBlock, /\.order-print-image-trigger\s*\{[^}]*pointer-events:\s*none\s*!important/);
  assert.match(printBlock, /\.order-quick-print-lightbox\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

// The canonical Order Primary Image role (primary_image_asset_id, the
// validation trigger, the RPC, Orders.jsx/OrderFilesTab.jsx/dataClient.js
// wiring) is covered comprehensively in tests/order-primary-image.test.mjs
// - not duplicated here. This file stays scoped to OrderQuickPrintSheet.jsx.
