// Order commercial total - pure functions, no I/O (see tests/order-total.test.mjs).
// orders.total_amount is a STORED, staff-editable field (not purely
// derived) - NewOrderDrawer shows an auto-calculated suggestion staff can
// override, and ProductsEditor has an explicit "Apply to order total"
// action. This module supplies the shipping-aware version of that
// suggestion/apply value; it never reads or rewrites total_amount itself.
//
// Order total = items subtotal + charged shipping, where charged shipping
// is shipping_fee only when apply_shipping_fee is true - never both
// counted, never shipping counted when the toggle is off regardless of
// whatever shipping_fee happens to still be stored.

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function computeChargedShipping({ applyShippingFee, shippingFee }) {
  return applyShippingFee ? numberOrZero(shippingFee) : 0;
}

export function computeOrderTotal({ itemsSubtotal, applyShippingFee, shippingFee }) {
  const safeSubtotal = numberOrZero(itemsSubtotal);
  const chargedShipping = computeChargedShipping({ applyShippingFee, shippingFee });
  return {
    itemsSubtotal: safeSubtotal,
    chargedShipping,
    total: safeSubtotal + chargedShipping,
  };
}

// Creation-time-only default (see Phase 2): courier -> true, collection/
// service_only -> false. Never called reactively when fulfillment_type
// changes on an already-created order - only at the moment a NEW order's
// initial state is composed.
export function defaultApplyShippingFeeForFulfillment(fulfillmentType) {
  return fulfillmentType === "collection" || fulfillmentType === "service_only" ? false : true;
}
