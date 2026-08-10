// Pure, dependency-free file/media presentation helpers shared by
// FileLightbox, MediaPreview, FileManager, OrderFilesTab, and Orders.jsx.
// No React, no Supabase — importable directly by `node --test` (see
// tests/file-gallery.test.mjs). Image detection always goes through
// imageReference.js's isImageReference() — never a second image regex.
import { isImageReference } from "./imageReference.js";

const VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|webm|avi|m4v)(\?|#|$)/i;
const PDF_EXTENSION_PATTERN = /\.pdf(\?|#|$)/i;
const DESIGN_SOURCE_EXTENSION_PATTERN = /\.(ai|eps|psd|sketch|fig|indd)(\?|#|$)/i;
const DOCUMENT_EXTENSION_PATTERN = /\.(docx?|xlsx?|csv|pptx?|rtf|txt)(\?|#|$)/i;
const ARCHIVE_EXTENSION_PATTERN = /\.(zip|rar|7z|tar|gz)(\?|#|$)/i;

// Pulls the raw canonical reference out of a plain string or a file-like
// record (ClientAsset, order file entry, invoice entry, ...). Never
// resolves or signs anything — the raw private-upload://... or storage URL
// is the identity, always.
export function fileUrlFrom(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return String(
      value.file_url || value.url || value.fileUrl || value.invoice_url || value.public_url || ""
    ).trim();
  }
  return String(value).trim();
}

// Alias kept for call sites that prefer a more explicit name.
export const normalizeFileReference = fileUrlFrom;

export function fileNameFromReference(value, fallback = "File") {
  const raw = fileUrlFrom(value);
  if (!raw) return fallback;
  try {
    const pathname = new URL(raw).pathname;
    return decodeURIComponent(pathname.split("/").filter(Boolean).pop() || fallback);
  } catch {
    // Not a parseable absolute URL (e.g. private-upload://bucket/path, or a
    // bare filename) — fall back to a plain path-segment split.
    const clean = raw.split("?")[0].split("#")[0];
    return decodeURIComponent(clean.split("/").filter(Boolean).pop() || fallback);
  }
}

// One of: "image" | "video" | "pdf" | "design-source" | "document" |
// "archive" | "file" | "unknown" (empty/unresolvable reference).
export function classifyFileReference(value) {
  const raw = fileUrlFrom(value);
  if (!raw) return "unknown";
  if (isImageReference(raw)) return "image";
  if (VIDEO_EXTENSION_PATTERN.test(raw)) return "video";
  if (PDF_EXTENSION_PATTERN.test(raw)) return "pdf";
  if (DESIGN_SOURCE_EXTENSION_PATTERN.test(raw)) return "design-source";
  if (ARCHIVE_EXTENSION_PATTERN.test(raw)) return "archive";
  if (DOCUMENT_EXTENSION_PATTERN.test(raw)) return "document";
  return "file";
}

// Visuals = images only, per the Phase 1B.1 definition ("image assets that
// can be meaningfully previewed"). Video is classified and still playable
// in FileLightbox/MediaPreview, but it does not count toward the
// Visuals/Files split in FileManager or OrderFilesTab.
export function isVisualFile(value) {
  return classifyFileReference(value) === "image";
}

// Dedupe a mixed list of strings/file-like records down to their raw URLs,
// first-occurrence order preserved, never mutating or transforming a URL.
export function dedupeFileEntries(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const url = fileUrlFrom(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function splitFilesIntoVisualsAndFiles(list) {
  const visuals = [];
  const files = [];
  for (const item of Array.isArray(list) ? list : []) {
    (isVisualFile(item) ? visuals : files).push(item);
  }
  return { visuals, files };
}

// Builds the minimal shape FileLightbox's collection API needs from
// arbitrary file-like records or plain URLs. Never includes a signed URL —
// only the raw canonical reference plus display metadata.
//
// Identity is never invented. `id` (and `tenant_id`) are only ever carried
// through from a real, already-persisted record — a plain URL string, or
// any input with `preserveIdentity: false`, always comes out with `id`
// undefined. This matters because FileLightbox uses `!!activeFile.id` to
// decide whether a file is commentable (FileComment rows are keyed off a
// real ClientAsset id) — a synthetic id here would make an arbitrary order
// file URL look "commentable" by accident. `preserveIdentity: false` exists
// for callers whose input objects carry a UI-only identifier that is NOT a
// database id (e.g. OrderFilesTab's `file:${url}` / `copy-${...}` entry
// ids) — passing those straight through as `id` would be exactly the same
// mistake as inventing one. If a caller needs a React list key, it should
// build one locally (e.g. from `file_url` or its own loop index) rather
// than relying on this function's `id`.
/**
 * @param {any[]} list
 * @param {{ titleFrom?: (item: any, index: number) => string, preserveIdentity?: boolean }} [options]
 */
export function buildLightboxItems(list, { titleFrom, preserveIdentity = true } = {}) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => {
      const url = fileUrlFrom(item);
      const record = typeof item === "object" && item !== null ? item : {};
      const title =
        (typeof titleFrom === "function" ? titleFrom(item, index) : null) ||
        record.title ||
        record.name ||
        record.file_name ||
        fileNameFromReference(url, `File ${index + 1}`);
      return {
        id: preserveIdentity ? (record.id || undefined) : undefined,
        file_url: url,
        title,
        file_type: record.file_type || record.mime_type || record.type || "",
        tenant_id: preserveIdentity ? (record.tenant_id || undefined) : undefined,
      };
    })
    .filter((item) => item.file_url);
}

// Deduped, visuals-only gallery from a flat list of URL/file-like
// candidates, with `preferredFirst` (when present in the set) moved to the
// front — used to keep an order's currently-selected thumbnail first in its
// gallery without changing which URL is selected as that thumbnail.
export function buildImageGallery(candidates, { preferredFirst = "" } = {}) {
  const deduped = dedupeFileEntries(candidates).filter(isVisualFile);
  if (preferredFirst && deduped.includes(preferredFirst)) {
    return [preferredFirst, ...deduped.filter((url) => url !== preferredFirst)];
  }
  return deduped;
}

// Resolves a starting index for a lightbox collection from whichever item
// was actually clicked, so a filtered/reordered collection (e.g. after a
// search) still opens on the right item instead of always index 0.
export function resolveLightboxIndex(items, clickedRef) {
  const clickedUrl = fileUrlFrom(clickedRef);
  if (!clickedUrl) return 0;
  const index = (Array.isArray(items) ? items : []).findIndex((item) => fileUrlFrom(item) === clickedUrl);
  return index >= 0 ? index : 0;
}

// Bounds how many thumbnail-strip items FileLightbox mounts at once, so
// opening a large collection doesn't fire a signing request per item all at
// once. Returns a slice of `items` centered on `activeIndex` (clamped to
// the collection's start/end) plus `startIndex`, the absolute index of the
// slice's first element — callers need that to map a click on a windowed
// thumbnail back to the real collection index, and to know which windowed
// item is the active one. No virtualization dependency; a plain slice.
export function getThumbnailWindow(items, activeIndex, maxVisible = 12) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  if (total <= maxVisible) {
    return { items: list.slice(), startIndex: 0 };
  }
  const half = Math.floor(maxVisible / 2);
  let start = Math.min(Math.max(activeIndex, 0), total - 1) - half;
  let end = start + maxVisible;
  if (start < 0) {
    start = 0;
    end = maxVisible;
  }
  if (end > total) {
    end = total;
    start = end - maxVisible;
  }
  return { items: list.slice(start, end), startIndex: start };
}

const EDITABLE_TAG_NAMES = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// Whether a keyboard event's target is something a user could be typing
// into / moving a text cursor within — used so FileLightbox's ArrowLeft/
// ArrowRight gallery navigation never hijacks normal editing (e.g. moving
// the cursor inside the comment textarea, or changing a <select>). Escape
// is intentionally NOT gated by this — it should always be able to close
// the lightbox. Accepts a plain object (not necessarily a real DOM node),
// so it's directly testable without a DOM.
export function isEditableKeyboardTarget(target) {
  if (!target) return false;
  const tagName = typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
  if (EDITABLE_TAG_NAMES.has(tagName)) return true;
  return Boolean(target.isContentEditable);
}

// A ClientAsset row can collide against TWO separate unique indexes if
// copied — idx_client_assets_client_file_url_unique (client_id, file_url)
// for a client-owned row, and idx_client_assets_order_file_url_unique
// (order_id, file_url) for a legacy row that still carries a non-null
// order_id even though client_id is null. Copying one would try to insert
// a second row that collides on whichever of those the source row already
// satisfies. Move (repointing folder_id on the same row) or "Add from
// client library" (reusing the same row on another order) are the safe
// equivalents. Only a truly internal/unowned asset — client_id AND
// order_id both null/empty — may still be copied/linked into another
// folder via File Manager's existing Copy action.
//
// Fails CLOSED for missing/malformed input: a null/undefined/non-object
// `file` returns false, not true. The defensive guard at FileManager's
// copy mutation boundary relies on this — if a missing file were treated
// as "eligible", the guard would pass through and the mutation would go
// on to crash reading file.title/file_url anyway. Refusing up front is
// the safe failure mode.
export function canCopyFileRecord(file) {
  if (!file || typeof file !== "object") return false;
  return !file.client_id && !file.order_id;
}
