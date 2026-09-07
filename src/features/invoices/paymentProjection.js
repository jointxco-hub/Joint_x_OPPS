// Pure normaliser for the P1A payment projection. get_invoice_payment_summary
// / _invoice_payment_projection can come back as a bare JSONB object or, if
// the function is SETOF / RETURNS TABLE, a single-row array. Accept both and
// never trust a key to be present: if payment_status is missing it is
// derived from the amounts, non-numeric amounts collapse to 0, and
// null/undefined yields a usable zero projection.

function coercePaymentNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalisePaymentProjection(raw) {
  const row = (Array.isArray(raw) ? raw[0] : raw) || {};
  const amount_paid = coercePaymentNumber(row.amount_paid);
  const balance_due = coercePaymentNumber(row.balance_due);
  const payment_status = typeof row.payment_status === "string" && row.payment_status
    ? row.payment_status
    : amount_paid <= 0
      ? "unpaid"
      : balance_due > 0.0049
        ? "partial"
        : "paid";
  return { amount_paid, balance_due, payment_status, overdue: Boolean(row.overdue) };
}
