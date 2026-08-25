// Phase 2B Step 3 - pure payload builders for GarmentVariant/Treatment
// create+edit, mirroring buildComponentPayload's shape/style in
// productComposition.js. Kept separate since these target different
// tables with no field overlap.

export function buildGarmentVariantPayload(form, { clientProductId, sortOrder } = {}) {
  const isInventoryLinked = Boolean(form.inventory_product_id);
  return {
    client_product_id: clientProductId,
    name: (form.name || "").trim(),
    inventory_product_id: form.inventory_product_id || null,
    colour_name: form.colour_name || null,
    // Inventory-derived sizes are authoritative once an inventory product
    // is linked - manual_available_sizes is cleared, never left as stale
    // data that could silently compete with the derived list.
    manual_available_sizes: isInventoryLinked
      ? null
      : (form.manual_available_sizes || "").split(",").map((s) => s.trim()).filter(Boolean),
    price_override: form.price_override === "" ? null : Number(form.price_override),
    sort_order: sortOrder !== undefined ? sortOrder : Number(form.sort_order) || 0,
    notes: form.notes || null,
    is_active: form.is_active,
  };
}

export function emptyTreatmentForm() {
  return {
    name: "",
    print_colour: "",
    production_method: "",
    primary_placement: "",
    print_size: "",
    surcharge: "",
    production_instructions: "",
    sort_order: 0,
    is_active: true,
  };
}

export function buildTreatmentPayload(form, { clientProductId, sortOrder } = {}) {
  return {
    client_product_id: clientProductId,
    name: (form.name || "").trim(),
    print_colour: form.print_colour || null,
    production_method: form.production_method || null,
    // Display/default hint only - never treated as the authoritative
    // required-artwork-placement source (that stays required_artwork_
    // placements on client_products, per the migration's own design note).
    primary_placement: form.primary_placement || null,
    print_size: form.print_size || null,
    surcharge: form.surcharge === "" ? 0 : Number(form.surcharge),
    production_instructions: form.production_instructions || null,
    sort_order: sortOrder !== undefined ? sortOrder : Number(form.sort_order) || 0,
    is_active: form.is_active,
  };
}
