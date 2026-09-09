// Pure helpers for freezing artwork revisions into order_line_component_snapshots
// at attach time - see tests/artwork-freeze.test.mjs. The actual
// find-or-reuse-vs-create-new-revision decision lives server-side in the
// find_or_create_client_product_artwork_from_asset RPC (SQL, tested
// live against production in a rolled-back transaction, not here); this
// module only covers what the frontend does with whatever revision the
// RPC (or a prior fetch of current revisions) already resolved.

import { canonicalPlacement } from "@/features/orders/placement";

// currentArtworkRows: client_product_artwork rows where is_current = true
// for one client_product_id. Returns a Map keyed by CANONICAL placement
// (case/whitespace folded - see src/features/orders/placement.js), since
// product_components.placement (Title Case, from PLACEMENT_PRESETS) and
// client_product_artwork.placement can differ only by case ("Front" vs
// "front") and an exact-string lookup would silently miss.
//
// If two DISTINCT current rows fold to the same canonical placement (an
// existing "front" + "Front" split, or "Left Chest" + "left chest"), the
// entry becomes an ambiguity marker { ambiguous: true, placement, rows }
// instead of a row - a caller must never pick one of them silently.
export function buildArtworkByPlacement(currentArtworkRows) {
  const map = new Map();
  for (const row of Array.isArray(currentArtworkRows) ? currentArtworkRows : []) {
    if (!row?.placement) continue;
    const key = canonicalPlacement(row.placement);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    if (existing.ambiguous) {
      if (!existing.rows.some((r) => r.id === row.id)) existing.rows.push(row);
      continue;
    }
    if (existing.id === row.id) continue; // same row twice - not a conflict
    map.set(key, { ambiguous: true, placement: key, rows: [existing, row] });
  }
  return map;
}

// Resolve one component's placement against the map. Returns
// { artwork, ambiguous }: `artwork` is the single current row (or null
// when none / when ambiguous). `ambiguous` true means multiple distinct
// current revisions fold to this placement - the caller must block the
// attach rather than freeze a guessed revision.
export function lookupArtworkByPlacement(artworkByPlacement, rawPlacement) {
  if (!(artworkByPlacement instanceof Map) || !rawPlacement) {
    return { artwork: null, ambiguous: false };
  }
  const entry = artworkByPlacement.get(canonicalPlacement(rawPlacement));
  if (!entry) return { artwork: null, ambiguous: false };
  if (entry.ambiguous) return { artwork: null, ambiguous: true };
  return { artwork: entry, ambiguous: false };
}

// The exact value written to order_line_component_snapshots.artwork_revision_ids.
// A component with no placement, an ambiguous placement, or a placement
// with no current artwork revision, freezes to an empty array - never
// null, never a guessed id. Accepts either a raw client_product_artwork
// row or the { artwork } shape from lookupArtworkByPlacement.
export function resolveArtworkRevisionIds(artwork) {
  const row = artwork && typeof artwork === "object" && "artwork" in artwork ? artwork.artwork : artwork;
  return row?.id ? [row.id] : [];
}
