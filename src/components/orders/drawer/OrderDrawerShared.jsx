const DEFAULT_ORDER_FILE_FOLDERS = [
  { id: "mockups", name: "Mockups" },
  { id: "artwork", name: "Artwork / Graphic Files" },
  { id: "references", name: "References" },
  { id: "production", name: "Production Documents" },
];

export const INVOICE_FOLDER_ID = "__invoices";

export function normalizeOrderFileFolders(value) {
  const fallback = { folders: DEFAULT_ORDER_FILE_FOLDERS, fileFolders: {} };
  if (!value) return fallback;
  if (Array.isArray(value)) {
    return {
      folders: value.length ? value.map((folder, index) => ({
        id: folder.id || `folder-${index}`,
        name: folder.name || `Folder ${index + 1}`,
      })) : DEFAULT_ORDER_FILE_FOLDERS,
      fileFolders: {},
    };
  }
  const folders = Array.isArray(value.folders) && value.folders.length
    ? value.folders.map((folder, index) => ({
      id: folder.id || `folder-${index}`,
      name: folder.name || `Folder ${index + 1}`,
    }))
    : DEFAULT_ORDER_FILE_FOLDERS;
  return {
    folders,
    fileFolders: value.fileFolders && typeof value.fileFolders === "object" ? value.fileFolders : {},
  };
}
