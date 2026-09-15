import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260916090000_quote_order_invoice_conversion.sql";

// Quote -> Order Phase 1 conversion. Mirrors the static-SQL-source test
// convention already used for quotes (quotes-q1-canonical-schema.test.mjs)
// and invoices (invoice-payfast-payment.test.mjs). Live/behavioral proof
// lives in supabase/tests/quote_order_conversion_run.sh (a disposable
// local Postgres — never staging/production).

test("1 · migration is additive only — no edits to the quote lifecycle, order creation, or invoice/payment RPCs", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /alter table public\.orders\s*\n\s*add column if not exists source_quote_id/);
  assert.match(sql, /create or replace function public\.convert_quote_to_order\(/);
  assert.doesNotMatch(sql, /(create or replace|drop)\s+function\s+public\.(save_opps_quote_with_items|save_opps_invoice_with_items|accept_public_quote|decline_public_quote|request_quote_changes|mark_quote_sent|get_public_quote|apply_invoice_payfast_payment|begin_invoice_payment|record_manual_invoice_payment|link_invoice_to_order_relational|apply_invoice_order_sync)\b/,
    "does not redefine any existing quote/order/invoice RPC — Phase 1 adds exactly one new function");
  assert.doesNotMatch(sql, /drop table|drop column|alter column.*type/i, "no destructive schema change");
});

test("2 · orders.source_quote_id is nullable, ON DELETE SET NULL, and does not touch existing order columns", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /source_quote_id uuid references public\.opps_quotes\(id\) on delete set null/,
    "deleting a quote must never cascade-delete a real operational order");
  assert.doesNotMatch(sql, /source_quote_id uuid not null/i);
});

test("3 · one source quote -> at most one converted order, enforced at the DB level (partial unique index)", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /create unique index if not exists orders_source_quote_id_once\s*\n\s*on public\.orders \(source_quote_id\)\s*\n\s*where source_quote_id is not null/,
    "DB-level idempotency, not only a disabled UI button — quote splitting is explicitly out of scope for Phase 1");
});

test("4 · opps_quotes.converted_order_id gets the FK the Q1 migration deliberately deferred to \"Q5\"", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /opps_quotes_converted_order_id_fkey/);
  assert.match(sql, /foreign key \(converted_order_id\) references public\.orders\(id\) on delete set null/);
});

test("5 · convert_quote_to_order locks the quote row FOR UPDATE before writing (atomicity)", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.convert_quote_to_order");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  assert.match(body, /from public\.opps_quotes where id = p_quote_id for update/);
});

test("6 · convert_quote_to_order is idempotent — an already-converted quote returns the SAME order, never a second one", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.convert_quote_to_order");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  const replayIdx = body.indexOf("if v_quote.converted_order_id is not null then");
  assert.ok(replayIdx > -1, "the idempotent-replay branch exists");
  const insertIdx = body.indexOf("insert into public.orders");
  assert.ok(insertIdx > replayIdx, "the replay check runs BEFORE the order insert — an already-converted quote never reaches it");
  assert.match(body.slice(replayIdx, replayIdx + 400), /'replayed', true/);
});

test("7 · only ACCEPTED quotes convert — draft/declined/expired/etc are rejected before any write", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.convert_quote_to_order");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  const statusCheckIdx = body.indexOf("if v_quote.status <> 'accepted' then");
  const insertIdx = body.indexOf("insert into public.orders");
  assert.ok(statusCheckIdx > -1 && insertIdx > statusCheckIdx, "the eligibility check runs before the order is created");
  assert.match(body, /QUOTE_NOT_CONVERTIBLE/);
});

test("8 · financial integrity: commercial line values come ONLY from the frozen snapshot, never from live/editable opps_quote_items", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.convert_quote_to_order");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  assert.match(body, /select snapshot into v_snapshot\s*\n\s*from public\.opps_quote_revisions\s*\n\s*where id = v_quote\.accepted_revision_id/,
    "reads the immutable, append-only revision snapshot");
  assert.match(body, /v_items := coalesce\(v_snapshot->'items', '\[\]'::jsonb\)/,
    "line items are taken from the snapshot's own items array");
  // the only read of the LIVE opps_quote_items table must be for a
  // non-financial field (source_client_product_id), never rate/quantity/
  // discount/item_total — capture the whole select ... from ... limit
  // block, not just what follows "from", since the selected column list
  // precedes the from clause.
  const liveReads = [...body.matchAll(/select [^;]*?from public\.opps_quote_items\b[\s\S]{0,200}?limit 1;/g)];
  assert.ok(liveReads.length >= 1, "does read the live table at least once (for catalogue enrichment)");
  for (const [snippet] of liveReads) {
    assert.match(snippet, /source_client_product_id/, "the only field read from the live table is the non-financial catalogue id");
    assert.doesNotMatch(snippet, /\brate\b|\bdiscount\b|\bitem_total\b|\bquantity\b/, "never reads financial fields from the live, editable quote_items table");
  }
});

test("9 · a quote with no accepted_revision_id refuses to convert rather than falling back to live quote content", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.convert_quote_to_order");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  assert.match(body, /if v_quote\.accepted_revision_id is null then[\s\S]{0,600}QUOTE_NO_ACCEPTED_SNAPSHOT/);
});

test("10 · no new order_number sequence is introduced — mirrors the existing client-side unformatted-unique-label convention, not a server sequence", async () => {
  const sql = await src(MIGRATION);
  assert.doesNotMatch(sql, /create (table|sequence).*order_number/i, "no new orders numbering table/sequence");
  assert.match(sql, /v_order_number := 'ORD-Q-' \|\|/);
});

test("11 · the conversion writes exactly one order row and one quote-event row per successful (non-replayed) call", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.convert_quote_to_order");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  assert.equal((body.match(/insert into public\.orders/g) || []).length, 1);
  assert.equal((body.match(/insert into public\.opps_quote_events/g) || []).length, 1);
  assert.match(body, /'converted', 'staff', auth\.uid\(\)/, "logged as a staff action, not a customer/public-link one");
});

test("12 · tenant/client are copied from the quote onto the new order — never left to default to null by omission", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.convert_quote_to_order");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  const insertStart = body.indexOf("insert into public.orders (");
  const valuesMarker = body.indexOf(") values (", insertStart);
  const columns = body.slice(insertStart, valuesMarker);
  assert.match(columns, /\bclient_id\b/);
  assert.match(columns, /\btenant_id\b/);
  assert.match(columns, /\bsource_quote_id\b/);
  const valuesEnd = body.indexOf("returning id into v_order_id", valuesMarker);
  const values = body.slice(valuesMarker, valuesEnd);
  assert.match(values, /v_quote\.customer_id, v_quote\.tenant_id/, "client_id and tenant_id both come from the quote, not left implicit");
});

test("13 · does not create a second invoice-number sequence or an alternate invoice-creation pathway", async () => {
  const sql = await src(MIGRATION);
  // The migration's own header comment explains, in prose, that it does
  // NOT touch invoices — that mention of the word is expected. What must
  // never appear is actual invoice-affecting CODE: a write to
  // opps_invoices/opps_invoice_items, a call to save_opps_invoice_with_items
  // or next_opps_invoice_number, or a second numbering table/sequence.
  assert.doesNotMatch(sql, /insert into public\.opps_invoices|update public\.opps_invoices|from public\.opps_invoices/i,
    "no executable statement anywhere in this migration reads or writes the invoice tables");
  assert.doesNotMatch(sql, /select public\.save_opps_invoice_with_items|select public\.next_opps_invoice_number/i,
    "no executable call to the invoice-creation or invoice-numbering RPCs — only mentioned in prose explaining that order -> invoice reuses them unchanged");
  assert.doesNotMatch(sql, /create (table|sequence).*invoice.*number/i, "no competing invoice-numbering mechanism");
});

test("14 · service-role/authenticated only — never anon", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /revoke all on function public\.convert_quote_to_order\(uuid\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.convert_quote_to_order\(uuid\) to authenticated;/);
  assert.doesNotMatch(sql, /grant execute on function public\.convert_quote_to_order.*to anon/);
});
