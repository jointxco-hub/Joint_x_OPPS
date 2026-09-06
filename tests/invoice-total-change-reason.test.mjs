import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INVOICE_CHANGE_REASON_TYPES,
  CUSTOM_REASON,
  isChangeReasonValid,
  buildOverrideReasonString,
  detectCommercialTotalChange,
} from "../src/features/invoices/invoiceChangeReason.js";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const line = (over = {}) => ({
  line_key: "k1", item_name: "DTF Printing", quantity: 5, rate: 149, discount: 0, tax_percentage: 0, ...over,
});
const savedInvoice = (items, over = {}) => ({
  id: "inv-1", shipping_charge: 0, adjustment: 0, currency_code: "ZAR", items, ...over,
});

// ── 1. unchanged total => no modal ──────────────────────────────────────

test("1 · identical items + invoice => not changed (modal must not open)", () => {
  const prev = savedInvoice([line()]);
  const r = detectCommercialTotalChange(prev, { ...prev }, [line()]);
  assert.equal(r.changed, false);
  assert.equal(r.changes.length, 0);
});

test("1b · editing a brand-new invoice (no id) never requires a reason", () => {
  const r = detectCommercialTotalChange({ items: [] }, { shipping_charge: 0 }, [line()]);
  assert.equal(r.changed, false);
});

test("1c · non-commercial edit (notes only) => not changed", () => {
  const prev = savedInvoice([line()], { notes: "old" });
  const r = detectCommercialTotalChange(prev, { ...prev, notes: "new note text" }, [line()]);
  assert.equal(r.changed, false);
});

// ── 2-5. each commercial edit opens the modal ──────────────────────────

test("2 · line price change => changed, with a readable diff", () => {
  const r = detectCommercialTotalChange(savedInvoice([line()]), savedInvoice([line({ rate: 148 })]), [line({ rate: 148 })]);
  assert.equal(r.changed, true);
  assert.ok(r.changes.some((c) => /DTF Printing price/.test(c.label) && /149/.test(c.from) && /148/.test(c.to)));
  assert.ok(r.nextTotal < r.previousTotal);
});

test("3 · quantity change => changed", () => {
  const r = detectCommercialTotalChange(savedInvoice([line()]), savedInvoice([line({ quantity: 6 })]), [line({ quantity: 6 })]);
  assert.equal(r.changed, true);
  assert.ok(r.changes.some((c) => /quantity/.test(c.label) && c.from === "5" && c.to === "6"));
});

test("4 · discount change => changed", () => {
  const r = detectCommercialTotalChange(savedInvoice([line()]), savedInvoice([line({ discount: 15 })]), [line({ discount: 15 })]);
  assert.equal(r.changed, true);
  assert.ok(r.changes.some((c) => /discount/i.test(c.label)));
});

test("5 · shipping change that moves the total => changed", () => {
  const r = detectCommercialTotalChange(
    savedInvoice([line()], { shipping_charge: 0 }),
    savedInvoice([line()], { shipping_charge: 120 }),
    [line()],
  );
  assert.equal(r.changed, true);
  assert.ok(r.changes.some((c) => /Shipping/.test(c.label)));
  assert.equal(Math.round(r.nextTotal - r.previousTotal), 120);
});

test("5b · line add / remove => changed", () => {
  const add = detectCommercialTotalChange(savedInvoice([line()]), savedInvoice([line(), line({ line_key: "k2", item_name: "Setup" })]), [line(), line({ line_key: "k2", item_name: "Setup" })]);
  assert.equal(add.changed, true);
  assert.ok(add.changes.some((c) => /Added: Setup/.test(c.label)));
  const rem = detectCommercialTotalChange(savedInvoice([line(), line({ line_key: "k2", item_name: "Setup" })]), savedInvoice([line()]), [line()]);
  assert.equal(rem.changed, true);
  assert.ok(rem.changes.some((c) => /Removed: Setup/.test(c.label)));
});

test("5c · a rate+qty swap that nets to the same total STILL requires a reason (per-line audit)", () => {
  const before = line({ rate: 100, quantity: 6 }); // 600
  const after = line({ rate: 120, quantity: 5 });  // 600
  const r = detectCommercialTotalChange(savedInvoice([before]), savedInvoice([after]), [after]);
  assert.equal(r.nextTotal, r.previousTotal);
  assert.equal(r.changed, true, "line-level change is audited even when the total is unchanged");
});

// ── 6-9. reason serialization ────────────────────────────────────────

test("6 · a preset reason alone is valid and serializes to just its label", () => {
  assert.equal(isChangeReasonValid("pricing_correction", ""), true);
  assert.equal(buildOverrideReasonString("pricing_correction", ""), "Pricing correction");
});

test("7 · preset + note => 'Label — note'", () => {
  assert.equal(
    buildOverrideReasonString("client_requested", "  Customer approved revised DTF price "),
    "Client-requested change — Customer approved revised DTF price",
  );
});

test("8 · Custom reason without a note is invalid and serializes to empty", () => {
  assert.equal(isChangeReasonValid(CUSTOM_REASON, ""), false);
  assert.equal(isChangeReasonValid(CUSTOM_REASON, "   "), false);
  assert.equal(buildOverrideReasonString(CUSTOM_REASON, ""), "");
});

test("9 · Custom reason + note => 'Custom reason — note'", () => {
  assert.equal(isChangeReasonValid(CUSTOM_REASON, "supplier clarified setup fee"), true);
  assert.equal(
    buildOverrideReasonString(CUSTOM_REASON, "supplier clarified setup fee"),
    "Custom reason — supplier clarified setup fee",
  );
});

test("9b · the dropdown carries all ten presets, Custom last", () => {
  assert.equal(INVOICE_CHANGE_REASON_TYPES.length, 10);
  assert.equal(INVOICE_CHANGE_REASON_TYPES.at(-1).value, CUSTOM_REASON);
  for (const label of ["Pricing correction", "Client-requested change", "Quantity changed", "Discount adjustment",
    "Shipping adjustment", "Product/service changed", "Typo/data-entry correction", "Approved special price",
    "Internal correction", "Custom reason"]) {
    assert.ok(INVOICE_CHANGE_REASON_TYPES.some((r) => r.label === label), `preset present: ${label}`);
  }
});

// ── 10-13. save-flow wiring (source assertions) ──────────────────────

test("10-12 · InvoiceCreateFlow holds the save behind the modal on a commercial change, both Save draft and Approve", async () => {
  const s = await src("src/features/invoices/InvoiceCreateFlow.jsx");
  assert.match(s, /const change = detectCommercialTotalChange\(initialInvoice, calculated\.invoice, calculated\.items\)/);
  assert.match(s, /if \(change\.changed\) \{\s*[\s\S]*?setPendingReason\(\{ status, \.\.\.change \}\)/);
  assert.match(s, /performSubmit\(status\);/, "no-change path saves immediately");
  // Save draft + Approve both go through submit()
  assert.match(s, /onClick=\{\(\) => submit\("draft"\)\}/);
  assert.match(s, /onClick=\{\(\) => submit\("approved"\)\}/);
  assert.match(s, /mode=\{pendingReason\?\.status === "approved" \? "approve" : "save"\}/);
});

test("10 · Cancel clears the pending save without calling onSave", async () => {
  const s = await src("src/features/invoices/InvoiceCreateFlow.jsx");
  assert.match(s, /onCancel=\{\(\) => setPendingReason\(null\)\}/);
});

test("11-12 · on confirm, the reason is threaded to total_override_reason + allow_total_override + every line's change_reason", async () => {
  const s = await src("src/features/invoices/InvoiceCreateFlow.jsx");
  const fn = s.slice(s.indexOf("const performSubmit ="), s.indexOf("const submit ="));
  assert.match(fn, /total_override_reason: reason, allow_total_override: true/);
  assert.match(fn, /change_reason: String\(it\.change_reason \|\| ""\)\.trim\(\) \|\| reason/);
  assert.ok(!/total_override_by|total_override_at/.test(fn), "by/at are stamped server-side, never sent from the client");
});

test("13 · retriable failure keeps the modal mounted (pendingReason not cleared on confirm)", async () => {
  const s = await src("src/features/invoices/InvoiceCreateFlow.jsx");
  const onConfirm = s.slice(s.indexOf("onConfirm={(reasonString) =>"), s.indexOf("onConfirm={(reasonString) =>") + 400);
  assert.ok(!/setPendingReason\(null\)/.test(onConfirm), "confirm does NOT clear pendingReason — success unmounts the flow, failure leaves it open");
  assert.match(s, /isSubmitting=\{isSaving\}/);
  const modal = await src("src/features/invoices/InvoiceTotalChangeReasonModal.jsx");
  assert.match(modal, /useEffect\(\(\) => \{\s*if \(open\) \{\s*setReasonType\(""\);\s*setNote\(""\);/, "reason state resets only on a fresh open, not on every render");
});

// ── API layer ───────────────────────────────────────────────────────

test("api: saveInvoiceWithItemsTransaction passes p_allow_total_override; RPC stays 7-arg canonical", async () => {
  const s = await src("src/api/invoices.js");
  assert.match(s, /p_allow_total_override: Boolean\(allowTotalOverride\)/);
  assert.match(s, /allowTotalOverride: Boolean\(input\.allow_total_override\)/);
  assert.match(s, /total_override_reason: nullableField\(invoice, "total_override_reason"\)/);
  // still one RPC name, no schema/table writes for override fields from JS
  const rpcs = [...new Set(s.match(/supabase\.rpc\("[a-z_]+"/g) || [])];
  assert.ok(rpcs.includes('supabase.rpc("save_opps_invoice_with_items"'));
  assert.ok(!/opps_invoices[\s\S]{0,40}total_override_by|update .*total_override_at/i.test(s), "client never writes total_override_by/at");
});

test("14-15 · reason reaches the existing item-version audit trail, no schema change", async () => {
  const s = await src("src/api/invoices.js");
  // recordInvoiceItemVersions already persists item.change_reason to
  // opps_invoice_item_versions — the modal feeds that same field.
  assert.match(s, /reason: item\.change_reason/);
  assert.ok(!/alter table|add column|create table/i.test(s), "no schema/migration in the API layer");
});

test("no new migration file added by this change", async () => {
  const s = await src("src/features/invoices/invoiceChangeReason.js");
  assert.ok(!/^import .*supabase|from ["'].*supabaseClient|\.rpc\(|alter table|add column/im.test(s),
    "the reason module is pure — no Supabase import, no DDL");
});
