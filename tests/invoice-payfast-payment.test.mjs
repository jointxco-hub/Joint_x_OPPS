import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260913110000_invoice_payfast_payment.sql";
// Forward-only follow-up: 20260913110000 has already been applied/
// reconciled on staging, so its historical contents are never edited in
// place — the successful-payment metadata sanitization instead lives in
// its own later CREATE OR REPLACE migration.
const METADATA_MIGRATION = "supabase/migrations/20260915120000_invoice_payfast_metadata_sanitization.sql";

// begin_invoice_payment / apply_invoice_payfast_payment — the two RPCs
// behind the public invoice Pay CTA. Mirrors the static-SQL-source test
// convention of record-manual-invoice-payment.test.mjs.

test("0 · 20260913110000 is unmodified from its previously-applied contents — the metadata fix lives only in the forward migration", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  assert.match(body, /'raw_itn', p_raw_itn/, "20260913110000 still stores the raw ITN exactly as previously applied/reconciled to staging — this file is not where the fix lives");
  assert.doesNotMatch(body, /payfast_amount_fee|payfast_amount_net/, "the sanitized allowlist does not exist in this migration");
});

test("0b · the metadata-sanitization migration is dated strictly after every other migration in the repo, and after 20260913110000 in particular", async () => {
  const fs = await import("node:fs/promises");
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files[files.length - 1], "20260915120000_invoice_payfast_metadata_sanitization.sql", "it is the newest migration by filename/timestamp ordering — no collision, no out-of-order insertion");
  assert.ok("20260915120000_invoice_payfast_metadata_sanitization.sql" > "20260913110000_invoice_payfast_payment.sql");
});

test("0c · the forward migration is additive/narrow — CREATE OR REPLACE only, no new table/index/grant, and preflights that the base function already exists", async () => {
  const sql = await src(METADATA_MIGRATION);
  assert.match(sql, /create or replace function public\.apply_invoice_payfast_payment\(/);
  assert.doesNotMatch(sql, /create table|create unique index|grant execute|revoke all/i, "no schema object beyond the function redefinition — the existing index/grants from 20260913110000 are untouched and still apply");
  assert.match(sql, /to_regprocedure\('public\.apply_invoice_payfast_payment\(uuid, numeric, text, jsonb\)'\) is null/, "fails loudly if applied before the base migration, rather than silently creating a fresh function with no prior history");
});

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
  // the branch now nests an `if not exists (...) then ... end if;` dedupe
  // guard around the insert (see test 9d) — skip past ITS "end if;" to find
  // the outer branch's own closing "end if;".
  const innerEndIf = body.indexOf("end if;", overpayBranchStart);
  const overpayBranchEnd = body.indexOf("end if;", innerEndIf + 1);
  const overpayBranch = body.slice(overpayBranchStart, overpayBranchEnd);
  assert.doesNotMatch(overpayBranch, /insert into public\.invoice_payments/, "the overpayment branch must never insert a ledger row");
  assert.match(overpayBranch, /insert into public\.opps_invoice_activity/, "the rejection must still be durably logged for reconciliation");
  assert.match(overpayBranch, /'INVOICE_PAYMENT_OVERPAYMENT_REJECTED'/);
  assert.match(overpayBranch, /'ok', false/, "the RPC returns ok:false — the edge function's existing `!(data as any)?.ok` check already treats this as a clean rejection, no X LAB change needed");
  // never silently clamp: the rejection response echoes what PayFast
  // actually reports, not a reduced/rounded-down number
  assert.match(body, /'received', v_amount/);
});

test("9d · a repeat rejection of the same (invoice, pf_payment_id) reuses the existing activity row instead of piling up duplicates", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  const overpayBranchStart = body.indexOf("if v_amount > v_balance + 0.02 then");
  const innerEndIf = body.indexOf("end if;", overpayBranchStart);
  const dedupeGuard = body.slice(overpayBranchStart, innerEndIf);
  assert.match(dedupeGuard, /if not exists \(/, "the insert is guarded by an existence check");
  assert.match(dedupeGuard, /activity_type = 'invoice_payment_rejected'/);
  assert.match(dedupeGuard, /metadata->>'reference' = v_ref/, "keyed on the same PayFast reference that identifies the ITN");
  assert.match(dedupeGuard, /metadata->>'reason' = 'INVOICE_PAYMENT_OVERPAYMENT_REJECTED'/, "scoped to this specific rejection reason, not just any activity on the invoice");
  // concurrency safety: no new unique index was added for this — it relies
  // on the invoice FOR UPDATE lock the function already takes, so two
  // concurrent identical retries still serialize through one connection at
  // a time rather than both passing the existence check.
  assert.doesNotMatch(sql, /create unique index[\s\S]{0,80}opps_invoice_activity/i, "no second ledger/unique-index model was introduced for this");
});

test("9e · the rejection activity never stores the raw ITN / signature — only what reconciliation needs", async () => {
  const sql = await src(MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  const overpayBranchStart = body.indexOf("if v_amount > v_balance + 0.02 then");
  const innerEndIf = body.indexOf("end if;", overpayBranchStart);
  const rejectionInsert = body.slice(overpayBranchStart, innerEndIf);
  assert.doesNotMatch(rejectionInsert, /'raw_itn'/, "no raw ITN payload (which carries PayFast's signature) is stored as a jsonb key on rejection");
  assert.match(rejectionInsert, /'amount_received', v_amount/);
  assert.match(rejectionInsert, /'balance_due',\s*v_balance/);
  assert.match(rejectionInsert, /'reference',\s*v_ref/);
});

test("9f · a successful payment's own metadata never stores the raw ITN / signature — same guarantee as the rejection path, extended to acceptance", async () => {
  const sql = await src(METADATA_MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  const insertStart = body.indexOf("-- ── valid amount");
  const insertEnd = body.indexOf("on conflict (invoice_id, reference)", insertStart);
  const successInsert = body.slice(insertStart, insertEnd);
  assert.doesNotMatch(successInsert, /'raw_itn'/, "the full ITN body (which carries PayFast's signature) is never stored as a jsonb key on a successful payment either");
  assert.doesNotMatch(successInsert, /p_raw_itn(?!->)/, "p_raw_itn is only ever read field-by-field (p_raw_itn->>'x'), never assigned wholesale into metadata");
});

test("9g · the retained success metadata is a small explicit allowlist — only fields with no existing canonical column", async () => {
  const sql = await src(METADATA_MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  const insertStart = body.indexOf("-- ── valid amount");
  const insertEnd = body.indexOf("on conflict (invoice_id, reference)", insertStart);
  const successInsert = body.slice(insertStart, insertEnd);
  assert.match(successInsert, /'payfast_amount_fee',\s*nullif\(p_raw_itn->>'amount_fee', ''\)::numeric/, "PayFast's fee breakdown has no canonical column elsewhere and is the kind of field worth keeping");
  assert.match(successInsert, /'payfast_amount_net',\s*nullif\(p_raw_itn->>'amount_net', ''\)::numeric/);
  // fields that duplicate an already-canonical column (amount/pf_payment_id/
  // invoice_id/invoice_number) are deliberately NOT retained a second time
  assert.doesNotMatch(successInsert, /'payment_status'|'item_name'|'m_payment_id'|'merchant_id'|'email_address'|'custom_str/, "no field is retained merely because PayFast sent it — only genuinely non-redundant ones");
});

test("9h · a replayed successful payment is unaffected by the metadata allowlist change — idempotency stays on (invoice_id, reference), not on metadata shape", async () => {
  const sql = await src(METADATA_MIGRATION);
  const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
  const end = sql.indexOf("\n$$;", start);
  const body = sql.slice(start, end);
  const conflictIdx = body.indexOf("on conflict (invoice_id, reference)");
  const replayBranchEnd = body.indexOf("end if;", conflictIdx);
  const replayBranch = body.slice(conflictIdx, replayBranchEnd);
  assert.match(replayBranch, /'replayed', true, 'payment_id', v_row_id/, "the on-conflict-do-nothing + re-select replay path (test 8) is untouched by the metadata column change above it");
  assert.doesNotMatch(replayBranch, /raw_itn|p_raw_itn/, "the replay branch never references the raw ITN either");
});

test("9i · the forward-migration function differs from the previously-applied one ONLY around the successful-payment metadata construction — every other block is byte-identical, in the same order", async () => {
  const oldSql = await src(MIGRATION);
  const newSql = await src(METADATA_MIGRATION);
  function fnBody(sql) {
    const start = sql.indexOf("create or replace function public.apply_invoice_payfast_payment");
    const end = sql.indexOf("\n$$;", start) + 4;
    return sql.slice(start, end);
  }
  const oldBody = fnBody(oldSql);
  const newBody = fnBody(newSql);
  // Large literal chunks, copied verbatim from the function, covering
  // every block EXCEPT the successful-payment metadata object itself:
  // signature/declare, guards, the FOR UPDATE lock, the replay branch,
  // the already-paid branch, the ENTIRE overpayment-rejection block
  // (dedup guard + activity insert + rejection return, ±0.02 tolerance),
  // the insert's own column list and VALUES up to the metadata object,
  // the on-conflict/replay-after-race branch, the status-mirror block,
  // the final activity insert, and the success return. Each must appear
  // verbatim, in this order, in BOTH the previously-applied function and
  // the forward-migration one.
  const invariantChunksInOrder = [
    `p_invoice_id     uuid,\n  p_amount         numeric,\n  p_pf_payment_id  text,\n  p_raw_itn        jsonb default '{}'::jsonb\n)`,
    `if v_ref is null then`,
    `return jsonb_build_object('ok', false, 'reason', 'PF_PAYMENT_ID_REQUIRED');`,
    `select * into v_invoice from public.opps_invoices where id = p_invoice_id for update;`,
    `where invoice_id = p_invoice_id and source = 'payfast' and reference = v_ref\n  limit 1;\n  if v_existing_id is not null then\n    return jsonb_build_object(\n      'ok', true, 'replayed', true, 'payment_id', v_existing_id,`,
    `if v_status_before = 'paid' or v_balance <= 0 then\n    return jsonb_build_object(\n      'ok', true, 'ignored', true, 'reason', 'INVOICE_ALREADY_PAID',`,
    `if v_amount > v_balance + 0.02 then`,
    `if not exists (\n      select 1 from public.opps_invoice_activity\n      where invoice_id = p_invoice_id\n        and activity_type = 'invoice_payment_rejected'\n        and metadata->>'reference' = v_ref\n        and metadata->>'reason' = 'INVOICE_PAYMENT_OVERPAYMENT_REJECTED'\n    ) then`,
    `'invoice_payment_rejected', 'PayFast payment rejected — exceeds balance',`,
    `'reason',          'INVOICE_PAYMENT_OVERPAYMENT_REJECTED',\n          'amount_received', v_amount,\n          'balance_due',     v_balance,\n          'reference',       v_ref`,
    `return jsonb_build_object(\n      'ok', false, 'reason', 'INVOICE_PAYMENT_OVERPAYMENT_REJECTED',\n      'expected_max', v_balance, 'received', v_amount\n    );\n  end if;`,
    `insert into public.invoice_payments (\n    tenant_id, invoice_id, amount, paid_at, method, reference, source, order_id, created_by, metadata\n  ) values (\n    v_invoice.tenant_id, p_invoice_id, v_amount, now(), 'payfast', v_ref, 'payfast',\n    v_invoice.source_order_id, null,\n    jsonb_strip_nulls(jsonb_build_object(\n      'recorded_via', 'apply_invoice_payfast_payment',`,
    `on conflict (invoice_id, reference) where source = 'payfast' and reference is not null\n    do nothing\n  returning id into v_row_id;`,
    `if v_row_id is null then\n    select id into v_row_id\n    from public.invoice_payments\n    where invoice_id = p_invoice_id and source = 'payfast' and reference = v_ref\n    limit 1;\n    return jsonb_build_object(\n      'ok', true, 'replayed', true, 'payment_id', v_row_id,`,
    `if v_invoice.status in ('approved', 'partially_paid') then\n    v_new_status := case v_status_after\n                      when 'paid'    then 'paid'\n                      when 'partial' then 'partially_paid'\n                      else null\n                    end;\n  elsif v_invoice.status = 'overdue' and v_status_after = 'paid' then\n    v_new_status := 'paid';`,
    `insert into public.opps_invoice_activity (\n    invoice_id, tenant_id, activity_type, activity_label, activity_note,\n    from_status, to_status, metadata, created_by\n  ) values (\n    p_invoice_id, v_invoice.tenant_id,\n    'invoice_payment_recorded', 'Payment recorded',`,
    `return jsonb_build_object(\n    'ok', true, 'replayed', false, 'payment_id', v_row_id,\n    'amount_paid', public.invoice_amount_paid(p_invoice_id),\n    'balance_due', public.invoice_balance_due(p_invoice_id),\n    'payment_status', v_status_after\n  );\nend;`,
  ];
  let cursorOld = 0;
  let cursorNew = 0;
  for (const chunk of invariantChunksInOrder) {
    const idxOld = oldBody.indexOf(chunk, cursorOld);
    const idxNew = newBody.indexOf(chunk, cursorNew);
    assert.ok(idxOld >= cursorOld, `chunk missing (or out of order) in the previously-applied function: ${chunk.slice(0, 60)}...`);
    assert.ok(idxNew >= cursorNew, `chunk missing (or out of order) in the forward-migration function: ${chunk.slice(0, 60)}...`);
    cursorOld = idxOld + chunk.length;
    cursorNew = idxNew + chunk.length;
  }
  // the only thing between the shared prefix ending "'apply_invoice_payfast_payment'," and
  // the shared suffix starting "on conflict (invoice_id, reference)" differs, and differs
  // EXACTLY as expected: raw_itn wholesale vs. the two-field allowlist.
  const oldGap = oldBody.slice(oldBody.indexOf("'recorded_via', 'apply_invoice_payfast_payment',") + 49, oldBody.indexOf("on conflict (invoice_id, reference)"));
  const newGap = newBody.slice(newBody.indexOf("'recorded_via', 'apply_invoice_payfast_payment',") + 49, newBody.indexOf("on conflict (invoice_id, reference)"));
  assert.match(oldGap, /'raw_itn', p_raw_itn/);
  assert.doesNotMatch(newGap, /'raw_itn'/);
  assert.match(newGap, /'payfast_amount_fee'/);
  assert.match(newGap, /'payfast_amount_net'/);
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
