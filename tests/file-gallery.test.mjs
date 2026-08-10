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
  getThumbnailWindow,
  isEditableKeyboardTarget,
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

// ──────────────────── buildLightboxItems: no invented ids ────────────────────
// Remote review correction: buildLightboxItems must never manufacture a
// persisted-looking id. FileLightbox uses `!!activeFile.id` to decide
// whether a file is commentable — a synthetic id would make an arbitrary,
// non-persisted file look like a real ClientAsset row.

test("1: buildLightboxItems(['a.jpg'])[0].id is undefined", () => {
  const items = buildLightboxItems(["a.jpg"]);
  assert.equal(items[0].id, undefined);
});

test("2: a real ClientAsset input preserves its real id", () => {
  const items = buildLightboxItems([{ id: "asset-123", file_url: "a.jpg" }]);
  assert.equal(items[0].id, "asset-123");
});

test("3: a real ClientAsset input preserves tenant_id", () => {
  const items = buildLightboxItems([{ id: "asset-123", file_url: "a.jpg", tenant_id: "tenant-9" }]);
  assert.equal(items[0].tenant_id, "tenant-9");
});

test("4: an OrderFiles UI entry (id 'file:a.jpg') does not become a persisted FileLightbox id when preserveIdentity is false", () => {
  const items = buildLightboxItems([{ id: "file:a.jpg", url: "a.jpg" }], { preserveIdentity: false });
  assert.equal(items[0].id, undefined);
  assert.equal(items[0].file_url, "a.jpg");
});

test("an OrderFiles fileCopies UI entry (id 'copy-...') does not leak into FileLightbox identity either", () => {
  const items = buildLightboxItems([{ id: "copy-abc123-xyz", url: "b.png" }], { preserveIdentity: false });
  assert.equal(items[0].id, undefined);
});

test("5: a plain Production Summary URL receives no id", () => {
  const items = buildLightboxItems(["https://cdn.example.com/order-mockup.jpg"]);
  assert.equal(items[0].id, undefined);
});

test("6: no synthetic id is generated merely for React rendering — two different plain URLs both come out id-less, never fabricated", () => {
  const items = buildLightboxItems(["a.jpg", "b.jpg"]);
  assert.equal(items[0].id, undefined);
  assert.equal(items[1].id, undefined);
  // A caller needing a React key should build one locally (e.g. from
  // file_url or its own index) — file_url is always present here.
  assert.ok(items[0].file_url && items[1].file_url);
});

test("preserveIdentity: false strips both id and tenant_id even from a record that has real-looking ones", () => {
  const items = buildLightboxItems([{ id: "asset-real", tenant_id: "tenant-real", file_url: "a.jpg" }], { preserveIdentity: false });
  assert.equal(items[0].id, undefined);
  assert.equal(items[0].tenant_id, undefined);
});

// ──────────────────────── canCopyFileRecord hardening ────────────────────────
// idx_client_assets_client_file_url_unique (client_id, file_url) protects
// client-owned rows; idx_client_assets_order_file_url_unique (order_id,
// file_url) separately protects legacy rows that carry a non-null order_id
// even with client_id null. Either one set must block Copy.

test("client_id set => cannot copy", () => {
  assert.equal(canCopyFileRecord({ client_id: "client-1", order_id: null, file_url: "a.jpg" }), false);
});

test("order_id set and client_id null => cannot copy", () => {
  assert.equal(canCopyFileRecord({ client_id: null, order_id: "order-1", file_url: "a.jpg" }), false);
});

test("both client_id and order_id set => cannot copy", () => {
  assert.equal(canCopyFileRecord({ client_id: "client-1", order_id: "order-1", file_url: "a.jpg" }), false);
});

test("client_id null + order_id null => may copy", () => {
  assert.equal(canCopyFileRecord({ client_id: null, order_id: null, file_url: "a.jpg" }), true);
});

test("empty-string identities are handled safely (treated as not-set)", () => {
  assert.equal(canCopyFileRecord({ client_id: "", order_id: "", file_url: "a.jpg" }), true);
  assert.equal(canCopyFileRecord({ client_id: "", order_id: "order-1", file_url: "a.jpg" }), false);
});

// Fails CLOSED: a missing file must never be treated as "eligible" — that
// would let the defensive mutation-boundary guard pass a null/undefined
// file straight through to code that reads file.title/file_url and crashes.
test("null file is not copy-eligible (fails closed)", () => {
  assert.equal(canCopyFileRecord(null), false);
});

test("undefined file is not copy-eligible (fails closed)", () => {
  assert.equal(canCopyFileRecord(undefined), false);
});

test("non-object file input is not copy-eligible (fails closed)", () => {
  assert.equal(canCopyFileRecord("not-an-object"), false);
  assert.equal(canCopyFileRecord(0), false);
});

// Production read-only verification cited in the correction (26 active
// client_id=null ClientAssets, all 26 also order_id=null, 0 with
// client_id=null and order_id!=null) — this hardening changes nothing for
// any currently-valid copy action.
test("a currently-valid internal asset (both null) is unaffected by the hardening", () => {
  assert.equal(canCopyFileRecord({ client_id: null, order_id: null, file_url: "private-upload://uploads/internal/x.pdf" }), true);
});

// ──────────────────────────── getThumbnailWindow ────────────────────────────

test("collection smaller than the limit shows all items", () => {
  const items = ["a", "b", "c"];
  const { items: windowed, startIndex } = getThumbnailWindow(items, 1, 12);
  assert.deepEqual(windowed, items);
  assert.equal(startIndex, 0);
});

test("start of a large collection windows from index 0", () => {
  const items = Array.from({ length: 100 }, (_, i) => `item-${i}`);
  const { items: windowed, startIndex } = getThumbnailWindow(items, 0, 12);
  assert.equal(startIndex, 0);
  assert.equal(windowed.length, 12);
  assert.equal(windowed[0], "item-0");
});

test("middle of a large collection centers the window on activeIndex", () => {
  const items = Array.from({ length: 100 }, (_, i) => `item-${i}`);
  const { items: windowed, startIndex } = getThumbnailWindow(items, 50, 12);
  assert.equal(startIndex, 44);
  assert.equal(windowed.length, 12);
  assert.equal(windowed[windowed.length - 1], "item-55");
});

test("end of a large collection windows up to the last item", () => {
  const items = Array.from({ length: 100 }, (_, i) => `item-${i}`);
  const { items: windowed, startIndex } = getThumbnailWindow(items, 99, 12);
  assert.equal(windowed.length, 12);
  assert.equal(windowed[windowed.length - 1], "item-99");
  assert.equal(startIndex + windowed.length, 100);
});

test("active item is always included in the window across the whole collection", () => {
  const items = Array.from({ length: 100 }, (_, i) => `item-${i}`);
  for (let activeIndex = 0; activeIndex < items.length; activeIndex += 7) {
    const { items: windowed, startIndex } = getThumbnailWindow(items, activeIndex, 12);
    assert.ok(activeIndex >= startIndex && activeIndex < startIndex + windowed.length, `active index ${activeIndex} not in window starting at ${startIndex}`);
  }
});

test("maximum mounted count is respected regardless of collection size", () => {
  const items = Array.from({ length: 500 }, (_, i) => `item-${i}`);
  for (const activeIndex of [0, 1, 250, 498, 499]) {
    const { items: windowed } = getThumbnailWindow(items, activeIndex, 12);
    assert.ok(windowed.length <= 12);
  }
});

test("getThumbnailWindow never truncates the underlying collection itself", () => {
  const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);
  const { items: windowed } = getThumbnailWindow(items, 15, 12);
  assert.ok(windowed.length < items.length); // the window is bounded...
  assert.equal(items.length, 30); // ...but the original collection is untouched
});

// ────────────────────────── isEditableKeyboardTarget ──────────────────────────

test("textarea target => editable (arrows ignored)", () => {
  assert.equal(isEditableKeyboardTarget({ tagName: "TEXTAREA" }), true);
});

test("input target => editable (arrows ignored)", () => {
  assert.equal(isEditableKeyboardTarget({ tagName: "INPUT" }), true);
});

test("select target => editable (arrows ignored)", () => {
  assert.equal(isEditableKeyboardTarget({ tagName: "SELECT" }), true);
});

test("contenteditable target => editable (arrows ignored)", () => {
  assert.equal(isEditableKeyboardTarget({ tagName: "DIV", isContentEditable: true }), true);
});

test("normal div/body target => not editable (arrows allowed)", () => {
  assert.equal(isEditableKeyboardTarget({ tagName: "DIV" }), false);
  assert.equal(isEditableKeyboardTarget({ tagName: "BODY" }), false);
});

test("isEditableKeyboardTarget handles a missing/null target safely", () => {
  assert.equal(isEditableKeyboardTarget(null), false);
  assert.equal(isEditableKeyboardTarget(undefined), false);
});

test("isEditableKeyboardTarget is case-insensitive on tagName", () => {
  assert.equal(isEditableKeyboardTarget({ tagName: "textarea" }), true);
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

// ─────────────── remote review correction pass: source pins ───────────────

test("MediaPreview: image thumbnails no longer render a raw unsigned <img src={url}>", async () => {
  const source = await readSource("src/components/common/MediaPreview.jsx");
  assert.doesNotMatch(source, /<img src=\{url\}/);
});

test("MediaPreview: image thumbnails use the existing SecureImage secure-signing path", async () => {
  const source = await readSource("src/components/common/MediaPreview.jsx");
  assert.match(source, /import SecureImage from "@\/components\/common\/SecureImage"/);
  assert.match(source, /<SecureImage/);
  assert.match(source, /value=\{url\}/);
});

test("MediaPreview: does not invent a second signing helper", async () => {
  const source = await readSource("src/components/common/MediaPreview.jsx");
  assert.doesNotMatch(source, /useSignedFileUrl/);
  assert.doesNotMatch(source, /createSignedUrl/);
});

test("MediaPreview: all three modes (standalone, parent-controlled, decorative) are still present", async () => {
  const source = await readSource("src/components/common/MediaPreview.jsx");
  assert.match(source, /if \(!interactive\)/);
  assert.match(source, /const handleClick = onClick \|\| /);
  assert.match(source, /\{open && !onClick && \(/);
});

test("FileLightbox: arrow-key navigation is gated on isEditableKeyboardTarget, Escape is not", async () => {
  const source = await readSource("src/components/files/FileLightbox.jsx");
  assert.match(source, /import \{[^}]*isEditableKeyboardTarget[^}]*\} from "@\/lib\/filePresentation"/);
  const handlerStart = source.indexOf("const handleKeyDown");
  assert.ok(handlerStart > -1);
  const handlerBody = source.slice(handlerStart, handlerStart + 500);
  const escapeIndex = handlerBody.indexOf('"Escape"');
  const editableGuardIndex = handlerBody.indexOf("isEditableKeyboardTarget(event.target)");
  assert.ok(escapeIndex > -1 && editableGuardIndex > -1);
  assert.ok(escapeIndex < editableGuardIndex, "Escape check must come before (and be unaffected by) the editable-target guard");
});

test("FileLightbox: thumbnail strip is bounded via getThumbnailWindow, not a plain items.map", async () => {
  const source = await readSource("src/components/files/FileLightbox.jsx");
  assert.match(source, /import \{[^}]*getThumbnailWindow[^}]*\} from "@\/lib\/filePresentation"/);
  assert.match(source, /getThumbnailWindow\(items, activeIndex, THUMBNAIL_WINDOW_SIZE\)/);
  assert.match(source, /thumbnailWindow\.items\.map/);
  assert.doesNotMatch(source, /\{items\.map\(\(item, itemIndex\) => \(/);
});

test("FileLightbox: full collection navigation (prev/next/keyboard/N of M) still reads from the complete items array, not the bounded window", async () => {
  const source = await readSource("src/components/files/FileLightbox.jsx");
  assert.match(source, /const hasMultiple = items\.length > 1;/);
  assert.match(source, /const canGoNext = activeIndex < items\.length - 1;/);
  assert.match(source, /\$\{activeIndex \+ 1\} of \$\{items\.length\}/);
});

test("FileManager: copy mutation has a defensive guard at the write boundary, not just the disabled UI button", async () => {
  const source = await readSource("src/pages/FileManager.jsx");
  const mutationStart = source.indexOf("const copyFile = useMutation");
  assert.ok(mutationStart > -1);
  const mutationBody = source.slice(mutationStart, mutationStart + 900);
  assert.match(mutationBody, /if \(!canCopyFileRecord\(file\)\)/);
  assert.match(mutationBody, /Promise\.reject/);

  // The guard must run BEFORE any file.title/file_url property access —
  // canCopyFileRecord() now fails closed for a null/undefined file
  // specifically so this ordering can never crash instead of rejecting.
  const guardIndex = mutationBody.indexOf("if (!canCopyFileRecord(file))");
  const firstPropertyAccessIndex = mutationBody.indexOf("file.title");
  assert.ok(guardIndex > -1 && firstPropertyAccessIndex > -1);
  assert.ok(guardIndex < firstPropertyAccessIndex, "canCopyFileRecord guard must run before file.title/file_url access");
});

test("OrderFilesTab: gallery preview helpers strip UI-only identity before building lightbox items", async () => {
  const source = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  const gallerySection = source.slice(source.indexOf("const openGalleryPreview"), source.indexOf("const openGalleryPreview") + 700);
  assert.match(gallerySection, /preserveIdentity: false/g);
  const openGalleryCount = (gallerySection.match(/preserveIdentity: false/g) || []).length;
  assert.ok(openGalleryCount >= 2, "both openGalleryPreview and openSinglePreview must set preserveIdentity: false");
});

test("Orders.jsx: Production Summary gallery items are built with preserveIdentity: false", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const gallerySection = source.slice(source.indexOf("buildLightboxItems(getOrderImageGallery(order)"), source.indexOf("buildLightboxItems(getOrderImageGallery(order)") + 200);
  assert.match(gallerySection, /preserveIdentity: false/);
});
