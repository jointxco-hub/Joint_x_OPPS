// Pure, dependency-free logic shared between the two Phase 1A.1 bulk-reuse
// entry points (OrderFilesTab.jsx's "Add from client library" and, if
// present, File Manager's "Link to order"), so the patch-building logic for
// linking existing canonical client_assets into an order lives in exactly
// one place. No @/ aliases, no JSX — importable directly by
// `node --test`, same rationale as src/lib/orderAssetFolders.js.

import { resolveOrderFolderIdForCategory } from "./orderAssetFolders.js";

// Given a folders row, resolves the client-category name it represents.
// Only folder_kind === "client_category" rows (created by
// get_or_create_client_asset_folder in 202608080002) are real categories;
// anything else (a client/Clients root, a legacy Phase 1A folder, an
// unrelated internal folder) has no category of its own.
export function resolveClientCategoryFromFolder(folder) {
  if (!folder || folder.folder_kind !== "client_category") return "General";
  return folder.name || "General";
}

// Removes duplicate selections (by file_url, falling back to id) while
// preserving first-seen order, so re-selecting the same asset twice (e.g.
// once via search, once via category browsing) never double-links it.
export function dedupeSelectedAssets(assets) {
  const seen = new Set();
  const result = [];
  for (const asset of assets || []) {
    const key = asset?.file_url || asset?.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(asset);
  }
  return result;
}

// Annotates each asset with whether its file_url is already present on the
// current order, so the picker can default to not re-selecting it and show
// an "already used on this order" badge.
export function determineAlreadyLinkedState(assets, currentOrderUrls) {
  const urlSet = new Set(currentOrderUrls || []);
  return (assets || []).map((asset) => ({
    ...asset,
    alreadyLinkedToOrder: urlSet.has(asset?.file_url),
  }));
}

// Builds the single order-update patch for linking N selected canonical
// client assets into an order in one operation:
//   - preserves every existing file_urls entry
//   - dedupes selections against each other AND against what's already on
//     the order (re-selecting an already-linked file is a no-op for that
//     file, not a duplicate or an error)
//   - reverse-maps each asset's client category to the order's own local
//     folder id (categoryByFolderId supplies the category name for a given
//     client_assets.folder_id, resolved by the caller from the client's
//     Folder rows)
//   - carries the asset's title into fileLabels only for newly-linked URLs
//   - never touches fileCopies or any other existing order_file_folders
//     key — unrelated order metadata is preserved byte-for-byte
export function buildBulkOrderFileLinkPatch({ fileUrls, orderFileFolders, selectedAssets, categoryByFolderId = {} }) {
  const currentUrls = Array.isArray(fileUrls) ? fileUrls : [];
  const metadata = orderFileFolders && typeof orderFileFolders === "object"
    ? orderFileFolders
    : { fileFolders: {}, fileLabels: {}, fileCopies: [] };

  const nextUrls = [...currentUrls];
  const urlSet = new Set(currentUrls);
  const nextFileFolders = { ...(metadata.fileFolders || {}) };
  const nextFileLabels = { ...(metadata.fileLabels || {}) };

  const deduped = dedupeSelectedAssets(selectedAssets);
  let newlyLinkedCount = 0;

  for (const asset of deduped) {
    const url = asset?.file_url;
    if (!url) continue;
    const alreadyOnOrder = urlSet.has(url);
    if (!alreadyOnOrder) {
      urlSet.add(url);
      nextUrls.push(url);
      newlyLinkedCount += 1;

      const category = categoryByFolderId[asset.folder_id] || "General";
      const orderFolderId = resolveOrderFolderIdForCategory(category);
      if (orderFolderId) {
        nextFileFolders[url] = orderFolderId;
      }
      if (asset.title) {
        nextFileLabels[`file:${url}`] = asset.title;
      }
    }
  }

  return {
    totalSelected: deduped.length,
    newlyLinkedCount,
    patch: {
      file_urls: nextUrls,
      order_file_folders: {
        ...metadata,
        fileFolders: nextFileFolders,
        fileLabels: nextFileLabels,
        fileCopies: Array.isArray(metadata.fileCopies) ? metadata.fileCopies : [],
      },
    },
  };
}
