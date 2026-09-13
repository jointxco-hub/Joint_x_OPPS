import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

// "Payment: Approved" / "Payment status: Approved" read as if the invoice
// were paid, but states.payment is derived from invoice.status — the flat
// workflow/lifecycle column, which conflates lifecycle state (draft/void/
// exported) with payment-cycle state (approved/partially_paid/paid). A
// freshly-approved, R0-paid invoice showed "Payment: Approved". Wording
// only — states.payment itself, and every field it reads, is unchanged.

test("order drawer Invoices tab: badge reads 'Invoice: <status>', not 'Payment: <status>'", async () => {
  const s = await src("src/components/orders/drawer/InvoicesTab.jsx");
  assert.match(s, /label=\{`Invoice: \$\{states\.payment\.label\}`\}/);
  assert.doesNotMatch(s, /label=\{`Payment: \$\{states\.payment\.label\}`\}/);
});

test("client invoice view: card reads 'Invoice status', not 'Payment status'", async () => {
  const s = await src("src/features/invoices/ClientInvoiceView.jsx");
  assert.match(s, />Invoice status</);
  assert.doesNotMatch(s, />Payment status</);
  // the value itself is untouched — still states.payment.label
  assert.match(s, /\{states\.payment\.label\}/);
});

test("no underlying business logic changed — states.payment / getInvoiceDisplayStates is untouched", async () => {
  const s = await src("src/features/invoices/invoiceDisplayStatus.js");
  assert.match(s, /const status = invoice\.status \|\| "draft";/, "still derived from invoice.status, not a new field");
});
