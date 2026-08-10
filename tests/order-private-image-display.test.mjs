import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isImageReference } from "../src/lib/imageReference.js";
import { computeImageReadiness } from "../src/lib/printReadiness.js";

// isImageReference and computeImageReadiness have no React/Supabase
// dependency, so they are exercised directly (behavioral). SecureImage.jsx,
// OrderQuickPrintSheet.jsx, and Orders.jsx pull in React hooks and the
// Supabase client, which this repo's plain `node --test` runner cannot
// execute without a bundler/DOM (see the same constraint noted in
// order-invoice-sync.test.mjs and invoice-reliability.test.mjs). Those are
// pinned with source-structure assertions instead, as this repo's existing
// test suites already do for React components with the same constraint.

// --- isImageReference (unchanged by this follow-up, re-pinned for safety) ---

// 10: existing signing/private-storage detection behavior is unchanged.
test("private-upload jpg/png and legacy Supabase jpeg are still recognised as images; private PDF is not", () => {
  assert.equal(isImageReference("private-upload://uploads/orders/ORD-1/mockup.jpg"), true);
  assert.equal(isImageReference("private-upload://uploads/orders/ORD-1/design.png"), true);
  assert.equal(isImageReference("https://abcxyz.supabase.co/storage/v1/object/public/uploads/orders/ORD-2/photo.jpeg"), true);
  assert.equal(isImageReference("private-upload://uploads/orders/ORD-1/artwork.pdf"), false);
});

// --- computeImageReadiness (the shared print-gating primitive) ---

test("a target with no status entry yet is pending", () => {
  const { pendingCount, ready } = computeImageReadiness([{ key: "a", ref: "a.jpg" }], {});
  assert.equal(pendingCount, 1);
  assert.equal(ready, false);
});

// 1 (Quick Print): a signed URL alone (status "loading") does not settle a target.
test("a 'loading' status entry (signed but not yet browser-loaded) is still pending", () => {
  const { ready } = computeImageReadiness(
    [{ key: "a", ref: "a.jpg" }],
    { a: { ref: "a.jpg", status: "loading" } }
  );
  assert.equal(ready, false);
});

// 6 & 8: ready and error both settle a target; error never blocks forever.
test("'ready' and 'error' both settle a target, so a failed image does not block print forever", () => {
  const readyOnly = computeImageReadiness(
    [{ key: "a", ref: "a.jpg" }, { key: "b", ref: "b.jpg" }],
    { a: { ref: "a.jpg", status: "ready" }, b: { ref: "b.jpg", status: "error" } }
  );
  assert.equal(readyOnly.pendingCount, 0);
  assert.equal(readyOnly.ready, true);
  assert.equal(readyOnly.failedCount, 1);
});

// Filter/group safety: a stale entry for a since-removed/changed reference
// never counts as settled, and a changed reference never inherits the old
// "ready" status of what used to occupy that key.
test("a status entry for a stale/changed reference does not count as settled", () => {
  const { ready, pendingCount } = computeImageReadiness(
    [{ key: "order-1", ref: "new-thumb.jpg" }],
    { "order-1": { ref: "old-thumb.jpg", status: "ready" } }
  );
  assert.equal(pendingCount, 1);
  assert.equal(ready, false);
});

test("a removed target (no longer in the list) cannot block readiness even with a stale pending entry", () => {
  const { ready, pendingCount } = computeImageReadiness(
    [],
    { "order-1": { ref: "removed.jpg", status: "loading" } }
  );
  assert.equal(pendingCount, 0);
  assert.equal(ready, true);
});

// 9: an order/target with no thumbnail at all is simply absent from the
// target list, so it can never block readiness.
test("an empty target list (nothing to load) is trivially ready", () => {
  assert.equal(computeImageReadiness([], {}).ready, true);
});

async function readSource(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

// --- SecureImage.jsx ---

test("SecureImage only reports 'ready' from the <img>'s own onLoad, never merely because a signed URL resolved", async () => {
  const source = await readSource("src/components/common/SecureImage.jsx");
  assert.match(source, /onLoad=\{\(\) => report\("ready"\)\}/);
  assert.doesNotMatch(source, /report\("ready"\)[\s\S]{0,120}useEffect/, "no effect driven by the signing hook may report ready directly");

  // The effect that runs off the signing hook's state (loading/error) must
  // only ever be capable of reporting "loading" or "error" - "ready" must
  // not appear as a literal inside that effect body.
  const signingEffectMatch = source.match(/useEffect\(\(\) => \{\s*if \(!raw\) return;[\s\S]*?\}, \[raw, eligible, loading, error, report\]\);/);
  assert.ok(signingEffectMatch, "the signing-driven status effect must be found");
  assert.doesNotMatch(signingEffectMatch[0], /"ready"/);
});

test("SecureImage onError sets a broken-image fallback state and reports 'error'", async () => {
  const source = await readSource("src/components/common/SecureImage.jsx");
  assert.match(source, /onError=\{\(\) => \{\s*setImgError\(true\);\s*report\("error"\);\s*\}\}/);
});

test("SecureImage exposes a loadingMode prop (default lazy) so print-critical callers can request eager loading", async () => {
  const source = await readSource("src/components/common/SecureImage.jsx");
  assert.match(source, /loadingMode = "lazy"/);
  assert.match(source, /loading=\{loadingMode\}/);
});

test("SecureImage's status effect (loading/error) is a useEffect, not a direct call during render", async () => {
  const source = await readSource("src/components/common/SecureImage.jsx");
  // The two calls to report(...) other than the img event handlers must be
  // inside useEffect bodies, not in the function's top-level render path.
  const beforeFirstReturn = source.slice(0, source.indexOf("if (!eligible)"));
  assert.match(beforeFirstReturn, /useEffect\(\(\) => \{[\s\S]*report\("error"\);[\s\S]*report\("loading"\);[\s\S]*\}, \[raw, eligible, loading, error, report\]\);/);
});

// --- OrderQuickPrintSheet.jsx ---

test("OrderQuickPrintSheet marks a signed URL as 'loading', not 'ready', until the <img> confirms it loaded", async () => {
  const source = await readSource("src/components/orders/drawer/OrderQuickPrintSheet.jsx");
  const thenBlock = source.match(/getSignedFileUrl\(ref, \{ expiresIn: PRINT_SIGNED_URL_TTL_SECONDS \}\)[\s\S]*?\.catch/);
  assert.ok(thenBlock, "the signing call chain must be found");
  assert.doesNotMatch(thenBlock[0].replace(/\.catch$/, ""), /status: "ready"/, "signing success must not mark the image ready by itself");
  assert.match(thenBlock[0], /status: "loading", url \}/);
});

test("OrderQuickPrintSheet's onLoad/onError handlers drive ready/error state from the actual <img>", async () => {
  const source = await readSource("src/components/orders/drawer/OrderQuickPrintSheet.jsx");
  assert.match(source, /const handleImageLoaded = \(ref, url\) => \{\s*setResolvedImages\(\(prev\) => \(\{ \.\.\.prev, \[ref\]: \{ status: "ready", url \} \}\)\);\s*\};/);
  assert.match(source, /const handleImageFailed = \(ref\) => \{\s*setResolvedImages\(\(prev\) => \(\{ \.\.\.prev, \[ref\]: \{ status: "error", url: "" \} \}\)\);\s*\};/);
  assert.match(source, /onLoad=\{\(\) => handleImageLoaded\(url, resolved\.url\)\}/);
  assert.match(source, /onError=\{\(\) => handleImageFailed\(url\)\}/);
});

test("OrderQuickPrintSheet derives print readiness from the shared computeImageReadiness primitive", async () => {
  const source = await readSource("src/components/orders/drawer/OrderQuickPrintSheet.jsx");
  assert.match(source, /import \{ computeImageReadiness \} from "@\/lib\/printReadiness";/);
  assert.match(source, /ready: imageResolutionReady \} = computeImageReadiness\(/);
  // Phase 1B.2: printReady additionally accounts for primary-image context
  // still loading - it must still be derived from imageResolutionReady,
  // never bypass it.
  assert.match(source, /const printReady = imageResolutionReady && /);
  assert.match(source, /disabled=\{!printReady\}/);
  assert.match(source, /\{printReady \? "Print" : "Preparing images\.\.\."\}/);
});

test("no React hooks are called inside a .map() callback in OrderQuickPrintSheet", async () => {
  const source = await readSource("src/components/orders/drawer/OrderQuickPrintSheet.jsx");
  const mapCallbackBodies = [...source.matchAll(/\.map\(\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\)/g)].map((m) => m[1]);
  assert.ok(mapCallbackBodies.length > 0, "at least one .map() callback body must be found");
  for (const body of mapCallbackBodies) {
    assert.doesNotMatch(body, /use[A-Z]\w*\(/, "hooks must not be called inside a .map() callback");
  }
});

// mockups-folder-first selection priority and private-reference eligibility
// (pinned again since this file changed further in this follow-up commit)
test("mockups-folder-first selection and private-reference image eligibility are unchanged", async () => {
  const source = await readSource("src/components/orders/drawer/OrderQuickPrintSheet.jsx");
  assert.doesNotMatch(source, /isPrivateFileReference/);
  assert.match(source, /const filesForMockups = mockupFiles\.length \? mockupFiles : imageFiles;/);
  assert.match(source, /const imageFiles = allFiles\.filter\(isImageReference\);/);
});

// --- Orders.jsx / OrdersProductionSummary ---

test("Active Production Summary gates its own Print button on secure thumbnail readiness", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const summaryMatch = source.match(/function OrdersProductionSummary[\s\S]*?\nfunction ProductionSummaryOrderCard/);
  assert.ok(summaryMatch, "OrdersProductionSummary function body must be found");
  const summaryBody = summaryMatch[0];

  assert.match(summaryBody, /const \{ ready: printReady \} = computeImageReadiness\(thumbnailTargets, thumbnailStatus\);/);
  assert.match(summaryBody, /disabled=\{!printReady\}/);
  assert.match(summaryBody, /\{printReady \? "Print" : "Preparing images\.\.\."\}/);

  // no-thumbnail orders must never enter the tracked target list
  assert.match(summaryBody, /\.filter\(target => target\.ref\)/);
});

test("Active Production Summary thumbnail status tracking keys by order identity and current reference (filter/group safety)", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const summaryMatch = source.match(/function OrdersProductionSummary[\s\S]*?\nfunction ProductionSummaryOrderCard/);
  const summaryBody = summaryMatch[0];
  assert.match(summaryBody, /const thumbnailTargets = summaryOrders\s*\.map\(order => \(\{\s*key: String\(order\.id \|\| order\.order_number\),\s*ref: resolveOrderPrimaryImage\(order, primaryImageContextByOrder\.get\(order\.id\) \|\| \[\]\)\.ref,\s*\}\)\)/);
});

test("ProductionSummaryOrderCard requests eager loading and reports thumbnail status upward", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const cardMatch = source.match(/function ProductionSummaryOrderCard[\s\S]*?\nfunction PrintDatum/);
  assert.ok(cardMatch, "ProductionSummaryOrderCard function body must be found");
  const cardBody = cardMatch[0];
  assert.doesNotMatch(cardBody, /<img\s+src=\{thumb\}/, "must not render the raw thumbnail reference directly into <img>");
  assert.match(cardBody, /<SecureImage[\s\S]*?loadingMode="eager"/);
  assert.match(cardBody, /onStatusChange=\{\(status\) => onThumbnailStatusChange\?\.\(thumbKey, thumb, status\)\}/);
});

// Phase 1B.2 replaced Orders.jsx's local getOrderThumbnail() with the
// shared src/lib/orderPrimaryImage.js resolver - resolveOrderPrimaryImage
// still returns the raw canonical reference: it is a pure module with no
// Supabase import at all, so it cannot sign a URL or persist anything.
test("primary-image resolution still returns the raw canonical reference - no stored-data mutation", async () => {
  const ordersSource = await readSource("src/pages/Orders.jsx");
  assert.match(ordersSource, /resolveOrderPrimaryImage\(/);
  assert.doesNotMatch(ordersSource, /function getOrderThumbnail/);
  const resolverSource = await readSource("src/lib/orderPrimaryImage.js");
  assert.doesNotMatch(resolverSource, /import .*supabase/i);
  assert.doesNotMatch(resolverSource, /\.rpc\(/);
  assert.doesNotMatch(resolverSource, /getSignedFileUrl|useSignedFileUrl/);
});

// --- persistence safety (still true after this follow-up) ---

test("signed URL resolution still never persists back to order, product, or file records", async () => {
  const secureImageSource = await readSource("src/components/common/SecureImage.jsx");
  const printSheetSource = await readSource("src/components/orders/drawer/OrderQuickPrintSheet.jsx");
  const ordersSource = await readSource("src/pages/Orders.jsx");
  const privateFilesSource = await readSource("src/lib/privateFiles.js");

  for (const source of [secureImageSource, printSheetSource]) {
    assert.doesNotMatch(source, /\.update\(/, "must not call any persistence .update(...)");
    assert.doesNotMatch(source, /\.upsert\(/, "must not call any persistence .upsert(...)");
  }
  assert.doesNotMatch(ordersSource, /file_urls\s*=\s*(?!.*extractUrls)/, "must not reassign order.file_urls outside the existing read-only extraction helper");

  assert.match(privateFilesSource, /createSignedUrl\(/);
  assert.doesNotMatch(privateFilesSource, /\.update\(/);
  assert.doesNotMatch(privateFilesSource, /\.upsert\(/);
});
