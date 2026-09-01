// OPPS — canonical customer PRICE COMPOSITION helpers (P2).
// Pure, dependency-free, node-testable. The SAME shape X LAB reads (src/lib/priceComposition.js).
//
// Everything here derives from get_client_product_full().pricing +
// .production.components — never a second local pricing truth. Sell
// composition only: no cost / supplier / margin is read or produced.

export const PRICE_BEARING_TYPES = ['blank_garment', 'print_service', 'setup_fee', 'addon'];

export const ROLE_LABEL = {
  base: 'Base / Blank',
  print: 'Branding',
  setup: 'Setup',
  addon: 'Add-on',
};

export const BILLING_LABEL = {
  per_unit: 'per item',
  once_per_order: 'once-off',
};

export function roleForType(componentType) {
  return { blank_garment: 'base', print_service: 'print', setup_fee: 'setup', addon: 'addon' }[componentType] || null;
}

export function isPriceBearingType(componentType) {
  return PRICE_BEARING_TYPES.includes(componentType);
}

// Reader-tolerant view of full.pricing. Never throws on an absent block,
// a null breakdown, a legacy single-price product, or missing keys.
export function readPricing(full) {
  const p = (full && full.pricing) || {};
  const b = (p && p.breakdown) || {};
  return {
    mode: p.mode === 'composed' ? 'composed' : 'single',
    clientPrice: p.client_price ?? null,
    currency: p.currency || 'ZAR',
    requiresQuote: Boolean(p.requires_quote),
    computedUnitPrice: p.computed_unit_price ?? null,
    computedOnceTotal: p.computed_once_per_order_total ?? null,
    reconciled: p.reconciled === true ? true : p.reconciled === false ? false : null,
    difference: p.difference ?? null,
    reconciliationNote: p.reconciliation_note ?? null,
    allowMultipleBase: Boolean(p.allow_multiple_base),
    perUnit: Array.isArray(b.per_unit) ? b.per_unit : [],
    oncePerOrder: Array.isArray(b.once_per_order) ? b.once_per_order : [],
  };
}

export function productionComponents(full) {
  return Array.isArray(full && full.production && full.production.components)
    ? full.production.components
    : [];
}

// Active customer-price-bearing components — the rows the pricing editor
// lets staff price. Non-bearing components (material/packaging/labour/
// other) are never shown here; they live in the Production section.
export function bearingComponents(full) {
  return productionComponents(full).filter(
    (c) => isPriceBearingType(c.component_type) && c.is_active !== false,
  );
}

export function activeBaseCount(full) {
  return productionComponents(full).filter(
    (c) => c.component_type === 'blank_garment' && c.is_active !== false,
  ).length;
}

// A human label for a component in the breakdown when the server hasn't
// stored a price_label: "Front DTF", "Base / Blank", etc.
export function derivedComponentLabel(component) {
  if (!component) return '';
  if (component.price_label && String(component.price_label).trim()) return String(component.price_label).trim();
  if (component.label && String(component.label).trim()) return String(component.label).trim();
  const method = component.production_method ? String(component.production_method).toUpperCase() : '';
  const placement = component.placement ? String(component.placement).trim() : '';
  const combined = [method, placement].filter(Boolean).join(' ');
  if (combined) return combined;
  return String(component.component_type || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

// billing_mode is a real choice only for add-ons. Blank/print are always
// per-item; setup is always once-off.
export function billingModeIsEditable(componentType) {
  return componentType === 'addon';
}

export function defaultBillingModeFor(componentType) {
  if (componentType === 'setup_fee') return 'once_per_order';
  return 'per_unit';
}

// Build the FULL admin_set_client_product_production_components payload
// from the server component list + a { [componentId]: {default_sell_price,
// price_label, billing_mode} } edit map. Non-price-bearing components pass
// straight through unchanged so a pricing save can NEVER retire production
// structure, and every structural field is preserved from the server row.
export function buildPricingSavePayload(full, priceEditsById = {}) {
  return productionComponents(full).map((c, ix) => {
    const row = {
      id: c.id,
      component_type: c.component_type,
      production_method: c.production_method || null,
      placement: c.placement || null,
      specification: c.specification || null,
      production_instructions: c.production_instructions || null,
      sort_order: c.sort_order ?? ix,
      is_active: c.is_active !== false,
      billing_mode: c.billing_mode || defaultBillingModeFor(c.component_type),
      default_sell_price: c.default_sell_price ?? null,
      price_label: c.price_label ?? null,
    };
    const edit = priceEditsById[c.id];
    if (edit && isPriceBearingType(c.component_type)) {
      if ('default_sell_price' in edit) row.default_sell_price = edit.default_sell_price;
      if ('price_label' in edit) row.price_label = edit.price_label;
      if ('billing_mode' in edit) row.billing_mode = edit.billing_mode;
    }
    return row;
  });
}

// Client-side pre-check mirroring the server XOS_CP_MULTIPLE_BASE_COMPONENTS
// guard (the RPC stays authoritative). Returns true when a save would leave
// more than one active blank_garment on a product that isn't a bundle.
export function wouldBreakSingleBase(payload, allowMultipleBase) {
  if (allowMultipleBase) return false;
  const activeBases = (payload || []).filter(
    (c) => c.component_type === 'blank_garment' && c.is_active !== false,
  ).length;
  return activeBases > 1;
}

export function formatMoney(amount, currency = 'ZAR') {
  if (amount === null || amount === undefined || amount === '' || Number.isNaN(Number(amount))) return '—';
  const n = Number(amount);
  const prefix = currency === 'ZAR' ? 'R' : `${currency} `;
  return `${prefix}${n.toLocaleString(undefined, {
    minimumFractionDigits: n % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}
