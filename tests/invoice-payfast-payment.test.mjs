import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260913110000_invoice_payfast_payment.sql";

// begin_invoice_payment / apply_invoice_payfast_payment — the two RPCs
// behind the public invoice Pay CTA. Mirrors the static-SQL-source test
// convention of record-manual-invoice-payment.test.mjs.

test("1 · migration is additive only — no opps_invoices/PayFast/P1A function edits, no record_manual_invoice_payment touch", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /create or replace function public\.begin_invoice_payment\(/);
  assert.match(sql, /create or replace function public\.apply_invoice_payfast_payment\(/);
  assert.match(sql, /create unique index if not exists invoice_payments_payfast_ref_once/);
  assert.doesNotMatch(sql, /alter table[\s\S]*opps_invoices/i);
  assert.doesNotMatch(sql, /drop constraint/i);
  assert.doesNotMatch(sql, /(create or replace|drop|alter)\s+function\s+public\.(get_public_invoice|record_manual_invoice_payment|invoice_amount_paid|invoice_balance_due|invoice_payment_status|_invoice_payment_projection)/);
});

test("2 · both RPCs are revoked from public/anon/authenticated — service-role callers only", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /revoke all on function public\.begin_invoice_payment\(text\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.apply_invoice_payfast_payment\(uuid, numeric, text, jsonb\) from public, anon, authenticated;/);
  // neither is ever granted to authenticated/anon anywhere in the file
  assert.doesNotMatch(sql, /grant execute on function public\.(begin_invoice_payment|apply_invoice_payfast_payment)/);
});

test("3 · hard preflight fails loudly when the P1A ledger is absent", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /to_regclass\('public\.invoice_payments'\) is null/);
  assert.match(sql, /raise exception 'INVOICE_PAYFAST:/);
});

test("4 · begin_invoice_payment resolves strictly by share_token, same eligibility gate as get_public_invoice", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /where share_token = v_token/);
  assert.match(sql, /v_invoice\.public_visible is not true/);
  assert.match(sql, /v_invoice\.share_revoked_at is not null/);
  assert.match(sql, /v_invoice\.share_expires_at is not null and v_invoice\.share_expires_at < now\(\)/);
  assert.match(sql, /v_invoice\.status in \('draft', 'void'\)/);
});

test("5 · begin_invoice_payment never accepts a client-supplied amount — returns the server's own canonical balance", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.begin_invoice_payment");
  const end = sql.indexOf("$$;", start);
  const body = sql.slice(start, end);
  assert.doesNotMatch(body, /p_amount/, "the function signature takes only p_token — no amount parameter exists to accept");
  assert.match(body, /v_balance := public\.invoice_balance_due\(v_invoice\.id\)/);
  assert.match(body, /'amount', round\(v_balance, 2\)/);
});

test("6 · begin_invoice_payment collapses every ineligible state to one generic reason (no state leaked)", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.begin_invoice_payment");
  const end = sql.indexOf("$$;", start);
  const body = sql.slice(start, end);
  // one UNAVAILABLE for an empty/missing token, one shared by
  // not-found/revoked/expired/draft/void — never a distinct reason per case
  const unavailableCount = (body.match(/'reason', 'UNAVAILABLE'/g) || []).length;
  assert.equal(unavailableCount, 2, "empty-token and not-found/revoked/expired/draft/void each resolve to the same generic reason, not a per-case one");
  assert.match(body, /'reason', 'ALREADY_PAID'/);
});

test("7 · apply_invoice_payfast_payment locks the invoice FOR UPDATE before writing", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /from public\.opps_invoices where id = p_invoice_id for update/);
});

test("8 · apply_invoice_payfast_payment is idempotent on (invoice_id, pf_payment_id), disjoint from the manual index", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /where invoice_id = p_invoice_id and source = 'payfast' and reference = v_ref/);
  assert.match(sql, /on conflict \(invoice_id, reference\) where source = 'payfast' and reference is not null/);
  assert.match(sql, /where source = 'payfast' and reference is not null/);
  // the payfast index predicate must never collide with the manual one
  assert.doesNotMatch(sql, /invoice_payments_payfast_ref_once[\s\S]{0,120}source = 'manual'/);
});

test("9 · apply_invoice_payfast_payment REJECTS an amount exceeding the current balance — never records it, never clamps it", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  // the accept/reject boundary is the LIVE balance, with the same ±R0.02
  // tolerance record_manual_invoice_payment already uses — not the
  // invoice total, and not an exact-match-only comparison (a valid
  // partial payment, amount <= balance, must still be accepted).
  assert.match(body, /if v_amount > v_balance \+ 0\.02 then/);
  const overpayBranchStart = body.indexOf("if v_amount > v_balance + 0.02 then");
  const overpayBranchEnd = body.indexOf("end if;", overpayBranchStart);
  const overpayBranch = body.slice(overpayBranchStart, overpayBranchEnd);
  assert.doesNotMatch(overpayBranch, /insert into public\.invoice_payments/, "the overpayment branch must never insert a ledger row");
  assert.match(overpayBranch, /insert into public\.opps_invoice_activity/, "the rejection must still be durably logged for reconciliation");
  assert.match(overpayBranch, /'INVOICE_PAYMENT_OVERPAYMENT_REJECTED'/);
  assert.match(overpayBranch, /'ok', false/, "the RPC returns ok:false — the edge function's existing `!(data as any)?.ok` check already treats this as a clean rejection, no X LAB change needed");
  // never silently clamp: the rejection response echoes what PayFast
  // actually reports, not a reduced/rounded-down number
  assert.match(body, /'received', v_amount/);
});

test("9b · a valid partial payment (amount <= balance) is accepted and recorded at the actual amount — the overpayment fix must not break intentional partial payments", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  const insertStart = body.indexOf("-- ── valid amount");
  assert.notEqual(insertStart, -1);
  const insertSection = body.slice(insertStart, insertStart + 400);
  assert.match(insertSection, /insert into public\.invoice_payments/);
  assert.match(insertSection, /v_amount, now\(\), 'payfast', v_ref, 'payfast'/, "records the ACTUAL amount received, not the full balance");
});

test("9c · an invoice with nothing left owing ignores a further ITN as INVOICE_ALREADY_PAID, distinct from an overpayment rejection", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  assert.match(body, /v_status_before = 'paid' or v_balance <= 0/);
  assert.match(body, /'ignored', true, 'reason', 'INVOICE_ALREADY_PAID'/);
  // this check must run BEFORE the overpayment rejection, so a fully-paid
  // invoice is diagnosed as "already paid", not "overpayment"
  const alreadyPaidAt = body.indexOf("'INVOICE_ALREADY_PAID'");
  const overpaidAt = body.indexOf("INVOICE_PAYMENT_OVERPAYMENT_REJECTED");
  assert.ok(alreadyPaidAt > -1 && overpaidAt > -1 && alreadyPaidAt < overpaidAt);
});

test("10 · apply_invoice_payfast_payment writes exactly two activity-insert SITES (rejection + success), each firing on a disjoint path, never both for one call", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  const activityInserts = (body.match(/insert into public\.opps_invoice_activity/g) || []).length;
  assert.equal(activityInserts, 2, "one for the overpayment-rejection path, one for the successfully-recorded-payment path — both replay/ignored paths return before either");
  assert.match(body, /'invoice_payment_recorded'/);
  assert.match(body, /'invoice_payment_rejected'/);
  // both inserts are created_by NULL - neither is a staff action
  const nullCreatedBy = (body.match(/\),\s*\n\s*null\s*\n\s*\);/g) || []).length;
  assert.equal(nullCreatedBy, 2, "created_by is NULL on both activity inserts — this is a webhook-reconciled payment, not a staff action, whether accepted or rejected");
});

test("11 · apply_invoice_payfast_payment never touches xlab_orders / xlab_payments / the order-linked bridge", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const body = sql.slice(start);
  assert.doesNotMatch(body, /xlab_orders|xlab_payments/);
});

test("12 · same payment-cycle status mirror rules as record_manual_invoice_payment — never overwrites draft/void/exported/imported_to_zoho", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /v_invoice\.status in \('approved', 'partially_paid'\)/);
  assert.match(sql, /v_invoice\.status = 'overdue' and v_status_after = 'paid'/);
});
