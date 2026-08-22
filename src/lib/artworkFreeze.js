// Pure helpers for freezing artwork revisions into order_line_component_snapshots
// at attach time - see tests/artwork-freeze.test.mjs. The actual
// find-or-reuse-vs-create-new-revision decision lives server-side in the
// find_or_create_client_product_artwork_from_asset RPC (SQL, tested
// live against production in a rolled-back transaction, not here); this
// module only covers what the frontend does with whatever revision the
// RPC (or a prior fetch of current revisions) already resolved.

// currentArtworkRows: client_product_artwork rows where is_current = true
// for one client_product_id. Returns a Map keyed by placement, since a
// client product can have a different current revision per placement
// (Front DTF vs. Back DTF, for example).
export function buildArtworkByPlacement(currentArtworkRows) {
  const map = new Map();
  for (const row of Array.isArray(currentArtworkRows) ? currentArtworkRows : []) {
    if (row?.placement) map.set(row.placement, row);
  }
  return map;
}

// The exact value written to order_line_component_snapshots.artwork_revision_ids.
// A component with no placement, or a placement with no current artwork
// revision, freezes to an empty array - never null, never a guessed id.
export function resolveArtworkRevisionIds(artwork) {
  return artwork?.id ? [artwork.id] : [];
}
