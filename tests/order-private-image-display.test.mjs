import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isImageReference } from "../src/lib/imageReference.js";

// isImageReference has no React/Supabase dependency, so it is exercised
// directly (behavioral). SecureImage.jsx and OrderQuickPrintSheet.jsx pull in
// React hooks and the Supabase client, which this repo's plain `node --test`
// runner cannot execute without a bundler/DOM (see the same constraint noted
// in order-invoice-sync.test.mjs and invoice-reliability.test.mjs). Those are
// pinned with source-structure assertions instead, as this repo's existing
// test suites already do for React components with the same constraint.

// 1 & 2: private-upload:// image references are recognised as images.
test("private-upload jpg and png references are recognised as images", () => {
  assert.equal(isImageReference("private-upload://uploads/orders/ORD-1/mockup.jpg"), true);
  assert.equal(isImageReference("private-upload://uploads/orders/ORD-1/design.png"), true);
});

// 3: legacy Supabase public storage URLs are recognised as images.
test("legacy Supabase uploads .jpeg URL is recognised as an image", () => {
  const url = "https://abcxyz.supabase.co/storage/v1/object/public/uploads/orders/ORD-2/photo.jpeg";
  assert.equal(isImageReference(url), true);
});

// 4: a private PDF is not treated as an image.
test("a private PDF reference is not recognised as an image", () => {
  assert.equal(isImageReference("private-upload://uploads/orders/ORD-1/artwork.pdf"), false);
});

test("image detection covers webp, gif, avif and ignores query/hash suffixes; extensionless/PDF references fail", () => {
  assert.equal(isImageReference("private-upload://uploads/a/b.webp"), true);
  assert.equal(isImageReference("private-upload://uploads/a/b.gif"), true);
  assert.equal(isImageReference("private-upload://uploads/a/b.avif"), true);
  assert.equal(isImageReference("https://cdn.example.com/a/b.PNG?x=1"), true);
  assert.equal(isImageReference("https://cdn.example.com/a/b.jpg#preview"), true);
  assert.equal(isImageReference(""), false);
  assert.equal(isImageReference("private-upload://uploads/a/b"), false);
});

async function readSource(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

// 5: Active Production Summary no longer feeds a raw canonical reference
// straight into <img src>; it must resolve through SecureImage instead.
test("ProductionSummaryOrderCard renders the thumbnail through SecureImage, not a raw <img src={thumb}>", async () => {
  const ordersSource = await readSource("src/pages/Orders.jsx");
  assert.match(ordersSource, /import SecureImage from "@\/components\/common\/SecureImage";/);

  const cardMatch = ordersSource.match(/function ProductionSummaryOrderCard[\s\S]*?\nfunction PrintDatum/);
  assert.ok(cardMatch, "ProductionSummaryOrderCard function body must be found");
  const cardBody = cardMatch[0];
  assert.doesNotMatch(cardBody, /<img\s+src=\{thumb\}/, "must not render the raw thumbnail reference directly into <img>");
  assert.match(cardBody, /<SecureImage[\s\S]*?value=\{thumb\}/, "must resolve the thumbnail through SecureImage");

  // getOrderThumbnail must still return the raw canonical reference - no
  // stored-data mutation, only display-time resolution changes.
  assert.match(ordersSource, /function getOrderThumbnail\(order\) \{/);
});

// 6: OrderQuickPrintSheet must not exclude a file merely because it is a
// recognised private reference - image eligibility is extension-based only.
test("OrderQuickPrintSheet image detection no longer excludes private references", async () => {
  const printSheetSource = await readSource("src/components/orders/drawer/OrderQuickPrintSheet.jsx");
  assert.doesNotMatch(
    printSheetSource,
    /isPrivateFileReference/,
    "isPrivateFileReference must not gate image eligibility anymore"
  );
  assert.match(printSheetSource, /import \{ isImageReference \} from "@\/lib\/imageReference";/);
  assert.match(printSheetSource, /const imageFiles = allFiles\.filter\(isImageReference\);/);
  assert.match(printSheetSource, /isImageReference\(url\) \?/, "per-file render branch must use isImageReference");

  // A private image reference passes the same isImageReference() call the
  // component uses for both the imageFiles fallback list and the per-file
  // image/filename-card branch (proven directly against real inputs).
  const privateRef = "private-upload://uploads/orders/ORD-9/mockup.jpg";
  assert.equal(isImageReference(privateRef), true);
});

// 8: mockups-folder-first selection priority is unchanged.
test("mockups-folder-first selection priority is preserved verbatim", async () => {
  const printSheetSource = await readSource("src/components/orders/drawer/OrderQuickPrintSheet.jsx");
  assert.match(
    printSheetSource,
    /const mockupFiles = allFiles\.filter\(\(url\) => metadata\.fileFolders\?\.\[url\] === "mockups"\);/
  );
  assert.match(
    printSheetSource,
    /const filesForMockups = mockupFiles\.length \? mockupFiles : imageFiles;/
  );
});

// 7: signed URLs are runtime-only display values, never written back to
// order/product/file records.
test("signed URL resolution never persists back to order, product, or file records", async () => {
  const secureImageSource = await readSource("src/components/common/SecureImage.jsx");
  const printSheetSource = await readSource("src/components/orders/drawer/OrderQuickPrintSheet.jsx");
  const privateFilesSource = await readSource("src/lib/privateFiles.js");

  for (const source of [secureImageSource, printSheetSource]) {
    assert.doesNotMatch(source, /\.update\(/, "must not call any persistence .update(...)");
    assert.doesNotMatch(source, /\.upsert\(/, "must not call any persistence .upsert(...)");
    assert.doesNotMatch(source, /file_urls\s*=/, "must not reassign order.file_urls");
    assert.doesNotMatch(source, /portal_visible_file_urls\s*=/, "must not reassign portal_visible_file_urls");
    assert.doesNotMatch(source, /mockup_urls\s*=/, "must not reassign mockup_urls");
  }

  // getSignedFileUrl itself only reads from storage and caches the URL value
  // in-memory (an in-process Map) - it never writes to the database.
  assert.match(privateFilesSource, /createSignedUrl\(/);
  assert.doesNotMatch(privateFilesSource, /\.update\(/);
  assert.doesNotMatch(privateFilesSource, /\.upsert\(/);
});

// 9 & 10: a failed image does not fail the whole print view, and print is
// gated on in-flight resolution (not on failures) so it re-enables once
// resolution settles either way.
test("print readiness is gated on pending resolution only; failures settle without blocking print or other images", async () => {
  const printSheetSource = await readSource("src/components/orders/drawer/OrderQuickPrintSheet.jsx");

  assert.match(
    printSheetSource,
    /const pendingImageCount = imageTargets\.filter\(\(ref\) => resolvedImages\[ref\]\?\.status !== "ready" && resolvedImages\[ref\]\?\.status !== "error"\)\.length;/,
    "an errored image must count as settled, not pending"
  );
  assert.match(printSheetSource, /const printReady = pendingImageCount === 0;/);
  assert.match(printSheetSource, /disabled=\{!printReady\}/);
  assert.match(printSheetSource, /\{printReady \? "Print" : "Preparing images\.\.\."\}/);

  // A rejected getSignedFileUrl() call is caught per-file and marked
  // "error" in local state rather than thrown/unhandled, so one bad file
  // cannot crash the render of the rest of the grid.
  assert.match(
    printSheetSource,
    /\.catch\(\(\) => \{[\s\S]*?status: "error"/,
    "a failed signed-URL resolution must be caught and marked as an error state, not thrown"
  );
  assert.match(printSheetSource, /failedImageCount/, "a failed-count surface must exist for the user");
});

test("no React hooks are called inside a .map() callback in OrderQuickPrintSheet", async () => {
  const printSheetSource = await readSource("src/components/orders/drawer/OrderQuickPrintSheet.jsx");
  const mapCallbackBodies = [...printSheetSource.matchAll(/\.map\(\([^)]*\)\s*=>\s*\{([\s\S]*?)\n {6}\}\)/g)].map((m) => m[1]);
  for (const body of mapCallbackBodies) {
    assert.doesNotMatch(body, /use[A-Z]\w*\(/, "hooks must not be called inside a .map() callback");
  }
});

test("SecureImage resolves through useSignedFileUrl and never renders the raw unresolved reference as <img src>", async () => {
  const secureImageSource = await readSource("src/components/common/SecureImage.jsx");
  assert.match(secureImageSource, /import \{ useSignedFileUrl \} from "@\/lib\/privateFiles";/);
  assert.match(secureImageSource, /const \{ url, loading, error \} = useSignedFileUrl\(/);
  assert.doesNotMatch(secureImageSource, /<img\s+src=\{value\}/, "must never render the raw prop value directly");
  assert.match(secureImageSource, /<img[\s\S]*?src=\{url\}/, "must render the resolved signed URL");
  assert.match(secureImageSource, /onError=\{\(\) => setImgError\(true\)\}/, "onError must fall back cleanly instead of leaving a broken <img>");
});
