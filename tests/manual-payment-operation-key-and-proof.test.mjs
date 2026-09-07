import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const MIG = "supabase/migrations/20260907130000_manual_payment_operation_key_and_proof.sql";
const API = "src/api/invoices.js";

// ── migration: operation key ─────────────────────────────────────────

test("1 · additive only - no drop/rewrite of invoice_payments rows, no PayFast", async () => {
  const sql = await src(MIG);
  assert.match(sql, /alter table public\.invoice_payments\s*\n\s*add column if not exists client_operation_key text/);
  assert.doesNotMatch(sql, /delete from public\.invoice_payments/i);
  assert.doesNotMatch(sql, /truncate/i);
  assert.doesNotMatch(sql, /(create or replace|drop|alter)\s+function\s+\S*payfast/i);
  // no calls into PayFast / order-reconciliation functions (mentions in the header comment are fine)
  assert.doesNotMatch(sql, /(perform|select)\s+public\.(apply_invoice_payfast_payment|reconcile_invoice_with_order)\(/);
});

test("2 · operation key has a partial unique index scoped to manual payments", async () => {
  const sql = await src(MIG);
  assert.match(sql, /create unique index if not exists invoice_payments_manual_opkey_once\s*\n\s*on public\.invoice_payments \(invoice_id, client_operation_key\)\s*\n\s*where source = 'manual' and client_operation_key is not null/);
});

test("3 · client_operation_key is documented as NOT a bank reference", async () => {
  const sql = await src(MIG);
  assert.match(sql, /comment on column public\.invoice_payments\.client_operation_key is[\s\S]*NOT a bank\/receipt reference/i);
});

// ── migration: payment_attachments ───────────────────────────────────

test("4 · payment_attachments: private-bucket, tenant FK, payment FK cascade, staged/linked/superseded", async () => {
  const sql = await src(MIG);
  assert.match(sql, /create table if not exists public\.payment_attachments \(/);
  assert.match(sql, /tenant_id\s+uuid not null references public\.tenants\(id\) on delete restrict/);
  assert.match(sql, /payment_id\s+uuid references public\.invoice_payments\(id\) on delete cascade/);
  assert.match(sql, /invoice_id\s+uuid not null references public\.opps_invoices\(id\) on delete cascade/);
  assert.match(sql, /status\s+text not null default 'staged'\s*\n\s*check \(status in \('staged', 'linked', 'superseded'\)\)/);
  assert.match(sql, /check \(storage_bucket = 'uploads'\)/);
  assert.match(sql, /check \(payment_id is not null or operation_key is not null\)/);
});

test("5 · safe file types + size cap enforced by CHECK", async () => {
  const sql = await src(MIG);
  assert.match(sql, /mime_type is null or lower\(mime_type\) in\s*\n\s*\('image\/jpeg', 'image\/jpg', 'image\/png', 'application\/pdf'\)/);
  assert.match(sql, /byte_size is null or \(byte_size > 0 and byte_size <= 15 \* 1024 \* 1024\)/);
});

test("6 · guard trigger: server-side tenant + path-ownership validation", async () => {
  const sql = await src(MIG);
  assert.match(sql, /create trigger trg_payment_attachments_guard\s*\n\s*before insert or update on public\.payment_attachments/);
  assert.match(sql, /new\.tenant_id := v_tenant/);
  assert.match(sql, /v_path_tenant := public\.private_upload_path_tenant_id\(new\.storage_path\)/);
  assert.match(sql, /v_path_tenant is null or v_path_tenant <> v_tenant/);
  assert.match(sql, /PAYMENT_ATTACHMENT_PATH_NOT_TENANT_SCOPED/);
  assert.match(sql, /PAYMENT_ATTACHMENT_PAYMENT_MISMATCH/);
});

test("7 · RLS: restrictive staff-only + permissive finance/tenant + delete only staged", async () => {
  const sql = await src(MIG);
  assert.match(sql, /alter table public\.payment_attachments enable row level security/);
  assert.match(sql, /create policy payment_attachments_staff_only\s*\n\s*on public\.payment_attachments as restrictive for all to authenticated\s*\n\s*using \(public\.is_opps_staff\(\)\)/);
  assert.match(sql, /create policy payment_attachments_finance_tenant[\s\S]*is_app_admin\(\) or public\.user_finance_level\(\) in \(1, 2\)\) and public\.can_access_tenant\(tenant_id\)/);
  assert.match(sql, /create policy payment_attachments_delete_staged_only\s*\n\s*on public\.payment_attachments as restrictive for delete to authenticated\s*\n\s*using \(status = 'staged'\)/);
  assert.doesNotMatch(sql, /to anon/);
});

// ── migration: RPC upgrade ───────────────────────────────────────────

test("8 · record_manual_invoice_payment gains p_operation_key (7th arg), reference default null", async () => {
  const sql = await src(MIG);
  assert.match(sql, /drop function if exists public\.record_manual_invoice_payment\(uuid, numeric, text, timestamptz, text, text\)/);
  const sig = sql.slice(
    sql.indexOf("create or replace function public.record_manual_invoice_payment("),
    sql.indexOf("returns jsonb")
  );
  assert.match(sig, /p_reference\s+text\s+default null/);
  assert.match(sig, /p_operation_key\s+text\s+default null/);
  // no mandatory-reference guard any more
  assert.doesNotMatch(sql, /INVOICE_PAYMENT_REFERENCE_REQUIRED/);
});

test("9 · operation-key replay: same key returns original, no 2nd row/event; conflict rejects", async () => {
  const sql = await src(MIG);
  assert.match(sql, /if v_opkey is not null then[\s\S]*client_operation_key = v_opkey/);
  assert.match(sql, /INVOICE_PAYMENT_OPERATION_CONFLICT/);
  // the opkey replay path returns before the ledger insert / audit event
  const opkeyReturn = sql.indexOf("'replayed', true, 'payment_id', v_existing.id");
  const insert = sql.indexOf("insert into public.invoice_payments (");
  const audit = sql.indexOf("insert into public.opps_invoice_activity (\n    invoice_id, tenant_id, activity_type, activity_label, activity_note,\n    from_status, to_status, metadata, created_by\n  ) values (\n    p_invoice_id");
  assert.ok(opkeyReturn > 0 && opkeyReturn < insert, "opkey replay must return before the ledger insert");
  assert.ok(audit > insert, "audit insert follows the ledger insert");
});

test("10 · real-reference duplicate detection preserved", async () => {
  const sql = await src(MIG);
  assert.match(sql, /if v_ref is not null then[\s\S]*and source = 'manual' and reference = v_ref/);
  assert.match(sql, /INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT/);
});

test("11 · unique_violation race on either index degrades to a safe replay", async () => {
  const sql = await src(MIG);
  assert.match(sql, /exception when unique_violation then[\s\S]*client_operation_key = v_opkey[\s\S]*reference = v_ref[\s\S]*'replayed', true/);
});

test("12 · staged proof linked atomically in the same txn; count in audit metadata", async () => {
  const sql = await src(MIG);
  assert.match(sql, /v_proof_count := public\._link_staged_payment_attachments\(p_invoice_id, v_opkey, v_row_id, v_invoice\.tenant_id\)/);
  assert.match(sql, /'proof_count',\s+v_proof_count/);
  assert.match(sql, /'proof_linked', v_proof_count/);
  // link helper only touches staged rows for this op key + invoice + tenant, unlinked
  assert.match(sql, /update public\.payment_attachments\s*\n\s*set payment_id = p_payment_id,\s*\n\s*status = 'linked'[\s\S]*where operation_key = p_operation_key[\s\S]*and payment_id is null\s*\n\s*and status = 'staged'/);
});

test("13 · lifecycle + fail-closed + overpayment guards carried forward", async () => {
  const sql = await src(MIG);
  assert.match(sql, /v_invoice\.status in \('approved', 'partially_paid'\) then/);
  assert.match(sql, /elsif v_invoice\.status = 'overdue' and v_status_after = 'paid'/);
  assert.match(sql, /INVOICE_PAYMENT_BRIDGE_SCHEMA_MISSING/);
  assert.match(sql, /INVOICE_PAYMENT_OVERPAYMENT/);
  assert.match(sql, /INVOICE_PAYMENT_UNRECONCILED_ORDER_PAYMENT/);
});

test("14 · attach_payment_proof: no ledger row, audit event, tenant+finance gated", async () => {
  const sql = await src(MIG);
  const fn = sql.slice(
    sql.indexOf("create or replace function public.attach_payment_proof("),
    sql.indexOf("revoke all on function public.attach_payment_proof")
  );
  assert.ok(fn.length > 0);
  assert.match(fn, /select \* into v_payment from public\.invoice_payments where id = p_payment_id for update/);
  assert.match(fn, /is_app_admin\(\) or public\.user_finance_level\(\) in \(1, 2\)/);
  assert.match(fn, /'invoice_payment_proof_added'/);
  assert.doesNotMatch(fn, /insert into public\.invoice_payments|update public\.invoice_payments/);
  assert.match(sql, /grant execute on function public\.attach_payment_proof\(uuid, text, text, text, bigint\) to authenticated/);
});

test("15 · supersede_payment_attachment: auditable, reason required, no amount change", async () => {
  const sql = await src(MIG);
  const fn = sql.slice(
    sql.indexOf("create or replace function public.supersede_payment_attachment("),
    sql.indexOf("revoke all on function public.supersede_payment_attachment")
  );
  assert.ok(fn.length > 0);
  assert.match(fn, /PAYMENT_ATTACHMENT_REASON_REQUIRED/);
  assert.match(fn, /set status = 'superseded', superseded_by = v_user_id/);
  assert.match(fn, /'invoice_payment_proof_superseded'/);
  assert.doesNotMatch(fn, /insert into public\.invoice_payments|update public\.invoice_payments/);
});

test("16 · preflight tolerates the already-upgraded signature", async () => {
  const sql = await src(MIG);
  assert.match(sql, /from pg_proc\s*\n\s*where proname = 'record_manual_invoice_payment'/);
  assert.match(sql, /to_regprocedure\('public\.private_upload_path_tenant_id\(text\)'\)/);
});

// ── api/invoices.js ──────────────────────────────────────────────────

test("17 · recordManualInvoicePayment threads operationKey, reference optional", async () => {
  const js = await src(API);
  assert.match(js, /operationKey = null,\n\}\) \{\n  ensureSupabase\(\);\n  const params = \{\n    p_invoice_id: invoiceId,\n    p_amount: amount,\n    p_method: method \|\| "eft",/);
  assert.match(js, /if \(ref\) params\.p_reference = ref;/);
  assert.match(js, /if \(operationKey && String\(operationKey\)\.trim\(\)\) params\.p_operation_key = String\(operationKey\)\.trim\(\)/);
  assert.match(js, /proof_linked: Number\(data\?\.proof_linked \|\| 0\)/);
});

test("18 · proof staging: private bucket, tenant+op-scoped path, no public URL", async () => {
  const js = await src(API);
  assert.match(js, /export const PAYMENT_PROOF_ACCEPT = \["image\/jpeg", "image\/jpg", "image\/png", "application\/pdf"\]/);
  assert.match(js, /export const PAYMENT_PROOF_MAX_BYTES = 15 \* 1024 \* 1024/);
  assert.match(js, /supabase\.storage\.from\("uploads"\)\.upload\(path, file/);
  assert.match(js, /const path = `\$\{tenantId\}\/finance\/payment-proof\/\$\{safeOp\}\//);
  assert.match(js, /toPrivateUploadRef\("uploads", path\)/);
  assert.doesNotMatch(js, /getPublicUrl\([^)]*payment-proof/);
  assert.match(js, /export async function stagePaymentProof\(/);
  assert.match(js, /\.from\("payment_attachments"\)\s*\n\s*\.insert\(\{/);
});

test("19 · staged-proof removal + signed-URL preview + add-to-existing + supersede wrappers", async () => {
  const js = await src(API);
  assert.match(js, /export async function removeStagedPaymentProof\(/);
  assert.match(js, /export async function listPaymentAttachments\(/);
  assert.match(js, /export async function getPaymentProofSignedUrl\(/);
  assert.match(js, /getSignedFileUrl\(toPrivateUploadRef\(/);
  assert.match(js, /export async function attachProofToPayment\(/);
  assert.match(js, /supabase\.rpc\("attach_payment_proof"/);
  assert.match(js, /export async function supersedePaymentAttachment\(/);
  assert.match(js, /supabase\.rpc\("supersede_payment_attachment"/);
});

test("20 · early client-side file-type / size rejection", async () => {
  const js = await src(API);
  assert.match(js, /function assertPaymentProofFile\(file\) \{/);
  assert.match(js, /PAYMENT_ATTACHMENT_BAD_TYPE/);
  assert.match(js, /PAYMENT_ATTACHMENT_TOO_LARGE/);
  assert.match(js, /assertPaymentProofFile\(file\);/);
});

test("21 · new error codes surfaced with friendly copy", async () => {
  const js = await src(API);
  for (const code of [
    "INVOICE_PAYMENT_OPERATION_CONFLICT",
    "PAYMENT_ATTACHMENT_PATH_NOT_TENANT_SCOPED",
    "PAYMENT_ATTACHMENT_REASON_REQUIRED",
  ]) {
    assert.match(js, new RegExp(`${code}:\\s*"[^"]+"`), `error map missing ${code}`);
  }
});
