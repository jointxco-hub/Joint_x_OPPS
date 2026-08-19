// Shared courier-completeness check for the missing-delivery-details
// warning on both orders (OrderDrawer.jsx) and invoices
// (InvoiceDetailDrawer.jsx). Deliberately NOT just "courier and code both
// blank" - a courier that's been selected but is missing the specific
// code IT requires is just as incomplete as no courier at all, and
// should surface a specific, actionable reason rather than a generic one.
//
// pep_paxi and the_courier_guy are pickup/account-code-based couriers -
// a shipment genuinely cannot be booked without that code. The other
// named couriers (aramex, dhl, fedex, fastway, sa_post, dawn_wing) are
// waybill/tracking-based and don't have a pre-shipment code to collect,
// so once one of those is selected there's nothing further to require
// here. 'other' / hand delivery has no standard code system either.
const CODE_REQUIRED_COURIERS = {
  pep_paxi: "PAXI code missing",
  the_courier_guy: "Courier Guy code missing",
};

/**
 * @param {{ fulfillmentType?: string, courier?: string, courierCode?: string }} input
 * @returns {string|null} a specific reason the delivery details are incomplete, or null if fine
 */
export function getCourierRequirementGap({ fulfillmentType, courier, courierCode }) {
  if ((fulfillmentType || "courier") !== "courier") return null;
  if (!courier) return "Courier not selected";

  const codeReason = CODE_REQUIRED_COURIERS[courier];
  if (codeReason && !courierCode) return codeReason;

  return null;
}
