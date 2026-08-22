// Product Composition price-breakdown calculation - pure functions, no
// I/O, so they can be unit tested directly (see tests/composition-pricing.test.mjs)
// and reused identically between the staff-facing breakdown display and
// any future consumer. Operates on already-frozen
// order_line_component_snapshots rows (or, before attach, on
// product_components rows carrying the same billing_mode/sell_price
// shape) - never re-derives price from production_pricing_defaults or
// product_components once a snapshot exists.

export function toMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// components: array of { billing_mode: 'per_unit' | 'once_per_order', sell_price, label }
// quantity: the commercial order line's quantity (garment count)
export function computeCompositionPricing(components, quantity) {
  const safeQuantity = Number.isFinite(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : 1;
  const list = Array.isArray(components) ? components : [];

  const perUnit = list.filter((c) => (c.billing_mode || "per_unit") === "per_unit");
  const onceOff = list.filter((c) => c.billing_mode === "once_per_order");

  const perUnitSubtotal = perUnit.reduce((sum, c) => sum + toMoney(c.sell_price), 0);
  const onceOffTotal = onceOff.reduce((sum, c) => sum + toMoney(c.sell_price), 0);

  // Once-off components are never multiplied by quantity - this is the
  // one rule this module exists to enforce correctly and consistently.
  const lineSubtotal = perUnitSubtotal * safeQuantity;
  const lineTotal = lineSubtotal + onceOffTotal;

  return {
    quantity: safeQuantity,
    perUnit,
    onceOff,
    perUnitSubtotal,
    onceOffTotal,
    lineSubtotal,
    lineTotal,
  };
}
