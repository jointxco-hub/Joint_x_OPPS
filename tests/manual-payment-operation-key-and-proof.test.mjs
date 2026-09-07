import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}
function fnBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const end = sql.indexOf(`revoke all on function public.${name}`, start);
  return start >= 0 && end > start ? sql.slice(start, end) : "";
}

const MIG = "supabase/migrations/20260907130000_manual_payment_operation_key_and_proof.sql";
const API = "src/api/invoices.js";

// ── operation key ────────────────────────────────────────────────────

test("1 · additive only; storage perimeter + PayFast untouched", async () => {
  const sql = await src(MIG);
  assert.match(sql, /alter table public\.invoice_payments\s*\n\s*add column if not exists client_operation_key text/);
  assert.doesNotMatch(sql, /delete from public\.invoice_payments\b/i);
  assert.doesNotMatch(sql, /truncate (table |only )?public\./i);
  assert.doesNotMatch(sql, /(create or replace|drop|alter)\s+function\s+\S*payfast/i);
  assert.doesNotMatch(sql, /insert into storage\.buckets|create policy .* on storage\.objects/i);
});

test("2 · operation key partial unique index; documented as NOT a bank reference; required for new payments", async () => {
  const sql = await src(MIG);
  assert.match(sql, /create unique index if not exists invoice_payments_manual_opkey_once\s*\n\s*on public\.invoice_payments \(invoice_id, client_operation_key\)\s*\n\s*where source = 'manual' and client_operation_key is not null/);
  assert.match(sql, /comment on column public\.invoice_payments\.client_operation_key is[\s\S]*NOT a bank\/receipt reference[\s\S]*REQUIRED for every new manual payment/i);
  assert.match(sql, /if v_opkey is null then\s*\n\s*raise exception using errcode = 'P0001',\s*\n\s*message = 'INVOICE_PAYMENT_OPERATION_KEY_REQUIRED/);
});

// ── RPC-only writes + immutability trigger ───────────────────────────

test("3 · payment_attachments takes NO direct writes from authenticated; SELECT only", async () => {
  const sql = await src(MIG);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.payment_attachments from authenticated, anon, public/);
  assert.match(sql, /grant select on public\.payment_attachments to authenticated/);
  assert.doesNotMatch(sql, /grant select, insert, update, delete on public\.payment_attachments/);
  // SELECT policies only (no for-all write policy)
  assert.match(sql, /create policy payment_attachments_finance_tenant_select\s*\n\s*on public\.payment_attachments for select to authenticated/);
  assert.match(sql, /create policy payment_attachments_staff_select\s*\n\s*on public\.payment_attachments as restrictive for select to authenticated/);
  assert.doesNotMatch(sql, /on public\.payment_attachments (as restrictive )?for all to authenticated/);
});

test("4 · immutability trigger fires on insert/update/delete and enforces the lifecycle", async () => {
  const sql = await src(MIG);
  assert.match(sql, /create trigger trg_payment_attachments_immutable\s*\n\s*before insert or update or delete on public\.payment_attachments/);
  const fn = sql.slice(
    sql.indexOf("create or replace function public._payment_attachments_immutable("),
    sql.indexOf("drop trigger if exists trg_payment_attachments_guard")
  );
  assert.ok(fn.length > 0);
  // DELETE: only staged + unlinked
  assert.match(fn, /if tg_op = 'DELETE' then[\s\S]*old\.status <> 'staged' or old\.payment_id is not null[\s\S]*PAYMENT_ATTACHMENT_LINKED_IMMUTABLE/);
  // identity immutable
  assert.match(fn, /new\.storage_path\s+is distinct from old\.storage_path[\s\S]*new\.operation_key\s+is distinct from old\.operation_key[\s\S]*PAYMENT_ATTACHMENT_IDENTITY_IMMUTABLE/);
  // payment_id set-once, never reassigned / cleared
  assert.match(fn, /old\.payment_id is not null and new\.payment_id is distinct from old\.payment_id[\s\S]*PAYMENT_ATTACHMENT_PAYMENT_IMMUTABLE/);
  // status transitions
  assert.match(fn, /old\.status = 'staged' and new\.status = 'linked'/);
  assert.match(fn, /old\.status = 'linked' and new\.status = 'superseded'/);
  assert.match(fn, /PAYMENT_ATTACHMENT_BAD_TRANSITION/);
  // supersede must carry the audit fields (a bare UPDATE cannot bypass)
  assert.match(fn, /new\.status = 'superseded' and old\.status = 'linked' then[\s\S]*new\.supersede_reason is null[\s\S]*new\.superseded_by is null[\s\S]*PAYMENT_ATTACHMENT_SUPERSEDE_NEEDS_AUDIT/);
});

test("5 · one storage object -> at most one attachment row", async () => {
  const sql = await src(MIG);
  assert.match(sql, /create unique index if not exists payment_attachments_path_once on public\.payment_attachments \(storage_path\)/);
});

// ── real storage ownership validation ────────────────────────────────

test("6 · stage_payment_proof verifies the object EXISTS, tenant + operation scoped, uploader", async () => {
  const sql = await src(MIG);
  const fn = fnBody(sql, "stage_payment_proof");
  assert.ok(fn.length > 0);
  assert.match(fn, /if v_opkey is null then[\s\S]*PAYMENT_ATTACHMENT_OPERATION_KEY_REQUIRED/);
  assert.match(fn, /v_seg := regexp_replace\(v_opkey, '\[\^a-zA-Z0-9\._-\]', '_', 'g'\)/);
  assert.match(fn, /position\(v_tenant::text \|\| '\/finance\/payment-proof\/' \|\| v_seg \|\| '\/' in v_path\) <> 1[\s\S]*PAYMENT_ATTACHMENT_PATH_NOT_OPERATION_SCOPED/);
  assert.match(fn, /from storage\.objects\s*\n\s*where bucket_id = 'uploads' and name = v_path/);
  assert.match(fn, /if not found then[\s\S]*PAYMENT_ATTACHMENT_OBJECT_NOT_FOUND/);
  assert.match(fn, /v_obj_owner is not null and v_obj_owner <> v_user_id::text[\s\S]*PAYMENT_ATTACHMENT_OBJECT_NOT_OWNED/);
  assert.match(fn, /v_mime not in \('image\/jpeg', 'image\/jpg', 'image\/png', 'application\/pdf'\)/);
  assert.match(fn, /p_byte_size > 15 \* 1024 \* 1024/);
});

test("6b · stage_payment_proof / attach_payment_proof run with the storage schema on the path", async () => {
  const sql = await src(MIG);
  assert.match(sql, /create or replace function public\.stage_payment_proof\([\s\S]{0,400}set search_path = pg_catalog, public, storage/);
  assert.match(sql, /create or replace function public\.attach_payment_proof\([\s\S]{0,400}set search_path = pg_catalog, public, storage/);
});

test("7 · attach_payment_proof: object must exist under this payment's late-<id> folder; no ledger write", async () => {
  const sql = await src(MIG);
  const fn = fnBody(sql, "attach_payment_proof");
  assert.ok(fn.length > 0);
  assert.match(fn, /'\/finance\/payment-proof\/late-' \|\| p_payment_id::text \|\| '\/' in v_path\) <> 1[\s\S]*PAYMENT_ATTACHMENT_PATH_NOT_OPERATION_SCOPED/);
  assert.match(fn, /from storage\.objects where bucket_id = 'uploads' and name = v_path[\s\S]*PAYMENT_ATTACHMENT_OBJECT_NOT_FOUND/);
  assert.match(fn, /'invoice_payment_proof_added'/);
  assert.doesNotMatch(fn, /insert into public\.invoice_payments|update public\.invoice_payments/);
});

// ── conflict / replay ───────────────────────────────────────────────

test("8 · a shared matcher validates amount/date/method/reference/operation key", async () => {
  const sql = await src(MIG);
  const fn = fnBody(sql, "_assert_manual_payment_matches");
  assert.ok(fn.length > 0);
  assert.match(fn, /round\(p_row\.amount, 2\) <> round\(p_amount, 2\)/);
  assert.match(fn, /p_row\.paid_at::date is distinct from p_paid_at::date/);
  assert.match(fn, /coalesce\(p_row\.method, ''\)\s+is distinct from coalesce\(p_method, 'eft'\)/);
  assert.match(fn, /coalesce\(p_row\.reference, ''\)\s+is distinct from coalesce\(p_ref, ''\)/);
  assert.match(fn, /coalesce\(p_row\.client_operation_key, ''\) is distinct from coalesce\(p_opkey, ''\)/);
  assert.match(fn, /INVOICE_PAYMENT_OPERATION_CONFLICT/);
});

test("9 · replay path uses the matcher; reference reused by a different operation is a hard conflict", async () => {
  const sql = await src(MIG);
  const fn = fnBody(sql, "record_manual_invoice_payment");
  assert.ok(fn.length > 0);
  // (1) opkey match -> assert then replay
  assert.match(fn, /where invoice_id = p_invoice_id and source = 'manual' and client_operation_key = v_opkey[\s\S]*perform public\._assert_manual_payment_matches\(v_existing[\s\S]*'replayed', true/);
  // (2) reference reuse (no opkey match) -> IDEMPOTENCY_CONFLICT, never a replay/link
  assert.match(fn, /if v_ref is not null and exists \(\s*\n\s*select 1 from public\.invoice_payments\s*\n\s*where invoice_id = p_invoice_id and source = 'manual' and reference = v_ref\s*\n\s*\) then\s*\n\s*raise exception[\s\S]*INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT/);
});

test("10 · unique_violation handler identifies the real row and validates before replaying", async () => {
  const sql = await src(MIG);
  const fn = fnBody(sql, "record_manual_invoice_payment");
  assert.match(fn, /exception when unique_violation then[\s\S]*where invoice_id = p_invoice_id and source = 'manual' and client_operation_key = v_opkey[\s\S]*perform public\._assert_manual_payment_matches\(v_existing/);
  assert.match(fn, /exception when unique_violation then[\s\S]*reference = v_ref\s*\n\s*\) then\s*\n\s*raise exception[\s\S]*INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT[\s\S]*\n\s*raise;/);
});

test("11 · lifecycle + fail-closed + overpayment guards carried forward", async () => {
  const sql = await src(MIG);
  const fn = fnBody(sql, "record_manual_invoice_payment");
  assert.match(fn, /v_invoice\.status in \('approved', 'partially_paid'\) then/);
  assert.match(fn, /elsif v_invoice\.status = 'overdue' and v_status_after = 'paid'/);
  assert.match(fn, /INVOICE_PAYMENT_BRIDGE_SCHEMA_MISSING/);
  assert.match(fn, /INVOICE_PAYMENT_OVERPAYMENT/);
  assert.match(fn, /INVOICE_PAYMENT_UNRECONCILED_ORDER_PAYMENT/);
  // proof link + audit still in the same txn
  assert.match(fn, /v_proof_count := public\._link_staged_payment_attachments\(p_invoice_id, v_opkey, v_row_id, v_invoice\.tenant_id\)/);
  assert.match(fn, /'proof_count',\s+v_proof_count/);
});

// ── orphan cleanup ──────────────────────────────────────────────────

test("12 · remove_staged_payment_proof: RPC-only, staged+unlinked, returns path", async () => {
  const sql = await src(MIG);
  const fn = fnBody(sql, "remove_staged_payment_proof");
  assert.ok(fn.length > 0);
  assert.match(fn, /v_att\.status <> 'staged' or v_att\.payment_id is not null[\s\S]*PAYMENT_ATTACHMENT_LINKED_IMMUTABLE/);
  assert.match(fn, /delete from public\.payment_attachments where id = p_attachment_id/);
  assert.match(fn, /'storage_path', v_att\.storage_path/);
});

test("13 · cleanup_abandoned_payment_proof: bounded, staged+unlinked only, 5-min floor", async () => {
  const sql = await src(MIG);
  const fn = fnBody(sql, "cleanup_abandoned_payment_proof");
  assert.ok(fn.length > 0);
  assert.match(fn, /greatest\(coalesce\(p_older_than_minutes, 30\), 5\)/);
  assert.match(fn, /delete from public\.payment_attachments\s*\n\s*where operation_key = v_opkey\s*\n\s*and payment_id is null\s*\n\s*and status = 'staged'\s*\n\s*and created_at < v_cutoff/);
  assert.match(fn, /can_access_tenant\(tenant_id\)/);
});

test("14 · supersede_payment_attachment: linked only, reason required, audited, no amount change", async () => {
  const sql = await src(MIG);
  const fn = fnBody(sql, "supersede_payment_attachment");
  assert.match(fn, /PAYMENT_ATTACHMENT_REASON_REQUIRED/);
  assert.match(fn, /v_att\.status <> 'linked'[\s\S]*PAYMENT_ATTACHMENT_NOT_LINKED/);
  assert.match(fn, /'invoice_payment_proof_superseded'/);
  assert.doesNotMatch(fn, /insert into public\.invoice_payments|update public\.invoice_payments/);
});

test("15 · every new function is revoked from public/anon and granted only to authenticated (internals not granted)", async () => {
  const sql = await src(MIG);
  for (const f of ["stage_payment_proof", "remove_staged_payment_proof", "cleanup_abandoned_payment_proof",
                   "attach_payment_proof", "supersede_payment_attachment"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\(`), `${f} not revoked`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to authenticated`), `${f} not granted`);
  }
  assert.match(sql, /revoke all on function public\._link_staged_payment_attachments\([^)]*\) from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\._assert_manual_payment_matches\([^)]*\) from public, anon, authenticated/);
});

// ── api/invoices.js ─────────────────────────────────────────────────

test("16 · recordManualInvoicePayment now REQUIRES an operation key (throws locally)", async () => {
  const js = await src(API);
  assert.match(js, /const opKey = operationKey && String\(operationKey\)\.trim\(\);\s*\n\s*if \(!opKey\) \{\s*\n\s*throw Object\.assign\([\s\S]*INVOICE_PAYMENT_OPERATION_KEY_REQUIRED/);
  assert.match(js, /p_operation_key: opKey,/);
});

test("17 · proof staging + removal + cleanup are RPC-only (no direct payment_attachments writes)", async () => {
  const js = await src(API);
  assert.match(js, /supabase\.rpc\("stage_payment_proof", \{/);
  assert.match(js, /supabase\.rpc\("remove_staged_payment_proof", \{/);
  assert.match(js, /export async function cleanupAbandonedPaymentProof\(/);
  assert.match(js, /supabase\.rpc\("cleanup_abandoned_payment_proof", \{/);
  assert.doesNotMatch(js, /\.from\("payment_attachments"\)\s*\n?\s*\.insert\(/);
  assert.doesNotMatch(js, /\.from\("payment_attachments"\)\s*\n?\s*\.delete\(/);
  // list + signed URL reads stay
  assert.match(js, /\.from\("payment_attachments"\)\s*\n\s*\.select\("\*"\)/);
  assert.match(js, /getSignedFileUrl\(toPrivateUploadRef\(/);
});

test("18 · new error codes surfaced with friendly copy", async () => {
  const js = await src(API);
  for (const code of [
    "INVOICE_PAYMENT_OPERATION_KEY_REQUIRED",
    "PAYMENT_ATTACHMENT_PATH_NOT_OPERATION_SCOPED",
    "PAYMENT_ATTACHMENT_OBJECT_NOT_FOUND",
    "PAYMENT_ATTACHMENT_OBJECT_NOT_OWNED",
    "PAYMENT_ATTACHMENT_LINKED_IMMUTABLE",
  ]) {
    assert.match(js, new RegExp(`${code}:\\s*"[^"]+"`), `error map missing ${code}`);
  }
});

test("19 · preflight requires storage.objects + the base RPC (any signature)", async () => {
  const sql = await src(MIG);
  assert.match(sql, /if to_regclass\('storage\.objects'\) is null then\s*\n\s*raise exception 'MANUAL_PAYMENT_PROOF: storage\.objects is missing/);
  assert.match(sql, /from pg_proc\s*\n\s*where proname = 'record_manual_invoice_payment'/);
});
