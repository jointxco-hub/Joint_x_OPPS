import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

// Phase B2 — mobile line-item interaction only: compact Qty x Price ->
// Total row, collapse/expand per line (local UI state, never persisted),
// and a sticky "Add item" action on mobile. No calculation, validation,
// API payload, or picker/template domain behavior changes. These are
// static-source-text checks (this repo's existing test convention — see
// quote-invoice-conversion-ui.test.mjs) rather than rendered-DOM checks.

test("QuoteLineItemsEditor: line items can collapse/expand via local state keyed by line_key, not array index", async () => {
  const s = await src("src/features/quotes/QuoteLineItemsEditor.jsx");
  assert.match(s, /const \[collapsedKeys, setCollapsedKeys\] = useState\(\(\) => new Set\(\)\);/);
  assert.match(s, /function lineKeyFor\(item, index\) \{\s*\n\s*return item\?\.line_key \|\| `idx-\$\{index\}`;/);
  assert.match(s, /const expanded = !collapsedKeys\.has\(key\);/);
  assert.match(s, /onToggleExpand=\{\(\) => toggleExpand\(item, index\)\}/);
});

test("InvoiceLineItemsEditor: line items can collapse/expand via local state keyed by line_key, not array index", async () => {
  const s = await src("src/features/invoices/InvoiceLineItemsEditor.jsx");
  assert.match(s, /const \[collapsedKeys, setCollapsedKeys\] = useState\(\(\) => new Set\(\)\);/);
  assert.match(s, /function lineKeyFor\(item, index\) \{\s*\n\s*return item\?\.line_key \|\| `idx-\$\{index\}`;/);
  assert.match(s, /const expanded = !collapsedKeys\.has\(key\);/);
  assert.match(s, /onToggleExpand=\{\(\) => toggleExpand\(item, index\)\}/);
});

test("LineItemCard: collapsed summary includes item name, quantity, and total", async () => {
  const s = await src("src/features/lineItems/LineItemCard.jsx");
  // name (with an unnamed-line fallback)
  assert.match(s, /const displayName = String\(itemName \|\| ""\)\.trim\(\) \|\| "New item";/);
  assert.match(s, /\{index \+ 1\} · \{displayName\}/);
  // qty + price + total in the same collapsed summary line
  assert.match(s, /Qty \{Number\(quantity \|\| 0\)\} · \{formatMoney\(rate\)\} each · \{formatMoney\(total\)\}/);
  // summary only renders while collapsed, not duplicated while expanded
  assert.match(s, /\{!expanded \? \(/);
});

test("newly added line is expanded by default (collapsedKeys never grows on add)", async () => {
  for (const file of [
    "src/features/quotes/QuoteLineItemsEditor.jsx",
    "src/features/invoices/InvoiceLineItemsEditor.jsx",
  ]) {
    const s = await src(file);
    // collapsedKeys starts empty, so nothing is collapsed on mount, and
    // addItem never touches collapsedKeys — a freshly appended item's key
    // can never already be in the set, so it is expanded by construction.
    const addFn = s.match(/const addItem = \(\) => [^\n]+;/);
    assert.ok(addFn, `${file}: addItem not found`);
    assert.ok(!addFn[0].includes("setCollapsedKeys"), `${file}: addItem must not touch collapsedKeys`);
  }
});

test("removing a line removes only that line's own key from collapsedKeys — it does not reindex or corrupt other lines' expanded state", async () => {
  for (const file of [
    "src/features/quotes/QuoteLineItemsEditor.jsx",
    "src/features/invoices/InvoiceLineItemsEditor.jsx",
  ]) {
    const s = await src(file);
    const removeFn = s.match(/const removeItem = \(index\) => \{[\s\S]*?\n  \};/);
    assert.ok(removeFn, `${file}: removeItem not found`);
    const body = removeFn[0];
    // keyed by the removed item's own line_key, not its positional index
    assert.match(body, /const removedKey = lineKeyFor\(safeItems\[index\], index\);/);
    assert.match(body, /nextSet\.delete\(removedKey\);/);
    // never clears/rebuilds the whole set (which would collapse/expand
    // every other line as a side effect of removing one)
    assert.doesNotMatch(body, /setCollapsedKeys\(new Set\(\)\)/);
  }
});

test("compact mobile MoneyRow still binds quantity, rate, discount, and the already-computed total — no new calculation", async () => {
  const moneyRow = await src("src/features/lineItems/MoneyRow.jsx");
  assert.match(moneyRow, /value=\{quantity \?\? ""\}/);
  assert.match(moneyRow, /onChange=\{onQuantityChange\}/);
  assert.match(moneyRow, /value=\{rate \?\? ""\}/);
  assert.match(moneyRow, /onChange=\{onRateChange\}/);
  assert.match(moneyRow, /value=\{discount \?\? ""\}/);
  assert.match(moneyRow, /onChange=\{onDiscountChange\}/);
  assert.match(moneyRow, /\{formatMoney\(total\)\}/);
  // no calculation helper imported into the presentational component
  assert.doesNotMatch(moneyRow, /invoiceCalculations|quoteCalculations/);

  const quote = await src("src/features/quotes/QuoteLineItemsEditor.jsx");
  assert.match(quote, /quantity=\{item\.quantity\}/);
  assert.match(quote, /onQuantityChange=\{\(e\) => updateItem\(index, \{ quantity: e\.target\.value \}\)\}/);
  assert.match(quote, /total=\{calculated\.item_total\}/);
  // the existing price-review handler logic is unchanged, just passed in as a prop
  assert.match(quote, /if \(lineIsReviewEligible\(item\)\) \{/);

  const invoice = await src("src/features/invoices/InvoiceLineItemsEditor.jsx");
  assert.match(invoice, /onRateChange=\{\(event\) => updateItem\(index, \{ rate: event\.target\.value \}\)\}/);
  assert.match(invoice, /onDiscountChange=\{\(event\) => updateItem\(index, \{ discount: event\.target\.value \}\)\}/);
});

test("Quote: Add from catalogue and Add line actions are unchanged", async () => {
  const s = await src("src/features/quotes/QuoteLineItemsEditor.jsx");
  assert.match(s, /onClick=\{\(\) => setPickerOpen\(true\)\}/);
  assert.match(s, /<QuoteProductPicker\s/);
  assert.match(s, /onClick=\{addItem\}/);
  assert.match(s, /Add from catalogue/);
  assert.match(s, />\s*Add line\s*</);
});

test("Quote: picker still replaces the first blank line / appends otherwise (addFromPicker unchanged)", async () => {
  const s = await src("src/features/quotes/QuoteLineItemsEditor.jsx");
  assert.match(s, /const addFromPicker = \(primaryLine, extraLines = \[\]\) => \{/);
  assert.match(s, /const firstBlank = safeItems\.findIndex\(isBlankLine\);/);
});

test("Invoice: picker/template behavior is unchanged and the Quote picker was not introduced", async () => {
  const s = await src("src/features/invoices/InvoiceLineItemsEditor.jsx");
  // same inline multi-source picker (catalog/inventory/templates), same modes
  assert.match(s, /const pickerModes = \[/);
  assert.match(s, /\["all", "All"\]/);
  assert.match(s, /\["stock", "Stock"\]/);
  assert.match(s, /appendTemplate/);
  assert.match(s, /saveLineAsTemplate/);
  assert.match(s, /listInvoiceItemTemplates/);
  // never pulls in the quote's own picker/mapping
  assert.doesNotMatch(s, /QuoteProductPicker/);
  assert.doesNotMatch(s, /quoteProductMapping/);
});

test("StickyAddBar is sticky on mobile and reverts to static placement at sm: and up", async () => {
  const s = await src("src/features/lineItems/StickyAddBar.jsx");
  assert.match(s, /"sticky bottom-0 z-10/);
  assert.match(s, /sm:static sm:z-auto/);
  // iOS safe-area bottom padding so the bar never sits flush against the home indicator
  assert.match(s, /env\(safe-area-inset-bottom\)/);

  const quote = await src("src/features/quotes/QuoteLineItemsEditor.jsx");
  assert.match(quote, /import StickyAddBar from "@\/features\/lineItems\/StickyAddBar";/);
  const invoice = await src("src/features/invoices/InvoiceLineItemsEditor.jsx");
  assert.match(invoice, /import StickyAddBar from "@\/features\/lineItems\/StickyAddBar";/);
});

test("no persistence field was added for collapse/expand state", async () => {
  for (const file of [
    "src/features/quotes/QuoteLineItemsEditor.jsx",
    "src/features/invoices/InvoiceLineItemsEditor.jsx",
    "src/features/lineItems/LineItemCard.jsx",
  ]) {
    const s = await src(file);
    assert.doesNotMatch(s, /is_collapsed|is_expanded|collapsed_state|expanded_state/i);
    // collapsedKeys/expanded are never spread into an item patch or onChange payload
    assert.doesNotMatch(s, /updateItem\([^)]*collapsed/i);
    assert.doesNotMatch(s, /onChange\([^)]*collapsed/i);
  }
});

test("no calculation, validation, reliability, status, or API logic changed in this slice", async () => {
  const calc = await src("src/features/invoices/invoiceCalculations.js");
  assert.match(calc, /export function calculateInvoiceLine\(item = \{\}\)/);
  assert.match(calc, /export function applyInvoiceTotals\(invoice = \{\}, items = \[\]\)/);
  const quoteCalc = await src("src/features/quotes/quoteCalculations.js");
  assert.match(quoteCalc, /export function calculateQuoteTotals\(quote = \{\}, items = \[\]\)/);
  const validation = await src("src/features/invoices/invoiceValidation.js");
  assert.match(validation, /export function validateInvoice\(invoice = \{\}, items = \[\], context = \{\}\)/);
  const reliability = await src("src/features/invoices/invoiceReliability.js");
  assert.match(reliability, /assertInvoiceItemsReadyForSave/);
  const status = await src("src/features/quotes/quoteStatus.js");
  assert.match(status, /export function isQuoteEditable/);
  const quotesApi = await src("src/api/quotes.js");
  assert.match(quotesApi, /save_opps_quote_with_items/);
  const invoicesApi = await src("src/api/invoices.js");
  assert.match(invoicesApi, /export async function createInvoice/);
  const changeReason = await src("src/features/invoices/invoiceChangeReason.js");
  assert.ok(changeReason.length > 0);
});
