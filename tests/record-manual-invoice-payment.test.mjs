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

test("9b · P0 REGRESSION — opps_order_id (text) is compared to source_order_id::text, never a bare text=uuid", async () => {
  // Production/staging public.xlab_orders.opps_order_id is TEXT; opps_invoices
  // .source_order_id is UUID. A bare `xo.opps_order_id = v_invoice.source_order_id`
  // raised `operator does not exist: text = uuid` on every order-linked invoice.
  const HOTFIX = "supabase/migrations/20260907160000_fix_manual_payment_opps_order_id_text_cast.sql";
  for (const rel of [MIGRATION, "supabase/migrations/20260907130000_manual_payment_operation_key_and_proof.sql", HOTFIX]) {
    // executable SQL only — drop `--` line comments so the header explainer
    // (which quotes the old bare expression) does not trip the negative check.
    const exec = (await src(rel)).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    assert.match(exec, /xo\.opps_order_id = v_invoice\.source_order_id::text/,
      `${rel}: the cross-source guard must cast the uuid to text`);
    assert.doesNotMatch(exec, /xo\.opps_order_id = v_invoice\.source_order_id(?!::text)/,
      `${rel}: must not compare opps_order_id (text) to a bare uuid`);
  }
  // the hotfix is a pure forward `create or replace` of the 7-arg RPC — no
  // schema / policy / data changes. Check executable SQL only (comment-stripped).
  const hotfixExec = (await src(HOTFIX)).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  assert.match(hotfixExec, /create or replace function public\.record_manual_invoice_payment\(/);
  assert.match(hotfixExec, /p_operation_key text\s+default null/);
  assert.equal((hotfixExec.match(/create or replace function/gi) || []).length, 1);
  assert.doesNotMatch(hotfixExec, /create table|alter table|(create|drop|alter) policy|(create|drop) trigger|create index|drop function/i);
  assert.doesNotMatch(hotfixExec, /payfast/i);
  // no data writes at migration scope — insert/update tokens only inside the fn body
  const beforeFn = hotfixExec.slice(0, hotfixExec.search(/create or replace function/i));
  assert.doesNotMatch(beforeFn, /insert into|update public\.|delete from/i);
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
  assert.match(sql, /revoke all on function public\.record_manual_invoice_payment\(uuid, numeric, text, timestamptz, text, text\) from public, anon/);
  assert.match(sql, /grant execute on function public\.record_manual_invoice_payment\(uuid, numeric, text, timestamptz, text, text\) to authenticated/);
  assert.doesNotMatch(sql, /to anon;/);
});

test("12b · idempotency key removed - reference is the only key; 6-arg signature", async () => {
  const sql = await src(MIGRATION);
  // no idempotency_key metadata key persisted
  assert.doesNotMatch(sql, /'idempotency_key'/);
  // the nominal 7-arg version is dropped defensively before (re)create
  assert.match(sql, /drop function if exists public\.record_manual_invoice_payment\(uuid, numeric, text, timestamptz, text, text, text\)/);
  const sig = sql.slice(
    sql.indexOf("create or replace function public.record_manual_invoice_payment("),
    sql.indexOf("returns jsonb")
  );
  assert.match(sig, /p_invoice_id\s+uuid,/);
  assert.match(sig, /p_amount\s+numeric,/);
  assert.match(sig, /p_reference\s+text,/);
  assert.match(sig, /p_paid_at\s+timestamptz default now\(\),/);
  assert.match(sig, /p_method\s+text\s+default 'eft',/);
  assert.match(sig, /p_note\s+text\s+default null\s*\n\s*\)/);
  assert.doesNotMatch(sig, /p_idempotency_key/);
});

// ── api/invoices.js: RPC-only payment path ────────────────────────────

test("13 · legacy direct-write payment functions are gone", async () => {
  const js = await src(API);
  assert.doesNotMatch(js, /export async function markInvoicePaid\b/);
  assert.doesNotMatch(js, /export async function markInvoicePartiallyPaid\b/);
  // no direct status:"paid" / status:"partially_paid" cache write anywhere
  assert.doesNotMatch(js, /\.update\(\{\s*\n?\s*status: "paid",\s*\n?\s*amount_paid:/);
});

test("14 · recordManualInvoicePayment calls the canonical RPC with mapped errors, no idempotency key", async () => {
  const js = await src(API);
  assert.match(js, /export async function recordManualInvoicePayment\(/);
  assert.match(js, /supabase\.rpc\("record_manual_invoice_payment", params\)/);
  assert.match(js, /rpcSafetyError\(error, MANUAL_PAYMENT_ERROR_MESSAGES/);
  assert.doesNotMatch(js, /idempotencyKey|p_idempotency_key/);
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

test("16 · recordInvoicePayment is RPC + refetch only - NO client-side audit or status write", async () => {
  const js = await src(API);
  assert.match(js, /export async function recordInvoicePayment\(/);
  assert.match(js, /await recordManualInvoicePayment\(/);
  assert.match(js, /const fresh = await getInvoice\(invoice\.id\)/);
  // the whole recordInvoicePayment body must not write activity or status
  const body = js.slice(js.indexOf("export async function recordInvoicePayment("));
  const fnEnd = body.indexOf("\n}\n");
  const fn = body.slice(0, fnEnd);
  assert.doesNotMatch(fn, /createInvoiceActivity/);
  assert.doesNotMatch(fn, /opps_invoice_activity/);
  assert.doesNotMatch(fn, /\.update\(/);
  assert.doesNotMatch(fn, /invoice_payment_recorded/);
});

test("17 · the migration RPC does the status mirror + audit event atomically (server-side)", async () => {
  const sql = await src(MIGRATION);
  // compat status mirror, derived, guarded, no amount write
  assert.match(sql, /v_status_after\s+:= public\.invoice_payment_status\(p_invoice_id\)/);
  assert.match(sql, /v_effective_status := v_invoice\.status;\s+-- default: unchanged/);
  assert.match(sql, /when 'paid'\s+then 'paid'/);
  assert.match(sql, /when 'partial' then 'partially_paid'/);
  assert.match(sql, /update public\.opps_invoices\s*\n\s*set status = v_new_status, updated_by = v_user_id/);
  assert.match(sql, /v_effective_status := v_new_status;/);
  assert.doesNotMatch(sql, /update public\.opps_invoices[\s\S]{0,120}(amount_paid|balance_due)\s*=/);
  // one audit row, same txn, on the non-replay path; from/to = real lifecycle
  assert.match(sql, /insert into public\.opps_invoice_activity \(/);
  assert.match(sql, /'invoice_payment_recorded', 'Payment recorded'/);
  assert.match(sql, /v_invoice\.status,\s+-- from_status[\s\S]{0,80}v_effective_status,\s+-- to_status/);
  assert.doesNotMatch(sql, /coalesce\(v_new_status, v_invoice\.status\)/);
  for (const key of ["'payment_id'", "'amount'", "'source'", "'method'", "'reference'", "'actor'", "'paid_at'"]) {
    assert.match(sql, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `audit metadata missing ${key}`);
  }
});

test("17-lifecycle · compat mirror advances ONLY safe payment-cycle states, never commercial ones", async () => {
  const sql = await src(MIGRATION);
  // the write allow-list is exactly approved / partially_paid, plus overdue only when fully paid
  assert.match(sql, /if v_invoice\.status in \('approved', 'partially_paid'\) then/);
  assert.match(sql, /elsif v_invoice\.status = 'overdue' and v_status_after = 'paid' then\s*\n\s*v_new_status := 'paid';/);
  // the mutable predicate is on v_new_status, not a blunt "not in (void,draft)"
  assert.match(sql, /if v_new_status is not null and v_new_status is distinct from v_invoice\.status then/);
  assert.doesNotMatch(sql, /v_invoice\.status not in \('void', 'draft'\)/);
  // exported / imported_to_zoho must never appear in a status-write allow-list
  const mirror = sql.slice(sql.indexOf("compat status mirror"), sql.indexOf("canonical payment audit event"));
  assert.doesNotMatch(mirror, /status in \([^)]*exported/);
  assert.doesNotMatch(mirror, /status in \([^)]*imported_to_zoho/);
  assert.doesNotMatch(mirror, /set status = 'exported'|set status = 'imported_to_zoho'/);
});

test("17-failclosed · the cross-source guard fails closed on a missing/incompatible bridge", async () => {
  const sql = await src(MIGRATION);
  // no fail-open assignment in the handler
  assert.doesNotMatch(sql, /exception when undefined_table or undefined_column then\s*\n\s*v_has_unreconciled := false/);
  assert.doesNotMatch(sql, /bridge tables absent in this env/);
  // typed reject instead
  assert.match(sql, /exception when undefined_table or undefined_column then[\s\S]{0,400}raise exception using errcode = 'P0001',[\s\S]{0,200}INVOICE_PAYMENT_BRIDGE_SCHEMA_MISSING/);
  // migration preflight also requires the bridge tables
  assert.match(sql, /to_regclass\('public\.orders'\) is null\s*\n\s*or to_regclass\('public\.xlab_orders'\) is null\s*\n\s*or to_regclass\('public\.xlab_payments'\) is null/);
});

test("17-failclosed-fe · the frontend error map surfaces the bridge-schema code", async () => {
  const js = await src(API);
  assert.match(js, /INVOICE_PAYMENT_BRIDGE_SCHEMA_MISSING:\s*"[^"]+"/);
});

test("17b · both replay paths return before the audit insert (no second event on replay)", async () => {
  const sql = await src(MIGRATION);
  const auditAt = sql.indexOf("insert into public.opps_invoice_activity (");
  assert.ok(auditAt > 0);
  // the "found" replay early-return and the lost-race early-return both precede the audit insert
  const foundReturn = sql.indexOf("'replayed', true, 'payment_id', v_existing.id");
  const raceReturn = sql.indexOf("'replayed', true, 'payment_id', v_row_id");
  assert.ok(foundReturn > 0 && foundReturn < auditAt, "found-replay return must precede the audit insert");
  assert.ok(raceReturn > 0 && raceReturn < auditAt, "lost-race return must precede the audit insert");
});

test("17c · preflight also requires opps_invoice_activity + the balance/status derivations", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /to_regclass\('public\.opps_invoice_activity'\) is null/);
  assert.match(sql, /to_regprocedure\('public\.invoice_balance_due\(uuid\)'\)/);
  assert.match(sql, /to_regprocedure\('public\.invoice_payment_status\(uuid\)'\)/);
});

// ── payment summary contract ─────────────────────────────────────────

test("17d · normalisePaymentProjection handles every plausible RPC shape", async () => {
  const { normalisePaymentProjection: n } = await import("../src/features/invoices/paymentProjection.js");
  // bare jsonb object - fully paid
  assert.deepEqual(n({ amount_paid: 1715, balance_due: 0, payment_status: "paid", overdue: false }),
    { amount_paid: 1715, balance_due: 0, payment_status: "paid", overdue: false });
  // single-row array (SETOF / RETURNS TABLE) - partial
  assert.deepEqual(n([{ amount_paid: 400, balance_due: 600, payment_status: "partial", overdue: true }]),
    { amount_paid: 400, balance_due: 600, payment_status: "partial", overdue: true });
  // string numerics from PostgREST numeric columns
  assert.deepEqual(n({ amount_paid: "1715.00", balance_due: "0.00", payment_status: "paid" }),
    { amount_paid: 1715, balance_due: 0, payment_status: "paid", overdue: false });
  // payment_status absent -> derived
  assert.equal(n({ amount_paid: 0, balance_due: 100 }).payment_status, "unpaid");
  assert.equal(n({ amount_paid: 50, balance_due: 50 }).payment_status, "partial");
  assert.equal(n({ amount_paid: 100, balance_due: 0 }).payment_status, "paid");
  // null / undefined / garbage -> safe zeros
  assert.deepEqual(n(null), { amount_paid: 0, balance_due: 0, payment_status: "unpaid", overdue: false });
  assert.deepEqual(n(undefined), { amount_paid: 0, balance_due: 0, payment_status: "unpaid", overdue: false });
  assert.equal(n({ amount_paid: "not-a-number", balance_due: NaN }).amount_paid, 0);
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

test("20 · modal blocks submit while pending, on overpayment, or an unfinished upload (reference + proof optional)", async () => {
  const jsx = await src(MODAL);
  assert.match(jsx, /amountNumber > balance \+ OVERPAY_TOLERANCE/);
  assert.match(jsx, /const canSubmit = amountValid && !overBalance && !isPending && !uploading && !failed;/);
  assert.match(jsx, /disabled=\{!canSubmit\}/);
  // reference is no longer required
  assert.doesNotMatch(jsx, /referenceValid/);
  assert.match(jsx, /reference: reference\.trim\(\) \|\| null,/);
});

test("21 · modal never reports success optimistically - closes only after onSubmit resolves", async () => {
  const jsx = await src(MODAL);
  assert.match(jsx, /await onSubmit\?\.\([\s\S]*?\);\s*\n\s*succeededRef\.current = true;\s*\n\s*onOpenChange\?\.\(false\)/);
  assert.match(jsx, /catch \(error\) \{[\s\S]*setSubmitError/);
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
