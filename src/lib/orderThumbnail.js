// Pure, dependency-free order-thumbnail selection logic — kept out of
// Orders.jsx (a .jsx page component) specifically so it is importable by
// plain `node --test` (this project has no JSX/bundler-aware test runner;
// see tests/order-production-thumbnail.test.mjs). Orders.jsx imports these
// functions directly; this file is the single source of truth, not a copy.
//
// Priority: a manually-pinned thumbnail (OrderFilesTab "Set as thumbnail")
// wins outright; otherwise the first Mockups-folder image, then the first
// unfoldered ("unsorted") image, then any other image linked to the order.

// A minimal, local stand-in for OrderDrawerShared.jsx's normalizeOrderFileFolders.
// That function additionally seeds default folder names/fileLabels/fileCopies
// for OrderFilesTab's UI, none of which affect gallery ordering here (folder
// identity for priority comes from fileFolders[url], not the folders list) —
// and it lives in a .jsx file, which plain `node --test` cannot import. Once
// an order has been touched from OrderFilesTab, order_file_folders.folders is
// already the full normalized list, so this only differs (a cosmetic label
// fallback of "File" instead of a friendly name) for orders with folder
// assignments but no folders array at all, which the UI never produces.
function safeFileFolders(orderFileFolders) {
  const value = orderFileFolders && typeof orderFileFolders === "object" && !Array.isArray(orderFileFolders)
    ? orderFileFolders
    : {};
  return {
    fileFolders: value.fileFolders && typeof value.fileFolders === "object" ? value.fileFolders : {},
    folders: Array.isArray(value.folders) ? value.folders : [],
  };
}

export function extractUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") return [value];
  return [];
}

export function isImageUrl(url) {
  return /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(String(url || ""));
}

// All images related to the order, ordered by the same mockups -> unsorted
// -> other-folder -> product-image priority used for the default thumbnail,
// deduplicated by URL. Backs both the thumbnail fallback and the "show more
// files" gallery/lightbox in ProductionSummaryOrderCard.
export function getOrderGalleryEntries(order) {
  const { fileFolders, folders } = safeFileFolders(order.order_file_folders);
  const folderName = (folderId) => folders.find((folder) => folder.id === folderId)?.name || "File";
  const fileUrls = extractUrls(order.file_urls);
  const products = Array.isArray(order.products) ? order.products : Array.isArray(order.items) ? order.items : [];

  const seen = new Set();
  const entries = [];
  const add = (url, label) => {
    if (!url || !isImageUrl(url) || seen.has(url)) return;
    seen.add(url);
    entries.push({ url, label });
  };

  fileUrls.filter((url) => fileFolders[url] === "mockups").forEach((url) => add(url, "Mockup"));
  fileUrls.filter((url) => !fileFolders[url]).forEach((url) => add(url, "Unsorted"));
  fileUrls.filter((url) => fileFolders[url] && fileFolders[url] !== "mockups").forEach((url) => add(url, folderName(fileFolders[url])));
  extractUrls(order.portal_visible_file_urls).forEach((url) => add(url, "Client-visible"));
  products
    .flatMap((product) => extractUrls([product.image_url, product.image, product.thumbnail_url, product.thumbnail]))
    .forEach((url) => add(url, "Product"));

  return entries;
}

// Non-image files linked to the order (PDFs, docs, etc.) shown alongside
// the image gallery in the "show more files" toggle.
export function getOrderOtherFiles(order) {
  return extractUrls(order.file_urls).filter((url) => !isImageUrl(url));
}

export function getOrderThumbnail(order) {
  const gallery = getOrderGalleryEntries(order);
  // A pin only counts if it still resolves to one of the order's actual
  // linked images. OrderFilesTab's removeFileLink clears
  // production_thumbnail_url when the pinned file itself is unlinked (see
  // thumbnailPatchOnRemove below), so this shouldn't normally trigger — but
  // it stays as defensive protection against legacy/stale data and any
  // other write path that updates an order's files without going through
  // that same cleanup.
  const pin = order.production_thumbnail_url;
  if (pin && isImageUrl(pin) && gallery.some((entry) => entry.url === pin)) {
    return pin;
  }
  return gallery[0]?.url || "";
}

// The production_thumbnail_url patch to merge into the same order-update
// mutation that removes a file link. Returns { production_thumbnail_url:
// null } only when the removed file is the currently pinned thumbnail
// (compared by raw stored reference, never a signed display URL); otherwise
// returns {} so the field is omitted from the payload and left untouched.
export function thumbnailPatchOnRemove(removedUrl, currentPinUrl) {
  if (removedUrl && currentPinUrl && removedUrl === currentPinUrl) {
    return { production_thumbnail_url: null };
  }
  return {};
}
