// Canonical placement matching for artwork <-> component resolution.
//
// Pure, no imports - node --test-able in isolation, same convention as
// src/features/orders/lineConfiguration.js.
//
// canonicalPlacement folds ONLY case and whitespace:
//   * trims leading/trailing whitespace
//   * collapses any internal whitespace run to a single space
//   * lowercases
// It deliberately does NOT map synonyms and never merges two placements
// a human would call different - "Front" and "Back" stay distinct;
// "Left Chest" and "left  chest" become the same key. It is used for
// MATCHING only: the original placement strings are always preserved for
// display and for what is written back to client_product_artwork /
// order_line_component_snapshots.

export function canonicalPlacement(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
