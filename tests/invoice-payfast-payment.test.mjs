import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260914110000_invoice_payfast_payment.sql";

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

test("9 · apply_invoice_payfast_payment records the actual charged amount even on mismatch — flags, never silently drops it", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const body = sql.slice(start);
  assert.doesNotMatch(body, /raise exception[\s\S]{0,80}OVERPAY/i, "an amount mismatch is never rejected — the charge already happened");
  assert.match(body, /'overpaid',\s*\(v_paid > v_total \+ 0\.02\)/);
});

test("10 · apply_invoice_payfast_payment writes exactly one activity row per new payment, created_by NULL (not a staff action)", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const body = sql.slice(start);
  const activityInserts = (body.match(/insert into public\.opps_invoice_activity/g) || []).length;
  assert.equal(activityInserts, 1, "exactly one activity insert site — both replay paths return before reaching it");
  assert.match(body, /'invoice_payment_recorded'/);
  assert.match(body, /\),\s*\n\s*null\s*\n\s*\);/, "created_by is NULL — this is a webhook-reconciled payment, not a staff action");
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
