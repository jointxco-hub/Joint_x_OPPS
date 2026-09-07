import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260907120000_record_manual_invoice_payment.sql";
const API = "src/api/invoices.js";
const MODAL = "src/features/invoices/InvoicePaymentModal.jsx";
const DRAWER = "src/features/invoices/InvoiceDetailDrawer.jsx";
const PAGE = "src/pages/Invoices.jsx";

// ── migration: canonical RPC shape ────────────────────────────────────

test("1 · migration is additive only - no opps_invoices schema / PayFast / P1A function edits", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /create or replace function public\.record_manual_invoice_payment\(/);
  assert.match(sql, /create unique index if not exists invoice_payments_manual_ref_once/);
  assert.doesNotMatch(sql, /alter table[\s\S]*opps_invoices/i);
  assert.doesNotMatch(sql, /drop constraint/i);
  // no edits to any PayFast or P1A/P3 function (mentions in comments are fine)
  assert.doesNotMatch(sql, /(create or replace|drop|alter)\s+function\s+\S*payfast/i);
  assert.doesNotMatch(sql, /create or replace function public\.(invoice_amount_paid|invoice_balance_due|_invoice_payment_projection|_public_invoice_projection|get_public_invoice|reconcile_invoice_with_order|apply_invoice_payfast_payment)/);
});

test("2 · hard preflight fails loudly when the P1A ledger is absent", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /to_regclass\('public\.invoice_payments'\) is null/);
  assert.match(sql, /raise exception 'MANUAL_PAYMENT:/);
  assert.match(sql, /to_regprocedure\('public\.invoice_amount_paid\(uuid\)'\)/);
});

test("3 · auth + finance + tenant enforced server-side", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /v_user_id\s+uuid\s*:=\s*auth\.uid\(\)/);
  assert.match(sql, /INVOICE_PAYMENT_AUTH_REQUIRED/);
  assert.match(sql, /can_access_tenant\(v_invoice\.tenant_id\)/);
  assert.match(sql, /is_app_admin\(\)\s+or\s+public\.user_finance_level\(\)\s+in\s*\(1,\s*2\)/);
  assert.match(sql, /INVOICE_PAYMENT_ACCESS_DENIED/);
});

test("4 · invoice locked FOR UPDATE to serialise concurrent payment writes", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /from public\.opps_invoices where id = p_invoice_id for update/);
});

test("5 · draft / void invoices are rejected", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /v_invoice\.status = 'draft'[\s\S]*INVOICE_PAYMENT_INVOICE_NOT_APPROVED/);
  assert.match(sql, /v_invoice\.status = 'void'[\s\S]*INVOICE_PAYMENT_INVOICE_VOID/);
});

test("6 · amount must be positive with <= 2dp precision, no silent rounding", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /v_amount := round\(p_amount, 2\)/);
  assert.match(sql, /v_amount <= 0[\s\S]*INVOICE_PAYMENT_AMOUNT_INVALID/);
  assert.match(sql, /v_amount <> round\(p_amount, 6\)[\s\S]*INVOICE_PAYMENT_AMOUNT_PRECISION/);
});

test("7 · payment reference is mandatory", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /v_ref\s+text\s*:=\s*nullif\(btrim\(p_reference\), ''\)/);
  assert.match(sql, /v_ref is null[\s\S]*INVOICE_PAYMENT_REFERENCE_REQUIRED/);
});

test("8 · idempotent replay on (invoice, reference); conflicting amount/date/method rejected", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /from public\.invoice_payments\s+where invoice_id = p_invoice_id and source = 'manual' and reference = v_ref/);
  assert.match(sql, /round\(v_existing\.amount, 2\) <> v_amount/);
  assert.match(sql, /INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT/);
  assert.match(sql, /'replayed', true/);
});

test("9 · cross-source guard blocks manual entry while a linked order has an unreconciled completed payment", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /v_invoice\.source_order_id is not null/);
  assert.match(sql, /xp\.status = 'completed'/);
  assert.match(sql, /not exists \(\s*select 1 from public\.invoice_payments ip\s+where ip\.invoice_id = p_invoice_id and ip\.xlab_payment_id = xp\.id/);
  assert.match(sql, /INVOICE_PAYMENT_UNRECONCILED_ORDER_PAYMENT/);
});

test("10 · overpayment guard is ledger-derived with a currency tolerance", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /v_paid\s*:=\s*public\.invoice_amount_paid\(p_invoice_id\)/);
  assert.match(sql, /v_paid \+ v_amount > v_total \+ 0\.02/);
  assert.match(sql, /INVOICE_PAYMENT_OVERPAYMENT/);
});

test("11 · one auditable row; cache left to the P1A trigger; on-conflict is a safe replay", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /insert into public\.invoice_payments \(/);
  assert.match(sql, /'manual'/);
  assert.match(sql, /on conflict \(invoice_id, reference\) where source = 'manual' and reference is not null\s+do nothing/);
  // never writes the cache columns directly
  assert.doesNotMatch(sql, /update public\.opps_invoices set (amount_paid|balance_due)/);
});

test("12 · grants: revoked from public/anon, executable by authenticated only", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /revoke all on function public\.record_manual_invoice_payment\([^)]*\) from public, anon/);
  assert.match(sql, /grant execute on function public\.record_manual_invoice_payment\([^)]*\) to authenticated/);
  assert.doesNotMatch(sql, /to anon;/);
});

// ── api/invoices.js: RPC-only payment path ────────────────────────────

test("13 · legacy direct-write payment functions are gone", async () => {
  const js = await src(API);
  assert.doesNotMatch(js, /export async function markInvoicePaid\b/);
  assert.doesNotMatch(js, /export async function markInvoicePartiallyPaid\b/);
  // no direct status:"paid" / status:"partially_paid" cache write anywhere
  assert.doesNotMatch(js, /\.update\(\{\s*\n?\s*status: "paid",\s*\n?\s*amount_paid:/);
});

test("14 · recordManualInvoicePayment calls the canonical RPC with mapped errors", async () => {
  const js = await src(API);
  assert.match(js, /export async function recordManualInvoicePayment\(/);
  assert.match(js, /supabase\.rpc\("record_manual_invoice_payment", params\)/);
  assert.match(js, /rpcSafetyError\(error, MANUAL_PAYMENT_ERROR_MESSAGES/);
  for (const code of [
    "INVOICE_PAYMENT_AUTH_REQUIRED",
    "INVOICE_PAYMENT_ACCESS_DENIED",
    "INVOICE_PAYMENT_REFERENCE_REQUIRED",
    "INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT",
    "INVOICE_PAYMENT_UNRECONCILED_ORDER_PAYMENT",
    "INVOICE_PAYMENT_OVERPAYMENT",
  ]) {
    assert.match(js, new RegExp(code), `error map missing ${code}`);
  }
});

test("15 · getInvoicePaymentSummary reads the ledger projection RPC", async () => {
  const js = await src(API);
  assert.match(js, /export async function getInvoicePaymentSummary\(/);
  assert.match(js, /supabase\.rpc\("get_invoice_payment_summary", \{\s*\n?\s*p_invoice_id: invoiceId,?\s*\n?\s*\}\)/);
});

test("16 · recordInvoicePayment orchestrator: RPC -> display status sync -> activity -> fresh row", async () => {
  const js = await src(API);
  assert.match(js, /export async function recordInvoicePayment\(/);
  assert.match(js, /await recordManualInvoicePayment\(/);
  assert.match(js, /if \(!result\.replayed\) \{/);
  assert.match(js, /syncInvoiceDisplayStatusFromLedger\(invoice\.id, invoice\.status, result\.projection\)/);
  assert.match(js, /activity_type: "invoice_payment_recorded"/);
  assert.match(js, /const fresh = await getInvoice\(invoice\.id\)/);
});

test("17 · display status sync is derived + non-fatal, never touches draft/void", async () => {
  const js = await src(API);
  assert.match(js, /payment_status === "paid"\s*\n?\s*\?\s*"paid"/);
  assert.match(js, /"partial"\s*\n?\s*\?\s*"partially_paid"/);
  assert.match(js, /\["void", "draft"\]\.includes\(currentStatus\)/);
  assert.match(js, /invoiceDiagnostic\("invoice-status-sync-failed"/);
});

// ── payment modal ────────────────────────────────────────────────────

test("18 · payment modal has amount / method / reference / date / note + confirm", async () => {
  const jsx = await src(MODAL);
  assert.match(jsx, /value: "eft", label: "EFT \/ bank transfer"/);
  assert.match(jsx, /value: "cash"/);
  assert.match(jsx, /value: "card"/);
  assert.match(jsx, /value: "other"/);
  assert.match(jsx, /id="invoice-payment-amount"/);
  assert.match(jsx, /id="invoice-payment-reference"/);
  assert.match(jsx, /id="invoice-payment-date"/);
  assert.match(jsx, /id="invoice-payment-note"/);
  assert.match(jsx, /Confirm payment/);
});

test("19 · modal defaults amount to the outstanding balance except in partial mode", async () => {
  const jsx = await src(MODAL);
  assert.match(jsx, /mode === "partial" \? "" : balance > 0 \? String\(balance\.toFixed\(2\)\) : ""/);
});

test("20 · modal blocks submit while pending, on empty reference, and on overpayment", async () => {
  const jsx = await src(MODAL);
  assert.match(jsx, /const referenceValid = reference\.trim\(\)\.length > 0/);
  assert.match(jsx, /amountNumber > balance \+ OVERPAY_TOLERANCE/);
  assert.match(jsx, /const canSubmit = amountValid && !overBalance && referenceValid && !isPending/);
  assert.match(jsx, /disabled=\{!canSubmit\}/);
});

test("21 · modal never reports success optimistically - closes only after onSubmit resolves", async () => {
  const jsx = await src(MODAL);
  assert.match(jsx, /await onSubmit\?\.\(\{[\s\S]*?\}\);\s*\n\s*onOpenChange\?\.\(false\)/);
  assert.match(jsx, /catch \(error\) \{\s*\n\s*setSubmitError/);
  // no toast / success text fired inside the modal itself
  assert.doesNotMatch(jsx, /toast\./);
});

test("22 · reconcile mode is a distinct, labelled path", async () => {
  const jsx = await src(MODAL);
  assert.match(jsx, /mode === "reconcile"/);
  assert.match(jsx, /Reconcile recorded payment/);
  assert.match(jsx, /does not collect money again|no new payment collected/);
});

// ── drawer + page wiring ─────────────────────────────────────────────

test("23 · drawer routes every payment through the modal; no inline partial dialog", async () => {
  const jsx = await src(DRAWER);
  assert.match(jsx, /import InvoicePaymentModal from "\.\/InvoicePaymentModal"/);
  assert.match(jsx, /<InvoicePaymentModal/);
  assert.match(jsx, /onSubmit=\{\(payload\) => onRecordPayment\?\.\(invoice, payload\)\}/);
  assert.doesNotMatch(jsx, /Mark partially paid/);
  assert.doesNotMatch(jsx, /onMarkPaid|onMarkPartiallyPaid/);
});

test("24 · drawer uses ledger-derived balance, not the opps_invoices cache columns", async () => {
  const jsx = await src(DRAWER);
  assert.match(jsx, /ledgerSummary\?\.balance_due/);
  assert.match(jsx, /ledgerSummary\?\.amount_paid/);
});

test("25 · legacy already-paid invoice with an empty ledger shows Reconcile, not Record payment", async () => {
  const jsx = await src(DRAWER);
  assert.match(jsx, /const needsReconcile = Boolean\(invoice\)/);
  assert.match(jsx, /invoice\.status === "paid"/);
  assert.match(jsx, /ledgerPaid < 0\.01/);
  assert.match(jsx, /openPayment\("reconcile"\)/);
});

test("26 · Invoices page: single recordPaymentMutation, summary query, no legacy imports", async () => {
  const jsx = await src(PAGE);
  assert.doesNotMatch(jsx, /markInvoicePaid|markInvoicePartiallyPaid/);
  assert.match(jsx, /recordInvoicePayment/);
  assert.match(jsx, /getInvoicePaymentSummary/);
  assert.match(jsx, /const recordPaymentMutation = useMutation\(/);
  assert.match(jsx, /queryKey: \["invoicePaymentSummary", selectedInvoice\?\.id\]/);
  assert.match(jsx, /recordPaymentMutation\.mutateAsync\(\{ invoice, \.\.\.payload \}\)/);
  assert.match(jsx, /isRecordPaymentPending=\{recordPaymentMutation\.isPending\}/);
});

test("27 · page reports replay safely and refreshes the canonical summary", async () => {
  const jsx = await src(PAGE);
  assert.match(jsx, /result\?\.replayed \? "That payment was already recorded" : "Payment recorded"/);
  assert.match(jsx, /invalidateQueries\(\{ queryKey: \["invoicePaymentSummary", selectedInvoice\?\.id\] \}\)/);
});
