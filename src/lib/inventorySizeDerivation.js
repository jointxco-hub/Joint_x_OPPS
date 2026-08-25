import { SIZE_PRESETS } from "./sizePresets.js";

// Phase 2B Step 3 - a garment variant's available sizes come from exactly
// one source, never a silent merge of both: if it has a linked
// inventory_product_id, inventory-derived sizes (this helper) are
// authoritative; if not, manual_available_sizes is authoritative. See
// deriveSizesForProductColour's caller in the garment variant form for
// where that branch is made.

const normalize = (value) => (value ?? "").toString().trim().toLowerCase();

// active inventory_variants only, matching inventory_product_id AND a
// whitespace/case-normalized colour_name match, nonblank size_name only,
// deduped, standard sizes (SIZE_PRESETS) sorted in that canonical order
// with any unrecognized/custom size retained (never dropped) after them.
export function deriveSizesForProductColour(inventoryVariants, inventoryProductId, colourName) {
  if (!inventoryProductId || !colourName) return [];
  const targetColour = normalize(colourName);

  const matching = (Array.isArray(inventoryVariants) ? inventoryVariants : []).filter((v) =>
    v
    && v.is_active !== false
    && v.inventory_product_id === inventoryProductId
    && normalize(v.colour_name) === targetColour
    && (v.size_name ?? "").toString().trim() !== ""
  );

  const uniqueSizes = [...new Set(matching.map((v) => v.size_name.toString().trim()))];

  const standard = SIZE_PRESETS.filter((s) => uniqueSizes.includes(s));
  const custom = uniqueSizes.filter((s) => !SIZE_PRESETS.includes(s));

  return [...standard, ...custom];
}
