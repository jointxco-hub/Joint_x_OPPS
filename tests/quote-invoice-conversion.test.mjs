import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260917090000_quote_direct_invoice_conversion.sql";

// Quote -> Invoice direct conversion — the second Phase 1 path (product
// requirement change: support Quote -> Order -> Invoice AND
// Quote -> Invoice -> Order independently). Mirrors the static-SQL-source
// test convention of quote-order-conversion.test.mjs. Live/behavioral
// proof lives in supabase/tests/quote_direct_invoice_conversion_run.sh.

function extractFunction(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  const end = sql.indexOf("\n$$;", start);
  return sql.slice(start, end);
}

test("1 · migration is additive — no new invoice-numbering system, no PayFast/payment touch, does not redefine save_opps_invoice_with_items", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /create or replace function public\.convert_quote_to_invoice\(/);
  assert.doesNotMatch(sql, /create (table|sequence).*invoice.*number/i, "no competing invoice-numbering mechanism");
  assert.match(sql, /:= public\.next_opps_invoice_number\(v_quote\.tenant_id\)/, "uses the EXISTING canonical numbering allocator");
  assert.doesNotMatch(sql, /(create or replace|drop)\s+function\s+public\.(save_opps_invoice_with_items|next_opps_invoice_number|begin_invoice_payment|apply_invoice_payfast_payment|record_manual_invoice_payment)\b/,
    "does not redefine any existing invoice/payment RPC");
  // "payfast" appears only in this migration's own header prose explaining
  // it does NOT touch it — check for actual executable calls, not the word.
  assert.doesNotMatch(sql, /select public\.(begin_invoice_payment|apply_invoice_payfast_payment)/i, "no executable PayFast call anywhere");
});

test("2 · opps_invoices.source_quote_id is nullable, ON DELETE SET NULL, plus a partial unique index for one direct invoice per quote", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /alter table public\.opps_invoices\s*\n\s*add column if not exists source_quote_id uuid references public\.opps_quotes\(id\) on delete set null/);
  assert.match(sql, /create unique index if not exists opps_invoices_source_quote_id_once\s*\n\s*on public\.opps_invoices \(source_quote_id\)\s*\n\s*where source_quote_id is not null/);
});

test("3 · orders.source_invoice_id is a new nullable reverse pointer, no separate unique index needed (orders_source_quote_id_once already covers it)", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /alter table public\.orders\s*\n\s*add column if not exists source_invoice_id uuid references public\.opps_invoices\(id\) on delete set null/);
  assert.doesNotMatch(sql, /create unique index.*source_invoice_id/, "no redundant index — orders_source_quote_id_once from 20260916090000 already enforces one order per quote regardless of path");
});

test("4 · convert_quote_to_invoice: FOR UPDATE lock, permission + tenant checks, idempotent replay before any write", async () => {
  const sql = await src(MIGRATION);
  const fn = extractFunction(sql, "convert_quote_to_invoice");
  assert.match(fn, /from public\.opps_quotes where id = p_quote_id for update/);
  assert.match(fn, /is_app_admin\(\) or public\.user_finance_level\(\) in \(1, 2\)/);
  assert.match(fn, /can_access_tenant\(v_quote\.tenant_id\)/);
  const replayIdx = fn.indexOf("if v_quote.converted_invoice_id is not null then");
  const insertIdx = fn.indexOf("insert into public.opps_invoices");
  assert.ok(replayIdx > -1 && insertIdx > replayIdx, "replay check runs before any invoice insert");
  assert.match(fn.slice(replayIdx, replayIdx + 400), /'replayed', true/);
});

test("5 · refuses to orphan-invoice a quote that already has an order (QUOTE_ORDER_ALREADY_EXISTS), checked before the accepted/snapshot checks", async () => {
  const sql = await src(MIGRATION);
  const fn = extractFunction(sql, "convert_quote_to_invoice");
  const guardIdx = fn.indexOf("if v_quote.converted_order_id is not null then");
  const acceptedIdx = fn.indexOf("if v_quote.status <> 'accepted' then");
  assert.ok(guardIdx > -1 && acceptedIdx > guardIdx, "order-already-exists guard runs before the accepted-status check");
  assert.match(fn, /QUOTE_ORDER_ALREADY_EXISTS/);
});

test("6 · only ACCEPTED quotes convert; missing accepted snapshot refuses rather than falling back to the live quote", async () => {
  const sql = await src(MIGRATION);
  const fn = extractFunction(sql, "convert_quote_to_invoice");
  assert.match(fn, /QUOTE_NOT_CONVERTIBLE/);
  assert.match(fn, /if v_quote\.accepted_revision_id is null then[\s\S]{0,200}QUOTE_NO_ACCEPTED_SNAPSHOT/);
  assert.match(fn, /QUOTE_ACCEPTED_SNAPSHOT_MISSING/);
  assert.match(fn, /QUOTE_SNAPSHOT_EMPTY_ITEMS/);
});

test("7 · financial fields come ONLY from the accepted snapshot's own top-level keys — never nested, never a default, never live opps_quotes", async () => {
  const sql = await src(MIGRATION);
  const fn = extractFunction(sql, "convert_quote_to_invoice");
  for (const key of ["subtotal", "discount_total", "shipping_charge", "tax_total", "total"]) {
    assert.match(fn, new RegExp(`v_snapshot->>'${key}'`), `reads ${key} from the snapshot's own top-level key, not a nested 'totals' object`);
  }
  assert.doesNotMatch(fn, /v_snapshot->'totals'/, "must not read a non-existent nested totals object (the snapshot shape has no such key)");
  assert.doesNotMatch(fn, /DEFAULT_INVOICE_DEFAULTS|defaults\.shippingCharge|shippingCharge/, "never consults the manual-invoice-creation shipping default");
});

test("8 · quote status STAYS accepted after a direct invoice — only converted_invoice_id is set — so Create Order remains available afterward", async () => {
  const sql = await src(MIGRATION);
  const fn = extractFunction(sql, "convert_quote_to_invoice");
  assert.match(fn, /update public\.opps_quotes\s*\n\s*set converted_invoice_id = v_invoice_id/);
  assert.doesNotMatch(fn, /update public\.opps_quotes\s*\n\s*set converted_invoice_id[\s\S]{0,60}status\s*=\s*'converted'/, "must not also flip status to converted");
  assert.doesNotMatch(fn, /status = 'converted'/, "convert_quote_to_invoice never writes status='converted' anywhere in its body");
});

test("9 · invoice starts draft/unpaid; exactly one invoice + its items + one quote-event per successful (non-replayed) call; no payment table touched", async () => {
  const sql = await src(MIGRATION);
  const fn = extractFunction(sql, "convert_quote_to_invoice");
  assert.match(fn, /'draft',/, "status literal 'draft'");
  assert.equal((fn.match(/insert into public\.opps_invoices/g) || []).length, 1);
  assert.equal((fn.match(/insert into public\.opps_quote_events/g) || []).length, 1);
  assert.match(fn, /'converted', 'staff', auth\.uid\(\)/, "logged as a staff action");
  assert.match(fn, /'conversion_type', 'direct_invoice'/, "event metadata disambiguates from the order path");
  assert.doesNotMatch(fn, /invoice_payments|record_manual_invoice_payment/i, "creates no payment rows");
  // amount_paid is written as the literal 0, never derived from anything else
  assert.match(fn, /0,\s*\n\s*coalesce\(nullif\(v_snapshot->>'total'/, "amount_paid is the literal 0 immediately before balance_due");
});

test("10 · convert_quote_to_order propagates source_invoice_id from converted_invoice_id when present, and is otherwise unchanged from 20260916090000", async () => {
  const sql = await src(MIGRATION);
  const fn = extractFunction(sql, "convert_quote_to_order");
  assert.match(fn, /source_quote_id, source_invoice_id, source_metadata/, "orders insert column list gains source_invoice_id");
  assert.match(fn, /v_quote\.id, v_quote\.converted_invoice_id,/, "value is the quote's own converted_invoice_id — null when no direct invoice exists, so ordinary Quote -> Order orders are unaffected");
  // the totals-path fix: reads the snapshot's real top-level 'total' key,
  // not the non-existent nested 'totals' object the original had.
  assert.match(fn, /coalesce\(nullif\(v_snapshot->>'total', ''\)::numeric, v_quote\.total\)/);
  assert.doesNotMatch(fn, /v_snapshot->'totals'/);
  // everything else that made the original function safe is still present
  assert.match(fn, /from public\.opps_quotes where id = p_quote_id for update/);
  assert.match(fn, /QUOTE_NOT_CONVERTIBLE/);
  assert.match(fn, /orders_source_quote_id_once|source_quote_id/);
});

test("11 · both RPCs are authenticated-only, never anon", async () => {
  const sql = await src(MIGRATION);
  for (const fn of ["convert_quote_to_invoice", "convert_quote_to_order"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\(uuid\\) from public, anon;`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\(uuid\\) to authenticated;`));
  }
  assert.doesNotMatch(sql, /grant execute on function public\.convert_quote_to_(invoice|order).*to anon/);
});

test("12 · does not touch the quote lifecycle RPCs, PayFast, or the order/invoice item-sync helpers", async () => {
  const sql = await src(MIGRATION);
  assert.doesNotMatch(sql, /(create or replace|drop)\s+function\s+public\.(save_opps_quote_with_items|accept_public_quote|decline_public_quote|request_quote_changes|mark_quote_sent|get_public_quote|link_invoice_to_order_relational|apply_invoice_order_sync|begin_invoice_payment|apply_invoice_payfast_payment)\b/);
});

// ── architecture-gate fix: canonical invoice<->order cross-link ────────
// opps_invoices.source_order_id is the PROVEN canonical field (see the
// migration's own header audit note, citing src/api/invoices.js:1070's
// listInvoices({sourceOrderId}) filter and OrderLinkPanel.jsx). Without
// wiring this, a direct quote invoice would be invisible to the order's
// own Invoices tab and to sibling-invoice detection after Quote -> Invoice
// -> Order. convert_quote_to_order() must call the EXISTING canonical
// link_invoice_to_order_relational() RPC — never a parallel UPDATE.

test("13 · convert_quote_to_order calls the EXISTING canonical link_invoice_to_order_relational() — no parallel UPDATE of opps_invoices.source_order_id", async () => {
  const sql = await src(MIGRATION);
  const fn = extractFunction(sql, "convert_quote_to_order");
  assert.match(fn, /perform public\.link_invoice_to_order_relational\(v_quote\.converted_invoice_id, v_order_id\)/,
    "reuses the canonical RPC verbatim, passing the direct invoice's own id and the new order's id");
  assert.doesNotMatch(fn, /update public\.opps_invoices\s*\n?\s*set\s+source_order_id/,
    "must never write opps_invoices.source_order_id directly — only through the canonical linking RPC, which owns its own tenant/client/void/already-linked guards");
});

test("14 · the linking call only runs when a direct invoice exists, is wrapped so a conflict never aborts order creation, and never silently reassigns an invoice linked elsewhere", async () => {
  const sql = await src(MIGRATION);
  const fn = extractFunction(sql, "convert_quote_to_order");
  const gateIdx = fn.indexOf("if v_quote.converted_invoice_id is not null then");
  const performIdx = fn.indexOf("perform public.link_invoice_to_order_relational");
  const insertOrderIdx = fn.indexOf("returning id into v_order_id");
  assert.ok(gateIdx > -1 && performIdx > gateIdx, "linking is gated on converted_invoice_id being present");
  assert.ok(performIdx > insertOrderIdx, "the order is created BEFORE the linking attempt — a linking conflict can never prevent order creation");
  const block = fn.slice(gateIdx, performIdx + 800);
  assert.match(block, /exception\s*\n\s*when others then/, "exceptions from the linking call are caught, not left to abort the whole transaction");
  assert.match(block, /INVOICE_ALREADY_LINKED/, "an invoice already linked to a different order is recognized and skipped, never reassigned");
  assert.match(block, /INVOICE_VOID/, "a voided invoice is recognized and skipped");
  assert.match(block, /else\s*\n\s*raise;/, "any OTHER, unexpected error is re-raised, never silently swallowed");
});

test("15 · convert_quote_to_invoice logs an invoice_created activity row for parity with save_opps_invoice_with_items", async () => {
  const sql = await src(MIGRATION);
  const fn = extractFunction(sql, "convert_quote_to_invoice");
  assert.match(fn, /insert into public\.opps_invoice_activity \(\s*\n\s*invoice_id, activity_type, activity_label, to_status, metadata, tenant_id, created_by/);
  assert.match(fn, /'invoice_created', 'Invoice created', 'draft'/);
  assert.equal((fn.match(/insert into public\.opps_invoice_activity/g) || []).length, 1, "exactly one activity row per creation, never on replay (the replay branch returns before reaching this insert)");
});

test("16 · preflight confirms opps_invoice_activity and link_invoice_to_order_relational both exist before applying", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /if to_regclass\('public\.opps_invoice_activity'\) is null then/);
  assert.match(sql, /p\.proname = 'link_invoice_to_order_relational'/);
});
