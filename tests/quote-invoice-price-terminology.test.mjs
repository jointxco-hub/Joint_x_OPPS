import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

// Phase B1 — label-only terminology cleanup. "Rate" -> "Price" on both line
// editors, "Unit" -> "Price" on the commercial document's unit-price column.
// The underlying `rate` property, DB columns, and API payloads are
// untouched — these tests assert on display label text only.

test("QuoteLineItemsEditor: unit-price field is labeled 'Price', not 'Rate'", async () => {
  const s = await src("src/features/quotes/QuoteLineItemsEditor.jsx");
  assert.match(s, /<LabeledNumber label="Price" className="md:col-span-2">/);
  assert.doesNotMatch(s, /label="Rate"/);
  // the underlying field name is untouched
  assert.match(s, /value=\{item\.rate \?\? ""\}/);
});

test("InvoiceLineItemsEditor: unit-price field is labeled 'Price', not 'Rate'", async () => {
  const s = await src("src/features/invoices/InvoiceLineItemsEditor.jsx");
  assert.match(s, /<LabeledNumber label="Price" className="md:col-span-2">/);
  assert.doesNotMatch(s, /label="Rate"/);
  assert.match(s, /value=\{item\.rate \?\? ""\}/);
});

test("CommercialDocument: line-table unit-price column is labeled 'Price', not 'Unit'", async () => {
  const s = await src("src/features/commercial-doc/CommercialDocument.jsx");
  assert.match(s, /<span className="commercial-doc__num">Price<\/span>/);
  assert.match(s, /<RowAmount label="Price" value=\{money\(line\.rate, c\)\} \/>/);
  assert.doesNotMatch(s, />Unit</);
  assert.doesNotMatch(s, /label="Unit"/);
  // the quantity row still carries the real unit-of-measure (ea/job/etc) inline
  assert.match(s, /label="Qty" value=\{`\$\{line\.quantity\}\$\{line\.unit \? ` \$\{line\.unit\}` : ""\}`\}/);
});

test("QuoteLineItemsEditor and InvoiceLineItemsEditor import the shared LabeledNumber instead of each defining its own", async () => {
  const quote = await src("src/features/quotes/QuoteLineItemsEditor.jsx");
  const invoice = await src("src/features/invoices/InvoiceLineItemsEditor.jsx");
  assert.match(quote, /import LabeledNumber from "@\/features\/lineItems\/LabeledNumber";/);
  assert.match(invoice, /import LabeledNumber from "@\/features\/lineItems\/LabeledNumber";/);
  assert.doesNotMatch(quote, /function LabeledNumber\(/);
  assert.doesNotMatch(invoice, /function LabeledNumber\(/);
});

test("shared LabeledNumber preserves the original markup/behavior", async () => {
  const s = await src("src/features/lineItems/LabeledNumber.jsx");
  assert.match(s, /className=\{`block rounded-lg bg-secondary\/25 px-2 py-1 \$\{className\}`\}/);
  assert.match(s, /\{label\}/);
  assert.match(s, /\{children\}/);
});

test("InvoiceLineItemsEditor: remove/save-template buttons use Quote's mobile-first touch-target pattern", async () => {
  const s = await src("src/features/invoices/InvoiceLineItemsEditor.jsx");
  assert.match(s, /aria-label="Save line item"[\s\S]{0,40}/);
  assert.match(s, /className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary sm:h-8 sm:w-8"/);
  assert.match(s, /className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive sm:h-8 sm:w-8"/);
  assert.doesNotMatch(s, /className="grid h-8 w-8 place-items-center/);
});

test("no calculation, validation, or API logic was touched by this terminology/dedupe slice", async () => {
  const calc = await src("src/features/invoices/invoiceCalculations.js");
  assert.match(calc, /export function calculateInvoiceLine\(item = \{\}\)/);
  const validation = await src("src/features/invoices/invoiceValidation.js");
  assert.match(validation, /export function validateInvoice\(invoice = \{\}, items = \[\], context = \{\}\)/);
});
