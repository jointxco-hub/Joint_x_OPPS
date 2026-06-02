export function getOrderAmountPaid(order) {
  return Number(order?.amount_paid ?? order?.deposit_paid ?? 0) || 0;
}

export function getOrderTotal(order) {
  return Number(order?.total_amount ?? order?.quoted_price ?? order?.total ?? 0) || 0;
}

export function getOrderHealthFlags(order) {
  const status = String(order?.status || "").toLowerCase();
  const source = String(order?.source || "").toLowerCase();
  const total = getOrderTotal(order);
  const paid = getOrderAmountPaid(order);
  const flags = [];

  if (paid > 0 && status === "pending_payment") {
    flags.push({
      key: "payment-recorded-still-pending",
      severity: "critical",
      label: "Payment recorded, still pending",
      description: "Money is recorded on this order, but the order still says pending payment.",
    });
  }

  if (total > 0 && paid >= total && ["pending_payment", "awaiting_payment"].includes(status)) {
    flags.push({
      key: "paid-full-status-pending",
      severity: "critical",
      label: "Paid in full, status pending",
      description: "Recorded payments cover the order value, but the status has not moved forward.",
    });
  }

  if (source === "xlab" && status === "pending_payment" && paid === 0) {
    flags.push({
      key: "xlab-payfast-review",
      severity: "warning",
      label: "Check PayFast",
      description: "X LAB order is still pending payment. Confirm PayFast before production waits.",
    });
  }

  return flags;
}

export function getOrderHealthSummary(orders = []) {
  const flagged = orders
    .map((order) => ({ order, flags: getOrderHealthFlags(order) }))
    .filter((item) => item.flags.length > 0);
  return {
    flagged,
    critical: flagged.filter((item) => item.flags.some((flag) => flag.severity === "critical")),
    warnings: flagged.filter((item) => item.flags.every((flag) => flag.severity !== "critical")),
  };
}
