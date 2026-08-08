import { dataClient } from "@/api/dataClient";
import { resolveOrderAssetCategory, isAlreadyMirroredAssetError } from "@/lib/orderAssetFolders";

const DEFAULT_ORDER_FILE_FOLDERS = [
  { id: "mockups", name: "Mockups" },
  { id: "artwork", name: "Artwork / Graphic Files" },
  { id: "brand_assets", name: "Brand Assets" },
  { id: "references", name: "References" },
  { id: "production", name: "Production Documents" },
];

export const INVOICE_FOLDER_ID = "__invoices";

// Mirrors a file just attached to an order into
// "<Client Root>/Orders/<order_number>/<category>" in File Manager
// (folders/client_assets), so order files become visible and organized in
// one client-wide place instead of only living on the order record. Never
// re-uploads the binary — file_url is the same storage reference either
// way (dataClient.integrations.Core.UploadFile is never called here). Best-
// effort and non-blocking: any failure (including the expected "already
// mirrored" case, from idx_client_assets_order_file_url_unique) is
// swallowed here so it can never fail the order upload/link/save that
// triggered it.
export async function mirrorOrderFileToClientAssetFolder({ order, fileUrl, fileName = "", fileType = "", fileSize = undefined, folderId = "" }) {
  if (!order?.id || !order?.client_id || !fileUrl) return;
  try {
    const folderRowId = await dataClient.files.getOrCreateOrderAssetFolder({
      orderId: order.id,
      category: resolveOrderAssetCategory(folderId),
    });
    // dataClient.entities is built dynamically (see src/api/dataClient.js),
    // so TS can't statically resolve its keys — same local `any` boundary
    // already used for this elsewhere (e.g. OrderLinkPanel.jsx's
    // orderEntity, Dashboard.jsx's ents).
    const clientAssetEntity = /** @type {any} */ (dataClient.entities).ClientAsset;
    await clientAssetEntity.create({
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
