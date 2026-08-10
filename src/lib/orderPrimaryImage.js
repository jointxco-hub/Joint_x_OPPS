// Pure, dependency-light Order Primary Image resolver. No React, no
// Supabase - importable directly by `node --test` (see
// tests/order-primary-image.test.mjs). Image detection always goes
// through filePresentation.js's isVisualFile()/imageReference.js's
// isImageReference() - never a second image regex.
//
// A "context row" is one row returned by the get_order_primary_image_context
// RPC (supabase/migrations/202608100001_order_primary_image.sql):
//   { order_id, asset_id, file_url, file_type, folder_id, folder_name,
//     folder_kind, asset_client_id, asset_tenant_id }
// Every row already represents a ClientAsset whose file_url is CURRENTLY
// present in the order's file_urls (server-side join on
// client_assets.file_url = ANY(orders.file_urls) + matching
// client_id/tenant_id) - client_assets.order_id is never the linkage
// signal, here or anywhere else this module is used.
import { buildImageGallery, isVisualFile } from "./filePresentation.js";

function extractUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") return [value];
  return [];
}

function getOrderProductImageUrls(order) {
  const products = Array.isArray(order?.products)
    ? order.products
    : Array.isArray(order?.items)
      ? order.items
      : [];
  return products.flatMap((product) =>
    extractUrls([product?.image_url, product?.image, product?.thumbnail_url, product?.thumbnail])
  );
}

// Groups a flat list of context rows (as returned by a batched RPC call
// across many orders) by order_id, for callers resolving primary images
// for a whole page of orders in one round trip.
export function groupPrimaryImageContextByOrder(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.order_id) continue;
    const list = map.get(row.order_id) || [];
    list.push(row);
    map.set(row.order_id, list);
  }
  return map;
}

// "Canonical Mockups" requires BOTH signals, not folder name alone: a
// real client-category folder (folder_kind === "client_category" - the
// kind provision_order_asset_folders' category subfolders carry in
// production, confirmed via a read-only production metadata check) named
// Mockups (case-insensitive). Folder name alone would let an unrelated
// legacy folder that merely happens to be titled "Mockups" silently
// become the automatic production primary. This is never the separate,
// order-local, UI-only order.order_file_folders.fileFolders[url] ===
// "mockups" tag OrderFilesTab's ad-hoc folder view uses for its own
// display grouping - that tag never reaches a context row at all.
function isCanonicalMockup(row) {
  return row?.folder_kind === "client_category"
    && typeof row?.folder_name === "string"
    && row.folder_name.trim().toLowerCase() === "mockups";
}

// A context row is only a legitimate primary-image candidate if it is
// actually this order's own client/tenant's asset, currently linked to
// the order (its file_url is present in order.file_urls), not archived,
// and its file is a visual/image reference.
//
// The RPC's own join already guarantees client/tenant match, current
// file_urls linkage, and non-archived status server-side - every check
// here is re-verified anyway. This is defense in depth: the only check
// available at all for a caller that assembles rows itself (e.g. a test,
// or a future non-RPC source) rather than trusting every row blindly.
// is_archived/asset_is_archived aren't fields the real RPC's rows carry
// (archived rows are excluded before they'd ever have one), but a
// synthetic/future row that does carry either name is still rejected
// rather than silently trusted.
export function isSelectablePrimaryCandidate(order, row) {
  if (!row || !row.file_url) return false;
  if (row.is_archived === true || row.asset_is_archived === true) return false;
  if (!isVisualFile(row.file_url)) return false;
  if (row.asset_client_id !== order?.client_id) return false;
  if (row.asset_tenant_id !== order?.tenant_id) return false;
  const fileUrls = extractUrls(order?.file_urls);
  if (!fileUrls.includes(row.file_url)) return false;
  return true;
}

export function getSelectablePrimaryCandidates(order, contextRowsForOrder) {
  return (Array.isArray(contextRowsForOrder) ? contextRowsForOrder : [])
    .filter((row) => isSelectablePrimaryCandidate(order, row));
}

// Presentation-layer mirror of the DB trigger's checks - gives the UI
// immediate feedback before the round trip, without duplicating
// server-side authority (the trigger is still the real gate).
export function validateExplicitPrimary(order, contextRowsForOrder, assetId) {
  if (!assetId) return false;
  const row = (Array.isArray(contextRowsForOrder) ? contextRowsForOrder : []).find((r) => r.asset_id === assetId);
  return isSelectablePrimaryCandidate(order, row);
}

// Required priority (portal_visible_file_urls / account_visible_file_urls
// never participate - primary is an internal production role, entirely
// separate from client-facing visibility/publishing):
//   1. valid explicit order.primary_image_asset_id
//   2. first canonical Mockups ClientAsset, in orders.file_urls order
//      (never arbitrary row/RPC order)
//   3. first product image
//   4. first other image in orders.file_urls
//   5. legacy order.mockup_urls image, compatibility fallback only
//   6. "" (no image available)
export function resolveOrderPrimaryImage(order, contextRowsForOrder = []) {
  const rows = Array.isArray(contextRowsForOrder) ? contextRowsForOrder : [];
  const fileUrls = extractUrls(order?.file_urls);

  if (order?.primary_image_asset_id) {
    const explicit = rows.find((r) => r.asset_id === order.primary_image_asset_id);
    if (isSelectablePrimaryCandidate(order, explicit)) {
      return { ref: explicit.file_url, assetId: explicit.asset_id, source: "explicit" };
    }
  }

  const mockupRows = rows.filter((r) => isCanonicalMockup(r) && isSelectablePrimaryCandidate(order, r));
  if (mockupRows.length > 0) {
    const deterministic = fileUrls
      .map((url) => mockupRows.find((r) => r.file_url === url))
      .filter(Boolean);
    const first = deterministic[0] || mockupRows[0];
    return { ref: first.file_url, assetId: first.asset_id, source: "canonical-mockups" };
  }

  const productImage = getOrderProductImageUrls(order).find(isVisualFile);
  if (productImage) {
    return { ref: productImage, assetId: null, source: "product" };
  }

  const otherImage = fileUrls.find(isVisualFile);
  if (otherImage) {
    return { ref: otherImage, assetId: null, source: "order-file" };
  }

  const legacyImage = extractUrls(order?.mockup_urls).find(isVisualFile);
  if (legacyImage) {
    return { ref: legacyImage, assetId: null, source: "legacy-mockup-urls" };
  }

  return { ref: "", assetId: null, source: "none" };
}

export function getOrderPrimaryImageRef(order, contextRowsForOrder = []) {
  return resolveOrderPrimaryImage(order, contextRowsForOrder).ref;
}

// Primary-first, deduped gallery of every relevant order image - backs
// Production Summary and Quick Print. Built from exactly the same sources
// as resolveOrderPrimaryImage, via the shared buildImageGallery helper -
// no second dedup/ordering implementation.
export function buildOrderPrimaryImageGallery(order, contextRowsForOrder = []) {
  const rows = Array.isArray(contextRowsForOrder) ? contextRowsForOrder : [];
  const primary = resolveOrderPrimaryImage(order, rows);
  const candidates = [
    primary.ref,
    ...rows.filter((r) => isSelectablePrimaryCandidate(order, r)).map((r) => r.file_url),
    ...extractUrls(order?.file_urls),
    ...getOrderProductImageUrls(order),
    ...extractUrls(order?.mockup_urls),
  ];
  return buildImageGallery(candidates, { preferredFirst: primary.ref });
}

// Decides whether removing a real (non-alias) file link should also clear
// the order's selected primary, so the caller can submit ONE atomic order
// patch instead of two separate writes. Only non-empty when the removed
// url IS the currently selected primary's own canonical file_url - a
// copy-alias removal, category move, rename, or visibility toggle never
// calls this at all, so they can never clear primary as a side effect.
export function resolveUnlinkPrimaryImagePatch(order, contextRowsForOrder, removedUrl) {
  if (!order?.primary_image_asset_id || !removedUrl) return {};
  const rows = Array.isArray(contextRowsForOrder) ? contextRowsForOrder : [];
  const current = rows.find((r) => r.asset_id === order.primary_image_asset_id);
  if (current && current.file_url === removedUrl) {
    return { primary_image_asset_id: null };
  }
  return {};
}
