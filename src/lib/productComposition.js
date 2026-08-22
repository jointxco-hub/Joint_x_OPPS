// Pure helpers shared between CatalogManagement's reusable-composition
// editor and ProductsEditor's inline "+ Add print option" flow, so the
// two entry points never drift on what a component/setup-fee payload
// looks like. See tests/product-composition-form.test.mjs.

export function resolvePlacement(form) {
  if (form.placement === "__custom") return (form.placementCustom || "").trim() || null;
  if (!form.placement || form.placement === "__none") return null;
  return form.placement;
}

// The reusable, client-product-level default component - never carries
// an order-specific price. sort_order is passed in by the caller (it
// depends on how many components already exist, which differs between
// CatalogManagement's full list and a single-line add).
export function buildComponentPayload(form, { clientProductId, sortOrder } = {}) {
  return {
    client_product_id: clientProductId,
    sort_order: sortOrder,
    component_type: form.component_type,
    inventory_product_id: form.component_type === "blank_garment" ? (form.inventory_product_id || null) : null,
    fixed_inventory_variant_id: form.fixed_inventory_variant_id || null,
    quantity_per_unit: Number(form.quantity_per_unit) || 1,
    default_sell_price: form.default_sell_price === "" ? null : Number(form.default_sell_price),
    billing_mode: form.billing_mode || "per_unit",
    production_method: (form.component_type === "print_service" || form.component_type === "setup_fee") ? (form.production_method || null) : null,
    placement: form.component_type === "print_service" ? resolvePlacement(form) : null,
    production_colour: form.production_colour || null,
    specification: form.specification || null,
    production_instructions: form.production_instructions || null,
    label: form.label || null,
    notes: form.notes || null,
  };
}

// Explicit staff action (form.setupRequired), never automatic. Mirrors
// buildComponentPayload's shape for the companion setup_fee row -
// billing_mode is always once_per_order regardless of what the print
// component's own billing_mode is, and the suggested amount comes from
// the staff-entered override if present, else the live production
// method default (never a guess when neither is available - null, not 0).
export function buildSetupFeeCompanionPayload(printForm, { clientProductId, sortOrder, methodLabel, productionDefault }) {
  const suggested = printForm.setupFee !== "" ? Number(printForm.setupFee) : productionDefault?.default_setup_fee;
  return {
    client_product_id: clientProductId,
    component_type: "setup_fee",
    production_method: printForm.production_method || null,
    billing_mode: "once_per_order",
    default_sell_price: Number.isFinite(suggested) ? suggested : null,
    quantity_per_unit: 1,
    label: `${methodLabel || printForm.production_method || "Setup"} setup`,
    sort_order: sortOrder,
  };
}

// The order-specific override tier: staffPrice (a free-text form input)
// wins if it's a finite number, otherwise the component's own reusable
// default is used. Never mutates the component - the caller is
// responsible for only ever writing this to a snapshot's sell_price.
export function resolveOrderPrice(staffPriceInput, componentDefaultSellPrice) {
  const overridePrice = staffPriceInput === "" || staffPriceInput == null ? null : Number(staffPriceInput);
  return Number.isFinite(overridePrice) ? overridePrice : (componentDefaultSellPrice ?? null);
}
