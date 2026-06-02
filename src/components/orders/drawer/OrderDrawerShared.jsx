const DEFAULT_ORDER_FILE_FOLDERS = [
  { id: "mockups", name: "Mockups" },
  { id: "artwork", name: "Artwork / Graphic Files" },
  { id: "brand_assets", name: "Brand Assets" },
  { id: "references", name: "References" },
  { id: "production", name: "Production Documents" },
];

export const INVOICE_FOLDER_ID = "__invoices";

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
