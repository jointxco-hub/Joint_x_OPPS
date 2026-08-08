import { dataClient } from "@/api/dataClient";
import { resolveOrderAssetCategory, isAlreadyMirroredAssetError } from "@/lib/orderAssetFolders";

const DEFAULT_ORDER_FILE_FOLDERS = [
  { id: "mockups", name: "Mockups" },
  { id: "artwork", name: "Artwork / Graphic Files" },
  { id: "brand_assets", name: "Brand Assets" },
  { id: "references", name: "References" },
  { id: "production", name: "Production Documents" },
  { id: "qc_finished", name: "QC / Finished" },
  { id: "delivery", name: "Delivery" },
  { id: "general", name: "General" },
];

export const INVOICE_FOLDER_ID = "__invoices";

// dataClient.entities is built dynamically (see src/api/dataClient.js), so
// TS can't statically resolve its keys — same local `any` boundary already
// used for this elsewhere (e.g. OrderLinkPanel.jsx's orderEntity,
// Dashboard.jsx's ents).
function clientAssetEntity() {
  return /** @type {any} */ (dataClient.entities).ClientAsset;
}

// Mirrors a file just attached to an order into the client's canonical
// File Manager category (folders/client_assets: All Files -> Clients ->
// <Client> -> <category>), so order files become visible and organized in
// one client-wide place instead of only living on the order record. Never
// re-uploads the binary — file_url is the same storage reference either
// way (dataClient.integrations.Core.UploadFile is never called here).
//
// Canonical per Phase 1A.1: one client_assets row exists per
// (client_id, file_url), reused across every order that links the same
// file rather than one row per order. If a canonical row already exists,
// it's reused as-is — its file_url, origin order_id, and category are left
// alone, except that an uncategorized existing row (no folder_id at all)
// is upgraded to the new, more specific category. client_assets.order_id
// on a newly-created row is origin/first-linked metadata only — it is
// never read to determine which orders currently use the asset; that's
// always orders.file_urls.
//
// Best-effort and non-blocking throughout: any failure (including the
// expected "already mirrored" case — either idx_client_assets_order_file_url_unique,
// kept for backward compatibility, or the new canonical
// idx_client_assets_client_file_url_unique) is swallowed here so it can
// never fail the order upload/link/save that triggered it.
export async function mirrorOrderFileToClientAssetFolder({ order, fileUrl, fileName = "", fileType = "", fileSize = undefined, folderId = "" }) {
  if (!order?.id || !order?.client_id || !fileUrl) return;
  try {
    const category = resolveOrderAssetCategory(folderId);
    const folderRowId = await dataClient.files.getOrCreateOrderAssetFolder({
      orderId: order.id,
      category,
    });
    const assets = clientAssetEntity();

    const existing = await assets.filter({ client_id: order.client_id, file_url: fileUrl }, undefined, 1);
    const existingAsset = Array.isArray(existing) ? existing[0] : null;
    if (existingAsset) {
      if (folderRowId && !existingAsset.folder_id) {
        try {
          await assets.update(existingAsset.id, { folder_id: folderRowId });
        } catch (updateError) {
          console.warn("[order-files] client asset category upgrade failed", updateError);
        }
      }
      return;
    }

    await assets.create({
      title: fileName || fileUrl,
      file_url: fileUrl,
      file_type: fileType ? String(fileType).split("/").pop() : (String(fileName || "").split(".").pop()?.toLowerCase() || "file"),
      file_size: fileSize || undefined,
      client_id: order.client_id,
      order_id: order.id,
      folder_id: folderRowId || null,
    });
  } catch (error) {
    if (isAlreadyMirroredAssetError(error)) return;
    console.warn("[order-files] client asset mirror failed", error);
  }
}

// When a canonical order file is moved between order-local folders (e.g.
// General -> Mockups), keeps the client library's categorization of that
// same file in sync. Only a real category move of the canonical order file
// should do this — never for a fileCopies/"linked into another order
// folder" placement, which is order-local organization only and must not
// move the shared client-library asset.
export async function syncOrderFileCategoryToClientAsset({ order, fileUrl, folderId }) {
  if (!order?.id || !order?.client_id || !fileUrl) return;
  try {
    const category = resolveOrderAssetCategory(folderId);
    const folderRowId = await dataClient.files.getOrCreateOrderAssetFolder({
      orderId: order.id,
      category,
    });
    if (!folderRowId) return;
    const assets = clientAssetEntity();
    const existing = await assets.filter({ client_id: order.client_id, file_url: fileUrl }, undefined, 1);
    const existingAsset = Array.isArray(existing) ? existing[0] : null;
    if (!existingAsset || existingAsset.folder_id === folderRowId) return;
    await assets.update(existingAsset.id, { folder_id: folderRowId });
  } catch (error) {
    console.warn("[order-files] client asset category sync failed", error);
  }
}

// Ensures an order's standard File Manager folder structure exists, even
// with zero files attached yet (e.g. right after order creation).
// Best-effort and non-blocking, same rationale as the mirror helper above.
export async function provisionOrderAssetFolders(order) {
  if (!order?.id || !order?.client_id) return;
  try {
    await dataClient.files.provisionOrderAssetFolders(order.id);
  } catch (error) {
    console.warn("[order-files] folder provisioning failed", error);
  }
}

function normalizeFolders(folders) {
  const cleanFolders = Array.isArray(folders)
    ? folders.map((folder, index) => ({
      id: folder.id || `folder-${index}`,
      name: folder.name || `Folder ${index + 1}`,
    }))
    : [];
  const existingIds = new Set(cleanFolders.map((folder) => folder.id));
  return [
    ...cleanFolders,
    ...DEFAULT_ORDER_FILE_FOLDERS.filter((folder) => !existingIds.has(folder.id)),
  ];
}

export function normalizeOrderFileFolders(value) {
  const fallback = { folders: DEFAULT_ORDER_FILE_FOLDERS, fileFolders: {}, fileLabels: {}, fileCopies: [] };
  if (!value) return fallback;
  if (Array.isArray(value)) {
    return {
      folders: value.length ? normalizeFolders(value) : DEFAULT_ORDER_FILE_FOLDERS,
      fileFolders: {},
      fileLabels: {},
      fileCopies: [],
    };
  }
  const folders = Array.isArray(value.folders) && value.folders.length
    ? normalizeFolders(value.folders)
    : DEFAULT_ORDER_FILE_FOLDERS;
  return {
    folders,
    fileFolders: value.fileFolders && typeof value.fileFolders === "object" ? value.fileFolders : {},
    fileLabels: value.fileLabels && typeof value.fileLabels === "object" ? value.fileLabels : {},
    fileCopies: Array.isArray(value.fileCopies)
      ? value.fileCopies
        .filter((copy) => copy?.url)
        .map((copy, index) => ({
          id: copy.id || `copy-${index}`,
          url: copy.url,
          folderId: copy.folderId || "",
          label: copy.label || "",
        }))
      : [],
  };
}
