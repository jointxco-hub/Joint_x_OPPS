export function documentDisplayName(name, index = 0) {
  const raw = typeof name === "string" ? name.trim() : "";
  // Generated upload names are retained in file metadata, but are not useful labels.
  if (!raw || /^\d{10,}(?:[_-][a-z0-9]+)*\.[a-z0-9]+$/i.test(raw)) return `Document ${index + 1}`;
  return raw;
}

export function documentPageSummary(doc) {
  const count = Number(doc.selectedPages ?? doc.sourcePages);
  const pages = Number.isInteger(count) && count > 0 ? `${count} ${count === 1 ? "page" : "pages"}` : "";
  if (doc.selection === "specific") return `Pages ${doc.pagesSpec || "not specified"}${pages ? ` · ${pages}` : ""}`;
  return `All pages${pages ? ` · ${pages}` : ""}`;
}

// Resolve only among this order's attached files; never guess another file's folder.
export function resolveDocumentFolder(document, orderFiles = [], metadata = {}) {
  const refs = Array.isArray(document?.fileRefs) ? document.fileRefs : [];
  const matches = refs.filter((file) => file.name === document?.name);
  const target = matches.length === 1 ? matches[0] : document;
  const reference = target?.privateUri || target?.file_url || target?.url ||
    (target?.bucket && target?.path ? `private-upload://${target.bucket}/${target.path}` : "");
  const urls = (Array.isArray(orderFiles) ? orderFiles : []).map((file) => typeof file === "string" ? file : file.file_url || file.url || "");
  if (!reference || !urls.includes(reference)) return "";
  const folderId = metadata.fileFolders?.[reference];
  return folderId && metadata.folders?.some((folder) => folder.id === folderId) ? folderId : "__unsorted";
}
