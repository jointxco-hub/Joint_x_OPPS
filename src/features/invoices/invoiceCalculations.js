const DEFAULT_CURRENCY = "ZAR";

export function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundMoney(value) {
  return Math.round((numberOrZero(value) + Number.EPSILON) * 100) / 100;
}

export function calculateInvoiceLine(item = {}) {
  const quantity = numberOrZero(item.quantity);
  const rate = numberOrZero(item.rate);
  const discount = Math.max(numberOrZero(item.discount), 0);
  const taxPercentage = Math.max(numberOrZero(item.tax_percentage), 0);
  const lineSubtotal = roundMoney(quantity * rate);
  const taxableAmount = Math.max(lineSubtotal - discount, 0);
  const taxTotal = roundMoney(taxableAmount * (taxPercentage / 100));
  const itemTotal = roundMoney(taxableAmount + taxTotal);

  return {
    ...item,
    item_type: item.item_type || "goods",
    quantity,
    rate,
    discount,
    tax_percentage: taxPercentage,
    line_subtotal: lineSubtotal,
    line_tax_total: taxTotal,
    item_total: itemTotal,
  };
}

export function calculateInvoiceTotals(invoice = {}, items = []) {
  const normalizedItems = items.map(calculateInvoiceLine);
  const subtotal = roundMoney(
    normalizedItems.reduce((sum, item) => sum + numberOrZero(item.line_subtotal), 0)
  );
  const discountTotal = roundMoney(
    normalizedItems.reduce((sum, item) => sum + numberOrZero(item.discount), 0)
  );
  const taxTotal = roundMoney(
    normalizedItems.reduce((sum, item) => sum + numberOrZero(item.line_tax_total), 0)
  );
  const shippingCharge = roundMoney(invoice.shipping_charge);
  const adjustment = roundMoney(invoice.adjustment);
  const amountPaid = roundMoney(invoice.amount_paid);
  const total = roundMoney(subtotal - discountTotal + shippingCharge + adjustment + taxTotal);
  const balanceDue = roundMoney(Math.max(total - amountPaid, 0));

  return {
    subtotal,
    discount_total: discountTotal,
    shipping_charge: shippingCharge,
    adjustment,
    tax_total: taxTotal,
    total,
    amount_paid: amountPaid,
    balance_due: balanceDue,
    currency_code: invoice.currency_code || DEFAULT_CURRENCY,
    items: normalizedItems,
  };
}

export function applyInvoiceTotals(invoice = {}, items = []) {
  const totals = calculateInvoiceTotals(invoice, items);
  const { items: normalizedItems, ...invoiceTotals } = totals;

  return {
    invoice: {
      ...invoice,
      ...invoiceTotals,
    },
    items: normalizedItems,
  };
}
