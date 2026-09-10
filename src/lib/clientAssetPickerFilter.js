// Pure, import-free category + free-text filtering for the shared
// ClientAssetPickerModal (every "Use existing file" surface: Client Product
// thumbnail / mockup / artwork, order file linking, order-line artwork,
// composition artwork). Kept dependency-free (no @/ aliases, no JSX) so the
// "All categories === no restriction" contract has real behavioural test
// coverage under `node --test`, not just source-text assertions — and so
// every picker surface inherits identical semantics from one place.
//
// The bug this guards against: a picker opened with a preselected category
// that the client happens to have no files in would (a) filter the list to
// zero and (b) leave the native <select> showing "All categories" (its
// first <option>) because no matching <option> was rendered — so staff saw
// an empty list under a control that read "All categories" and concluded
// the client had no files. "All categories" now literally means no filter,
// and is always the initial state.

// Every "no category restriction" spelling collapses to null so a stray
// "", "all", "All categories", undefined, etc. can never be treated as a
// real category name that filters everything out.
export const NO_CATEGORY_RESTRICTION_VALUES = Object.freeze([
  "",
  "all",
  "all categories",
  "all_categories",
  "all-categories",
]);

// null  -> no category restriction ("All categories")
// "General", "Artwork", ... -> a real category, matched only when explicitly
//   selected ("General" is an actual category, never an implicit catch-all).
export function normalizeCategoryFilter(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (NO_CATEGORY_RESTRICTION_VALUES.includes(trimmed.toLowerCase())) return null;
  return trimmed;
}

// An asset with no folder / an unrecognised folder is "General" — the same
// fallback resolveClientCategoryFromFolder / resolveOrderAssetCategory use.
export function categoryOfAsset(asset, categoryByFolderId) {
  return (categoryByFolderId && categoryByFolderId[asset.folder_id]) || "General";
}

// `assets` must already be client/tenant/archived-scoped by the caller
// (selectableAssets) — this only composes the two controls the user drives:
// the category <select> and the free-text search. They compose as:
//   null      + ""      -> everything the caller passed in
//   null      + term    -> term matched across every category
//   "Artwork" + ""      -> every Artwork asset
//   "Artwork" + term    -> Artwork assets whose title matches term
export function filterClientAssetsByCategoryAndSearch({
  assets,
  categoryByFolderId = {},
  categoryFilter = null,
  search = "",
}) {
  const activeCategory = normalizeCategoryFilter(categoryFilter);
  const term = String(search || "").trim().toLowerCase();
  return (assets || []).filter((asset) => {
    if (activeCategory && categoryOfAsset(asset, categoryByFolderId) !== activeCategory) return false;
    if (term && !String(asset.title || "").toLowerCase().includes(term)) return false;
    return true;
  });
}
