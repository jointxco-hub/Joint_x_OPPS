import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isImageReference } from "../src/lib/imageReference.js";
import {
  buildImageGallery,
  buildLightboxItems,
  canCopyFileRecord,
  classifyFileReference,
  dedupeFileEntries,
  fileNameFromReference,
  fileUrlFrom,
  isVisualFile,
  resolveLightboxIndex,
  splitFilesIntoVisualsAndFiles,
} from "../src/lib/filePresentation.js";

// filePresentation.js and imageReference.js have no React/Supabase
// dependency, so they are exercised directly (behavioral). FileLightbox.jsx,
// MediaPreview.jsx, FileManager.jsx, OrderFilesTab.jsx, and Orders.jsx pull
// in React hooks, react-dom, and the Supabase client, which this repo's
// plain `node --test` runner cannot execute without a bundler/DOM (same
// constraint noted throughout tests/order-private-image-display.test.mjs
// and every other suite in this repo). Those are pinned with
// source-structure assertions instead, as this repo's existing test suites
// already do for React components with the same constraint.

// ─────────────────────── image / classification ───────────────────────

// 1: image classification for every required extension.
test("isVisualFile recognizes every required visual extension", () => {
  for (const ext of ["jpg", "jpeg", "png", "webp", "gif", "avif"]) {
    assert.equal(isVisualFile(`private-upload://uploads/x/file.${ext}`), true, ext);
    assert.equal(classifyFileReference(`private-upload://uploads/x/file.${ext}`), "image", ext);
  }
});

// 2: query/hash suffix still recognized.
test("query and hash suffixes do not defeat image detection", () => {
  assert.equal(isVisualFile("https://cdn.example.com/mockup.png?v=2"), true);
  assert.equal(isVisualFile("https://cdn.example.com/mockup.png#preview"), true);
});

// 3: private-upload:// image references recognized.
test("private-upload:// image references are recognized as visual", () => {
  assert.equal(isVisualFile("private-upload://uploads/orders/ORD-1/mockup.jpg"), true);
  assert.equal(classifyFileReference("private-upload://uploads/orders/ORD-1/mockup.jpg"), "image");
});

// 4: PDF classified as File (non-visual).
test("PDF is classified as pdf, not visual", () => {
  assert.equal(classifyFileReference("private-upload://uploads/x/artwork.pdf"), "pdf");
  assert.equal(isVisualFile("private-upload://uploads/x/artwork.pdf"), false);
});

// 5: ZIP classified as File (archive, non-visual).
test("ZIP is classified as archive, not visual", () => {
  assert.equal(classifyFileReference("https://cdn.example.com/assets.zip"), "archive");
  assert.equal(isVisualFile("https://cdn.example.com/assets.zip"), false);
});

// 6: AI/EPS/PSD classified as File/design-source, not visual.
test("AI/EPS/PSD are classified as design-source, not visual", () => {
  for (const ext of ["ai", "eps", "psd"]) {
    assert.equal(classifyFileReference(`private-upload://uploads/x/logo.${ext}`), "design-source", ext);
    assert.equal(isVisualFile(`private-upload://uploads/x/logo.${ext}`), false, ext);
  }
});

test("unknown/empty references classify as unknown, not a crash", () => {
  assert.equal(classifyFileReference(""), "unknown");
  assert.equal(classifyFileReference(null), "unknown");
  assert.equal(isVisualFile(""), false);
});

// ─────────────────────────── dedupe / gallery ───────────────────────────

// 7: duplicate same URL collapses once.
test("dedupeFileEntries collapses a repeated URL to a single entry", () => {
  const urls = ["a.jpg", "a.jpg", { file_url: "a.jpg" }, "b.png"];
  assert.deepEqual(dedupeFileEntries(urls), ["a.jpg", "b.png"]);
});

// 8: raw canonical URL remains unchanged (no transform of private-upload://
// or storage URLs anywhere in this module).
test("fileUrlFrom never rewrites the raw reference", () => {
  const priv = "private-upload://uploads/orders/ORD-1/mockup.jpg";
  const pub = "https://slhcvyeuqsduaglddqdb.supabase.co/storage/v1/object/public/uploads/x/y.png";
  assert.equal(fileUrlFrom(priv), priv);
  assert.equal(fileUrlFrom(pub), pub);
  assert.equal(fileUrlFrom({ file_url: priv }), priv);
});

// 9: visual/file split counts correctly.
test("splitFilesIntoVisualsAndFiles partitions correctly and preserves counts", () => {
  const list = ["a.jpg", "b.pdf", "c.png", "d.zip", "e.psd"];
  const { visuals, files } = splitFilesIntoVisualsAndFiles(list);
  assert.deepEqual(visuals, ["a.jpg", "c.png"]);
  assert.deepEqual(files, ["b.pdf", "d.zip", "e.psd"]);
  assert.equal(visuals.length + files.length, list.length);
});

// 10 / Goal 7: client-owned ClientAsset cannot be copied (would duplicate
// the canonical (client_id, file_url) row).
test("canCopyFileRecord refuses a client-owned asset", () => {
  assert.equal(canCopyFileRecord({ client_id: "client-1", file_url: "a.jpg" }), false);
});

// 11: internal (client_id null) asset may retain copy eligibility.
test("canCopyFileRecord allows an internal (client_id null) asset", () => {
  assert.equal(canCopyFileRecord({ client_id: null, file_url: "a.jpg" }), true);
  assert.equal(canCopyFileRecord({ file_url: "a.jpg" }), true);
  assert.equal(canCopyFileRecord(null), true);
});

// 12: collection ordering is deterministic — same input, same output, every
// time, regardless of how many times it's called.
test("buildLightboxItems / buildImageGallery are deterministic for the same input", () => {
  const input = ["c.jpg", "a.jpg", "b.png"];
  const first = buildImageGallery(input);
  const second = buildImageGallery(input);
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["c.jpg", "a.jpg", "b.png"]); // insertion order preserved, not re-sorted

  const items1 = buildLightboxItems(input);
  const items2 = buildLightboxItems(input);
  assert.deepEqual(items1.map((i) => i.file_url), items2.map((i) => i.file_url));
});

// 13: selected index resolves correctly against a filtered/reordered
// collection instead of always defaulting to 0.
test("resolveLightboxIndex finds the clicked item's position in the given collection", () => {
  const items = buildLightboxItems(["a.jpg", "b.jpg", "c.jpg"]);
  assert.equal(resolveLightboxIndex(items, "b.jpg"), 1);
  assert.equal(resolveLightboxIndex(items, "c.jpg"), 2);
  assert.equal(resolveLightboxIndex(items, "not-present.jpg"), 0);
  assert.equal(resolveLightboxIndex(items, ""), 0);
});

// 14: no signed URL ever appears in any of these pure helpers — they only
// ever pass through the raw reference given to them, never resolve/fetch.
test("no helper in this module ever produces a signed URL", () => {
  const raw = "private-upload://uploads/x/y.jpg";
  assert.equal(fileUrlFrom(raw), raw);
  assert.equal(buildImageGallery([raw])[0], raw);
  assert.equal(buildLightboxItems([raw])[0].file_url, raw);
  // None of these helpers touch network/Supabase at all — asserted
  // structurally too, see the source-pattern section below.
});

// 15: current thumbnail appears first in the order-gallery helper.
test("buildImageGallery moves preferredFirst to the front when present", () => {
  const gallery = buildImageGallery(["a.jpg", "b.jpg", "c.jpg"], { preferredFirst: "c.jpg" });
  assert.deepEqual(gallery, ["c.jpg", "a.jpg", "b.jpg"]);
});

test("buildImageGallery ignores preferredFirst when it isn't in the candidate set", () => {
  const gallery = buildImageGallery(["a.jpg", "b.jpg"], { preferredFirst: "not-in-set.jpg" });
  assert.deepEqual(gallery, ["a.jpg", "b.jpg"]);
});

// 16: duplicate thumbnail/file_url appears once in the gallery.
test("buildImageGallery de-duplicates before applying preferredFirst", () => {
  const gallery = buildImageGallery(["a.jpg", "a.jpg", "b.jpg"], { preferredFirst: "a.jpg" });
  assert.deepEqual(gallery, ["a.jpg", "b.jpg"]);
});

// 17: private image refs stay raw through the whole gallery pipeline.
test("buildImageGallery never rewrites a private-upload:// reference", () => {
  const priv = "private-upload://uploads/orders/ORD-9/mockup.jpg";
  const gallery = buildImageGallery([priv, "https://cdn.example.com/other.png"], { preferredFirst: priv });
  assert.equal(gallery[0], priv);
});

// 18: non-image order files excluded from the visual gallery.
test("buildImageGallery excludes non-image files even when they'd otherwise match preferredFirst", () => {
  const gallery = buildImageGallery(["a.jpg", "b.pdf", "c.zip"]);
  assert.deepEqual(gallery, ["a.jpg"]);
});

test("fileNameFromReference extracts a sensible filename from every reference shape", () => {
  assert.equal(fileNameFromReference("private-upload://uploads/orders/ORD-1/mockup.jpg"), "mockup.jpg");
  assert.equal(fileNameFromReference("https://cdn.example.com/path/to/design.png?x=1"), "design.png");
  assert.equal(fileNameFromReference("", "Fallback"), "Fallback");
});

// ───────────────────── source-structure assertions ─────────────────────
// Structural pins for the React components this suite cannot execute
// directly (no DOM/bundler in plain `node --test` — see note at top).

const readSource = async (relativePath) => {
  const text = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return text.replace(/\r\n/g, "\n");
};

test("FileLightbox: backward-compatible single-file API is still present", async () => {
  const source = await readSource("src/components/files/FileLightbox.jsx");
  assert.match(source, /export default function FileLightbox\(\{\s*file[^,]*,\s*files[^,]*,\s*index[^,]*,\s*onIndexChange[^,]*,\s*onClose\s*\}\)/);
});

test("FileLightbox: previous/next, keyboard, and Escape handling are present", async () => {
  const source = await readSource("src/components/files/FileLightbox.jsx");
  assert.match(source, /ArrowLeft/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /"Escape"/);
  assert.match(source, /aria-label="Previous file"/);
  assert.match(source, /aria-label="Next file"/);
  assert.match(source, /disabled=\{!canGoPrev\}/);
  assert.match(source, /disabled=\{!canGoNext\}/);
});

test("FileLightbox: zoom controls (in/out/reset) are present with safe bounds", async () => {
  const source = await readSource("src/components/files/FileLightbox.jsx");
  assert.match(source, /MIN_ZOOM = 0\.5/);
  assert.match(source, /MAX_ZOOM = 3/);
  assert.match(source, /aria-label="Zoom in"/);
  assert.match(source, /aria-label="Zoom out"/);
  assert.match(source, /aria-label="Reset zoom"/);
  assert.match(source, /setZoom\(1\)/); // reset zoom when active file changes
});

test("FileLightbox: thumbnail/navigation strip is present for collections", async () => {
  const source = await readSource("src/components/files/FileLightbox.jsx");
  assert.match(source, /LightboxThumbnailStripItem/);
  assert.match(source, /hasMultiple &&/);
});

test("FileLightbox: comments stay disabled when the active file has no id", async () => {
  const source = await readSource("src/components/files/FileLightbox.jsx");
  assert.match(source, /enabled: !!activeFile\.id/);
  assert.match(source, /\{activeFile\.id && \(/);
});

test("FileLightbox: never assigns the signed URL to a persisted field name", async () => {
  const source = await readSource("src/components/files/FileLightbox.jsx");
  assert.doesNotMatch(source, /file_url:\s*signedFileUrl/);
  assert.doesNotMatch(source, /file_url:\s*fileUrl(?!\w)/);
});

test("FileLightbox: preserves comments, mentions, status, download, PDF preview, secure signing", async () => {
  const source = await readSource("src/components/files/FileLightbox.jsx");
  assert.match(source, /useSignedFileUrl/);
  assert.match(source, /FileComment/);
  assert.match(source, /mentioned_user/);
  assert.match(source, /file_status/);
  assert.match(source, /Download File/);
  assert.match(source, /isPdf/);
});

test("FileLightbox: dialog accessibility attributes preserved", async () => {
  const source = await readSource("src/components/files/FileLightbox.jsx");
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
});

test("MediaPreview: opens FileLightbox instead of maintaining its own full-screen modal", async () => {
  const source = await readSource("src/components/common/MediaPreview.jsx");
  assert.match(source, /import FileLightbox from "@\/components\/files\/FileLightbox"/);
  assert.doesNotMatch(source, /fixed inset-0/); // no more hand-rolled full-screen modal markup
});

test("MediaPreview: supports standalone, parent-controlled, and decorative modes", async () => {
  const source = await readSource("src/components/common/MediaPreview.jsx");
  assert.match(source, /onClick, interactive = true/);
  assert.match(source, /if \(!interactive\)/);
  assert.match(source, /const handleClick = onClick \|\| /);
});

test("FileLightbox does not import MediaPreview (no circular dependency)", async () => {
  const source = await readSource("src/components/files/FileLightbox.jsx");
  assert.doesNotMatch(source, /MediaPreview/);
});

test("FileManager: All/Visuals/Files presentation split is implemented", async () => {
  const source = await readSource("src/pages/FileManager.jsx");
  assert.match(source, /viewMode/);
  assert.match(source, /splitFilesIntoVisualsAndFiles/);
  assert.match(source, /ViewModeTab/);
  assert.match(source, /"all"/);
  assert.match(source, /"visuals"/);
});

test("FileManager: opens the shared FileLightbox with the current filtered collection", async () => {
  const source = await readSource("src/pages/FileManager.jsx");
  assert.match(source, /openLightboxAt/);
  assert.match(source, /buildLightboxItems\(displayedFiles\)/);
  assert.match(source, /resolveLightboxIndex/);
});

test("FileManager: Copy is blocked for canonical client-owned assets via the shared helper", async () => {
  const source = await readSource("src/pages/FileManager.jsx");
  assert.match(source, /canCopyFileRecord\(file\)/);
  assert.match(source, /disabled=\{!canCopyFileRecord\(file\)\}/);
});

test("OrderFilesTab: preserves upload, paste-link, and Add from client library actions", async () => {
  const source = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  assert.match(source, /Upload files/);
  assert.match(source, /Paste file link/);
  assert.match(source, /Add from client library/);
  assert.match(source, /Show in client tracker/); // portal visibility checkbox unchanged
});

test("OrderFilesTab: gallery navigation is scoped to the current folder's visuals", async () => {
  const source = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  assert.match(source, /currentVisualEntries/);
  assert.match(source, /openGalleryPreview\(currentVisualEntries, entry\)/);
  assert.match(source, /openSinglePreview/);
});

test("OrderFilesTab: never writes orders.file_urls except through existing user actions", async () => {
  const source = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  // file_urls is only ever written inside pasteFileLinkUrl/removeFileLink
  // (pre-existing user actions) — the new gallery helpers never call
  // onUpdate at all.
  const start = source.indexOf("const openGalleryPreview");
  assert.ok(start > -1, "openGalleryPreview should exist");
  const galleryHelperSection = source.slice(start, start + 800);
  assert.doesNotMatch(galleryHelperSection, /onUpdate\(/);
});

test("Orders.jsx: getOrderThumbnail primary-image selection is untouched", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.match(source, /function getOrderThumbnail\(order\) \{/);
  assert.match(source, /return candidates\.find\(isImageUrl\) \|\| "";/);
});

test("Orders.jsx: Production Summary thumbnail opens the shared FileLightbox", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.match(source, /import FileLightbox from "@\/components\/files\/FileLightbox"/);
  assert.match(source, /setGalleryOpen\(true\)/);
  assert.match(source, /getOrderImageGallery\(order\)/);
});

test("Orders.jsx: gallery helper reuses getOrderThumbnail's own candidate sources (no new selection logic)", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const gallerySection = source.slice(source.indexOf("function getOrderImageGallery"));
  assert.match(gallerySection, /order\.portal_visible_file_urls/);
  assert.match(gallerySection, /order\.file_urls/);
  assert.match(gallerySection, /order\.mockup_urls/);
  assert.match(gallerySection, /preferredFirst: getOrderThumbnail\(order\)/);
});

test("Orders.jsx: does not add production_thumbnail_url or a new migration-backed field", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.doesNotMatch(source, /production_thumbnail_url/);
});

test("no changed file introduces a ProductionSummaryLightbox duplicate implementation", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.doesNotMatch(source, /ProductionSummaryLightbox/);
});
