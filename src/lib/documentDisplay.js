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
