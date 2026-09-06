// Quote line + totals math. Reuses the invoice line formula verbatim
// (calculateInvoiceLine) so a quote and the invoice it later becomes
// reconcile to the same numbers. The only quote-specific shaping is the
// totals object (no amount_paid / balance_due — a quote is never paid).

import { calculateInvoiceLine, numberOrZero, roundMoney } from "@/features/invoices/invoiceCalculations";

export const QUOTE_LINE_ROLES = ["product", "addon", "setup_fee", "shipping", "discount"];

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

export function isEmptyQuoteItem(item = {}) {
  return (
    isBlank(item.item_name) &&
    isBlank(item.item_description) &&
    numberOrZero(item.rate) === 0 &&
    numberOrZero(item.discount) === 0 &&
    (isBlank(item.quantity) || numberOrZero(item.quantity) === 1)
  );
}

export function normalizeQuoteItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => !isEmptyQuoteItem(item))
    .map((item, index) => ({
      ...item,
      role: QUOTE_LINE_ROLES.includes(item.role) ? item.role : "product",
      line_number: Number(item.line_number ?? index + 1),
    }));
}

export function calculateQuoteLine(item = {}) {
  return calculateInvoiceLine(item);
}

export function calculateQuoteTotals(quote = {}, items = []) {
  const lines = normalizeQuoteItems(items).map(calculateInvoiceLine);
  const subtotal = roundMoney(lines.reduce((sum, l) => sum + numberOrZero(l.line_subtotal), 0));
  const discountTotal = roundMoney(lines.reduce((sum, l) => sum + numberOrZero(l.discount), 0));
  const taxTotal = roundMoney(lines.reduce((sum, l) => sum + numberOrZero(l.line_tax_total), 0));
  const setupFees = roundMoney(
    lines.filter((l) => l.role === "setup_fee").reduce((sum, l) => sum + numberOrZero(l.line_subtotal), 0),
  );
  const shippingCharge = roundMoney(quote.shipping_charge);
  const total = roundMoney(subtotal - discountTotal + shippingCharge + taxTotal);

  return {
    subtotal,
    discount_total: discountTotal,
    setup_fees: setupFees,
    shipping_charge: shippingCharge,
    tax_total: taxTotal,
    total,
    currency_code: quote.currency_code || "ZAR",
    items: lines,
  };
}
