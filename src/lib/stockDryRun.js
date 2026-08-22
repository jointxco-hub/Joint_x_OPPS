// Per-order-line stock dry-run calculation - pure functions, no I/O (see
// tests/stock-dry-run.test.mjs). inventory_variant_availability_v only
// tracks a per-variant GLOBAL total of active reservations, with no
// breakdown of how much of that total belongs to the current order vs.
// every other order. Naively treating that global total as "reserved
// elsewhere" double-counts this order's own reservation as a competing
// claim against itself, producing a false shortage for orders that are
// already fully covered. This module corrects for that by taking the
// current order's own reserved quantity (queried separately, scoped by
// order_line_component_snapshot_id) and subtracting it out first.

function toNonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// required/onHandQty/totalActiveReserved/thisOrderReserved: numeric inputs
// as read from the order line and inventory_variant_availability_v.
// verified: whether on_hand_qty has ever been confirmed by a real
// stocktake (inventory_variants.balance_verified_at is not null).
export function computeStockDryRun({ required, onHandQty, totalActiveReserved, thisOrderReserved, verified }) {
  const safeRequired = toNonNegative(required);
  const safeOnHand = toNonNegative(onHandQty);
  const safeTotalReserved = toNonNegative(totalActiveReserved);
  const safeThisOrderReserved = toNonNegative(thisOrderReserved);

  const reservedElsewhere = Math.max(0, safeTotalReserved - safeThisOrderReserved);
  const availableToThisOrder = safeOnHand - reservedElsewhere;
  const unreservedRequired = Math.max(0, safeRequired - safeThisOrderReserved);
  const short = Math.max(0, unreservedRequired - Math.max(0, availableToThisOrder));
  const fullyReservedForThisOrder = unreservedRequired === 0;

  let status;
  if (!verified) {
    status = fullyReservedForThisOrder
      ? "Fully reserved · Stock balance unverified"
      : `Stock balance unverified · Needs ${unreservedRequired} more reserved`;
  } else {
    status = short > 0 ? `Short ${short}` : "Sufficient stock";
  }

  return {
    required: safeRequired,
    onHandQty: safeOnHand,
    totalActiveReserved: safeTotalReserved,
    thisOrderReserved: safeThisOrderReserved,
    reservedElsewhere,
    availableToThisOrder,
    unreservedRequired,
    short,
    verified: Boolean(verified),
    fullyReservedForThisOrder,
    status,
  };
}
