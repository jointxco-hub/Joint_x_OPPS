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
  assert.match(quickPrintSource, /buildLightboxItems\(productionImageRefs, \{ preserveIdentity: false \}\)/);
  assert.match(quickPrintSource, /files=\{printImagePreview\.files\}/);
  assert.doesNotMatch(quickPrintSource, /<FileLightbox[^>]*\bfile=\{/);
});

// 5: the clicked image determines the starting index.
test("OrderQuickPrintSheet: clicked image resolves the starting index", () => {
  assert.match(quickPrintSource, /resolveLightboxIndex\(files, clickedUrl\)/);
  assert.match(quickPrintSource, /index=\{printImagePreview\.index\}/);
});

// 6: the resolved Order Primary Image is preferred first in the gallery -
// via the shared Phase 1B.2 resolver, not a bare url column.
test("OrderQuickPrintSheet: primary image is resolved via the shared canonical resolver, not a url pin", () => {
  assert.match(quickPrintSource, /import \{ buildOrderPrimaryImageGallery, resolveOrderPrimaryImage \} from "@\/lib\/orderPrimaryImage"/);
  assert.doesNotMatch(quickPrintSource, /production_thumbnail_url/);
});

// BLOCKER FIX (final hardening pass): the actual printed image cards must
// use the SAME primary-first collection as the lightbox - a local
// "mockups folder or bust" list (the old filesForMockups) could omit an
// explicit primary or product-fallback image that lives outside that
// folder, so the print output and the on-screen lightbox could disagree
// about which image is the order's primary.
test("OrderQuickPrintSheet: printed image cards and the lightbox both come from buildOrderPrimaryImageGallery - no separate local-folder list", () => {
  assert.doesNotMatch(quickPrintSource, /filesForMockups/);
  assert.doesNotMatch(quickPrintSource, /mockupFiles/);
  assert.doesNotMatch(quickPrintSource, /imageFiles\b/);
  assert.match(
    quickPrintSource,
    /const productionImageRefs = showMockups \? buildOrderPrimaryImageGallery\(order, primaryImageContext\) : \[\];/
  );
  assert.match(quickPrintSource, /\{productionImageRefs\.map\(\(url, index\) => \{/);
  assert.match(quickPrintSource, /No mockup\/image files attached yet\./);
});

// 7 & 8: raw canonical refs are passed to FileLightbox - resolved signed
// print URLs never leak into the gallery/identity.
test("OrderQuickPrintSheet: gallery is built from raw refs, not resolved signed print URLs", () => {
  const openPreviewMatch = quickPrintSource.match(/const openImagePreview = \(clickedUrl\) => \{[\s\S]*?\n  \};/);
  assert.ok(openPreviewMatch, "openImagePreview function body not found");
  const body = openPreviewMatch[0];
  assert.doesNotMatch(body, /resolvedImages/);
  assert.doesNotMatch(body, /resolved\.url/);
  assert.match(body, /buildLightboxItems\(productionImageRefs/);
});

// Canonical context is fetched once via the batched, read-only RPC -
// never a per-file/per-click lookup, and never client_assets.order_id.
test("OrderQuickPrintSheet: fetches canonical primary-image context via the batched RPC wrapper", () => {
  assert.match(quickPrintSource, /dataClient\.files\.getOrderPrimaryImageContext\(\[order\.id\]\)/);
});

// Context must be required for ANY client-linked SUMMARY/MOCKUPS order,
// not only when an explicit pin exists - an unpinned order can still have
// a canonical Mockups asset the resolver can't know about until context
// loads. But an invoice-only printout (showMockups false) never renders
// the Mockups / Production Images section at all, so primary-image
// context is irrelevant there and must never gate invoice printing.
test("OrderQuickPrintSheet: canonical context is required for client-linked summary/mockups orders, never for invoice-only printing", () => {
  assert.match(quickPrintSource, /const showMockups = type !== "invoices";/);
  assert.match(quickPrintSource, /const contextRequired = showMockups && Boolean\(order\.client_id\);/);
  assert.match(quickPrintSource, /enabled: Boolean\(order\.id\) && contextRequired,/);
  assert.doesNotMatch(quickPrintSource, /const contextRequired = Boolean\(order\.client_id\);/);
  assert.doesNotMatch(quickPrintSource, /enabled: Boolean\(order\.id\) && Boolean\(order\.client_id\)/);
});

test("OrderQuickPrintSheet: an invoice-only printout cannot be gated by primary-image resolution even if the order has a pin", () => {
  const unresolvedMatch = quickPrintSource.match(/const explicitPrimaryUnresolved = contextRequired[\s\S]*?;\n/);
  assert.ok(unresolvedMatch, "explicitPrimaryUnresolved not found");
  assert.match(unresolvedMatch[0], /^const explicitPrimaryUnresolved = contextRequired\n/);
});

test("OrderQuickPrintSheet: productionImageRefs stays empty for invoice-only printing (showMockups false)", () => {
  assert.match(
    quickPrintSource,
    /const productionImageRefs = showMockups \? buildOrderPrimaryImageGallery\(order, primaryImageContext\) : \[\];/
  );
});

test("OrderQuickPrintSheet: primary-image warnings/retry UI are scoped inside the showMockups-only section, never shown for invoices", () => {
  const mockupsSection = quickPrintSource.match(/\{showMockups && \(\s*<OrderPrintSection title="Mockups \/ Production Images">[\s\S]*?\n {10}\)\}/);
  assert.ok(mockupsSection, "Mockups / Production Images section not found");
  assert.match(mockupsSection[0], /Preparing primary image context/);
  assert.match(mockupsSection[0], /Primary image context could not be loaded/);
  assert.match(mockupsSection[0], /could not be verified/);
});

// Print must not falsely enable while context is loading OR failed to
// load, and must not enable while an explicit primary couldn't be
// resolved after a successful load.
test("OrderQuickPrintSheet: print readiness accounts for context loading, context errors, and an unresolved explicit primary", () => {
  assert.match(quickPrintSource, /isError: primaryImageContextError,/);
  assert.match(
    quickPrintSource,
    /const contextLoaded = !contextRequired \|\| \(!primaryImageContextLoading && !primaryImageContextError\);/
  );
  assert.match(
    quickPrintSource,
    /const explicitPrimaryUnresolved = contextRequired\s*\n\s*&& Boolean\(order\.primary_image_asset_id\)\s*\n\s*&& contextLoaded\s*\n\s*&& primaryResolution\.source !== "explicit";/
  );
  assert.match(quickPrintSource, /const printReady = imageResolutionReady && contextLoaded && !explicitPrimaryUnresolved;/);
  assert.match(quickPrintSource, /Primary image context could not be loaded\./);
  assert.match(quickPrintSource, /onClick=\{\(\) => refetchPrimaryImageContext\(\)\}/);
});

// 9: synthetic/UI ids are never passed through as persisted ClientAsset ids.
test("OrderQuickPrintSheet: gallery items are built with preserveIdentity: false", () => {
  assert.match(quickPrintSource, /buildLightboxItems\(productionImageRefs, \{ preserveIdentity: false \}\)/);
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
