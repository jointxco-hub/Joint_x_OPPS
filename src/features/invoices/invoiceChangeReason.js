// Total-change reason: detection + serialization.
//
// The invoice save path (api/invoices.js -> assertInvoiceItemChangeReasons
// and the server's INVOICE_TOTAL_OVERRIDE_REASON_REQUIRED guard) refuses a
// save that changes an invoice's commercial content without a written
// reason. The old UI dead-ended on the resulting toast. This module powers
// a modal instead:
//
//   detectCommercialTotalChange() — the ONE place "did the commercial
//     total move vs the last saved value?" is decided, reusing the
//     canonical calculateInvoiceTotals(). Also returns a short,
//     human-readable list of what changed for the modal context.
//
//   buildOverrideReasonString() — turns {reasonType, note} into the ONE
//     string persisted to opps_invoices.total_override_reason and to each
//     changed line's opps_invoice_item_versions.change_reason.
//
// Pure: no React, no Supabase. See tests/invoice-total-change-reason.test.mjs.

import { calculateInvoiceTotals, roundMoney, numberOrZero } from "./invoiceCalculations.js";

export const CUSTOM_REASON = "custom";

// Order matters — this is the dropdown order.
export const INVOICE_CHANGE_REASON_TYPES = [
  { value: "pricing_correction", label: "Pricing correction" },
  { value: "client_requested", label: "Client-requested change" },
  { value: "quantity_changed", label: "Quantity changed" },
  { value: "discount_adjustment", label: "Discount adjustment" },
  { value: "shipping_adjustment", label: "Shipping adjustment" },
  { value: "product_changed", label: "Product/service changed" },
  { value: "data_entry_correction", label: "Typo/data-entry correction" },
  { value: "approved_special_price", label: "Approved special price" },
  { value: "internal_correction", label: "Internal correction" },
  { value: CUSTOM_REASON, label: "Custom reason" },
];

const REASON_LABEL = Object.fromEntries(INVOICE_CHANGE_REASON_TYPES.map((r) => [r.value, r.label]));

// A preset alone is fine; a preset with a note appends it; "Custom reason"
// REQUIRES a note and is prefixed with its label.
export function isChangeReasonValid(reasonType, note) {
  if (!reasonType || !REASON_LABEL[reasonType]) return false;
  if (reasonType === CUSTOM_REASON) return String(note || "").trim().length > 0;
  return true;
}

export function buildOverrideReasonString(reasonType, note) {
  const label = REASON_LABEL[reasonType];
  if (!label) return "";
  const trimmed = String(note || "").trim();
  if (reasonType === CUSTOM_REASON) {
    return trimmed ? `Custom reason — ${trimmed}` : ""; // invalid without a note
  }
  return trimmed ? `${label} — ${trimmed}` : label;
}

function money(v) {
  const n = roundMoney(v);
  return `R${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function itemName(item) {
  return String(item?.item_name || item?.name || "Item").trim() || "Item";
}

function itemKey(item, index) {
  return item?.line_key || item?.id || `idx:${index}`;
}

// Compare current editor state to the last SAVED invoice and decide
// whether a written reason is required. `previousInvoice` is the row the
// editor was opened on (initialInvoice); `nextInvoice` / `nextItems` are
// the current editor values (before or after applyInvoiceTotals — this
// recomputes both sides through the canonical calculator so the check
// never disagrees with the server's own reconciliation).
export function detectCommercialTotalChange(previousInvoice, nextInvoice, nextItems) {
  const prev = previousInvoice || {};
  const isEditingSaved = Boolean(prev.id);
  const prevItems = Array.isArray(prev.items) ? prev.items : [];
  const curItems = Array.isArray(nextItems) ? nextItems : [];

  const prevTotals = calculateInvoiceTotals(prev, prevItems);
  const nextTotals = calculateInvoiceTotals(nextInvoice || {}, curItems);
  const previousTotal = roundMoney(isEditingSaved ? prevTotals.total : 0);
  const nextTotal = roundMoney(nextTotals.total);

  // No prior saved invoice -> the first save never needs a reason.
  if (!isEditingSaved) {
    return { changed: false, previousTotal: nextTotal, nextTotal, changes: [] };
  }

  const totalMoved = Math.abs(nextTotal - previousTotal) >= 0.005;

  const changes = [];
  const prevByKey = new Map(prevItems.map((it, i) => [itemKey(it, i), it]));
  const seen = new Set();

  curItems.forEach((cur, i) => {
    const key = itemKey(cur, i);
    seen.add(key);
    const before = prevByKey.get(key);
    if (!before) {
      changes.push({ label: `Added: ${itemName(cur)}`, from: null, to: money(calculateTotalsForLine(cur)) });
      return;
    }
    if (Math.abs(numberOrZero(cur.rate) - numberOrZero(before.rate)) >= 0.005) {
      changes.push({ label: `${itemName(cur)} price`, from: money(before.rate), to: money(cur.rate) });
    }
    if (numberOrZero(cur.quantity) !== numberOrZero(before.quantity)) {
      changes.push({ label: `${itemName(cur)} quantity`, from: String(numberOrZero(before.quantity)), to: String(numberOrZero(cur.quantity)) });
    }
    if (Math.abs(numberOrZero(cur.discount) - numberOrZero(before.discount)) >= 0.005) {
      changes.push({ label: `${itemName(cur)} discount`, from: money(before.discount), to: money(cur.discount) });
    }
    if (Math.abs(numberOrZero(cur.tax_percentage) - numberOrZero(before.tax_percentage)) >= 0.005) {
      changes.push({ label: `${itemName(cur)} tax`, from: `${numberOrZero(before.tax_percentage)}%`, to: `${numberOrZero(cur.tax_percentage)}%` });
    }
  });

  prevItems.forEach((before, i) => {
    if (!seen.has(itemKey(before, i))) {
      changes.push({ label: `Removed: ${itemName(before)}`, from: money(calculateTotalsForLine(before)), to: null });
    }
  });

  if (Math.abs(numberOrZero(nextInvoice?.shipping_charge) - numberOrZero(prev.shipping_charge)) >= 0.005) {
    changes.push({ label: "Shipping", from: money(prev.shipping_charge), to: money(nextInvoice?.shipping_charge) });
  }
  if (Math.abs(numberOrZero(nextInvoice?.adjustment) - numberOrZero(prev.adjustment)) >= 0.005) {
    changes.push({ label: "Adjustment", from: money(prev.adjustment), to: money(nextInvoice?.adjustment) });
  }

  // Require a reason when the total moved OR any commercial line/field
  // changed (a rate + qty swap can net to the same total yet still be an
  // audited change the server's per-line guard will block).
  const changed = totalMoved || changes.length > 0;

  return { changed, previousTotal, nextTotal, changes };
}

function calculateTotalsForLine(item) {
  const q = numberOrZero(item.quantity);
  const r = numberOrZero(item.rate);
  const d = Math.max(numberOrZero(item.discount), 0);
  const taxable = Math.max(roundMoney(q * r) - d, 0);
  const tax = roundMoney(taxable * (Math.max(numberOrZero(item.tax_percentage), 0) / 100));
  return roundMoney(taxable + tax);
}
