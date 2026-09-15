import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260918090000_quote_order_client_mismatch_fix.sql";
const PRIOR_MIGRATION = "supabase/migrations/20260917090000_quote_direct_invoice_conversion.sql";
const CANONICAL_LINKER_MIGRATION = "supabase/migrations/202608180003_invoice_relational_link_and_reopen.sql";

// Staging repro: an accepted quote with no linked client record
// (customer_id null — a normal, supported OPPS quoting state; the
// "Client" field in QuoteEditor.jsx is optional/clearable, separate from
// the required "Customer name" field) failed Create Order with
// CLIENT_MISMATCH after a direct quote invoice existed.
//
// A first draft of this fix (superseded, never applied) only made
// convert_quote_to_order() SKIP the failed link — the order got created,
// but opps_invoices.source_order_id stayed null forever, so the
// pre-existing invoice never became a normal linked invoice of the order
// (invisible to InvoicesTab/sibling-detection/OrderLinkPanel). That broke
// the actual product requirement.
//
// The real fix (this migration): link_invoice_to_order_relational() — the
// ONE canonical invoice<->order linker, reused everywhere (manual
// OrderLinkPanel linking AND quote conversion) — is extended to accept a
// second, narrowly-scoped form of client-identity proof: both sides have
// NO client link at all, but both trace back to the exact same non-null
// source_quote_id. Every other combination (different clients, one null
// one not, both null with different/no quote provenance) still rejects
// exactly as before. Live/behavioral proof lives in
// supabase/tests/quote_order_client_mismatch_fix_run.sh.

// Finds the CREATE OR REPLACE and cuts at whichever end-marker the
// function actually uses ("$$;" for plain plpgsql, "$function$;" for the
// dollar-quoted style 202608180003 originally used).
function extractFn(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  if (start === -1) return "";
  const ddollar = sql.indexOf("\n$$;", start);
  const dfunction = sql.indexOf("\n$function$;", start);
  const candidates = [ddollar, dfunction].filter((i) => i !== -1);
  const end = Math.min(...candidates);
  return sql.slice(start, end);
}

test("1 · forward-only follow-up to both prior migrations — neither is edited in place", async () => {
  const priorDirect = await src(PRIOR_MIGRATION);
  assert.doesNotMatch(priorDirect, /skipped_client_mismatch|clientless-same-quote/i, "20260917090000 is untouched — the fix lives only in the new forward file");
  const canonical = await src(CANONICAL_LINKER_MIGRATION);
  assert.doesNotMatch(canonical, /source_quote_id/, "202608180003 is untouched — it predates source_quote_id entirely and is never edited in place");
  const sql = await src(MIGRATION);
  assert.match(sql, /create or replace function public\.link_invoice_to_order_relational\(/);
  assert.match(sql, /create or replace function public\.convert_quote_to_order\(/);
  assert.doesNotMatch(sql, /create or replace function public\.convert_quote_to_invoice\(/, "convert_quote_to_invoice is untouched — nothing about invoice creation itself changed");
  assert.doesNotMatch(sql, /^\s*(create table|alter table|create( unique)? index)\b/im, "no schema change — every column this fix relies on (source_quote_id on both sides) already existed");
});

test("2 · link_invoice_to_order_relational: client-identity proof is EITHER matching non-null client_id OR both-null-with-the-same-non-null-source_quote_id — never a bare null-passes-null", async () => {
  const sql = await src(MIGRATION);
  const fn = extractFn(sql, "link_invoice_to_order_relational");
  assert.match(fn, /v_invoice\.customer_id is not null and v_invoice\.customer_id is not distinct from v_order\.client_id/, "branch (a): real, matching, non-null client ids");
  assert.match(fn, /v_invoice\.customer_id is null and v_order\.client_id is null\s*\n\s*and v_invoice\.source_quote_id is not null\s*\n\s*and v_order\.source_quote_id is not null\s*\n\s*and v_invoice\.source_quote_id = v_order\.source_quote_id/, "branch (b): both null AND both share the same non-null source_quote_id — every clause required, no shortcut");
  assert.match(fn, /raise exception using errcode = 'P0001', message = 'CLIENT_MISMATCH';/, "still the same error, still no override path outside these two branches");
});

test("3 · tenant/void/already-linked checks and activity logging are byte-identical to the original 202608180003 body — only the client-identity condition changed", async () => {
  const fn = extractFn(await src(MIGRATION), "link_invoice_to_order_relational");
  assert.match(fn, /if v_invoice\.tenant_id is distinct from v_order\.tenant_id then\s*\n\s*raise exception using errcode = 'P0001', message = 'TENANT_MISMATCH';/);
  assert.match(fn, /if v_invoice\.status = 'void' then\s*\n\s*raise exception using errcode = 'P0001', message = 'INVOICE_VOID';/);
  assert.match(fn, /if v_invoice\.source_order_id is not null and v_invoice\.source_order_id is distinct from p_order_id then\s*\n\s*raise exception using errcode = 'P0001', message = 'INVOICE_ALREADY_LINKED';/);
  assert.match(fn, /update public\.opps_invoices\s*\n\s*set source_order_id = p_order_id/, "still the one and only write — sets source_order_id, the proven canonical field");
  assert.equal((fn.match(/insert into public\.opps_invoice_activity/g) || []).length, 1, "still logs exactly one activity row per successful link, same as before");
});

test("4 · convert_quote_to_order still calls the canonical linker unmodified, plus CLIENT_MISMATCH as defense-in-depth (not the primary fix)", async () => {
  const sql = await src(MIGRATION);
  const fn = extractFn(sql, "convert_quote_to_order");
  assert.match(fn, /perform public\.link_invoice_to_order_relational\(v_quote\.converted_invoice_id, v_order_id\)/, "same call, same arguments");
  const anchor = fn.indexOf("exception\n      when others then");
  const block = fn.slice(anchor, anchor + 500);
  assert.match(block, /INVOICE_ALREADY_LINKED/);
  assert.match(block, /INVOICE_VOID/);
  assert.match(block, /CLIENT_MISMATCH/);
  assert.match(block, /'skipped_client_mismatch'/);
  assert.match(block, /else\s*\n\s*raise;/, "any other, unanticipated error is still re-raised, never silently swallowed");
});

test("5 · the linking attempt still runs AFTER the order is created, so any exception from it can never prevent the order insert from committing", async () => {
  const fn = extractFn(await src(MIGRATION), "convert_quote_to_order");
  const insertOrderIdx = fn.indexOf("returning id into v_order_id");
  const performIdx = fn.indexOf("perform public.link_invoice_to_order_relational");
  assert.ok(insertOrderIdx > -1 && performIdx > insertOrderIdx, "order creation precedes the linking attempt");
});

test("6 · convert_quote_to_order's executable statements are otherwise byte-identical to 20260917090000's version", async () => {
  const prior = extractFn(await src(PRIOR_MIGRATION), "convert_quote_to_order");
  const fixed = extractFn(await src(MIGRATION), "convert_quote_to_order");
  const stripComments = (body) => body.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  const anchor = "returning id into v_order_id;";
  assert.equal(
    stripComments(prior.slice(0, prior.indexOf(anchor) + anchor.length)),
    stripComments(fixed.slice(0, fixed.indexOf(anchor) + anchor.length)),
    "every executable statement up to and including the order INSERT is unchanged"
  );
  const tailAnchor = "update public.opps_quotes";
  assert.equal(
    stripComments(prior.slice(prior.indexOf(tailAnchor))),
    stripComments(fixed.slice(fixed.indexOf(tailAnchor))),
    "everything after the exception block (quote UPDATE, event INSERT, return) is unchanged"
  );
});

test("7 · both functions stay authenticated-only, never opened to anon", async () => {
  const sql = await src(MIGRATION);
  for (const fn of ["link_invoice_to_order_relational\\(uuid, uuid\\)", "convert_quote_to_order\\(uuid\\)"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn} from public, anon;`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn} to authenticated;`));
  }
  assert.doesNotMatch(sql, /grant execute on function public\.(link_invoice_to_order_relational|convert_quote_to_order).*to anon/);
});

test("8 · preflight confirms both prerequisite objects exist before applying", async () => {
  const sql = await src(MIGRATION);
  assert.match(sql, /p\.proname = 'link_invoice_to_order_relational'/);
  assert.match(sql, /table_name = 'opps_invoices' and column_name = 'source_quote_id'/);
});
