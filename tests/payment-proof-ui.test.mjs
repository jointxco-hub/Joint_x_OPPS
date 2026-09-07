import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const MODAL = "src/features/invoices/InvoicePaymentModal.jsx";
const SECTION = "src/features/invoices/InvoicePaymentsSection.jsx";
const DRAWER = "src/features/invoices/InvoiceDetailDrawer.jsx";
const PAGE = "src/pages/Invoices.jsx";
const API = "src/api/invoices.js";
const RULES = "src/features/invoices/paymentProofRules.js";
const HARDEN = "supabase/migrations/20260907140000_payment_proof_storage_hardening.sql";

// ── modal ────────────────────────────────────────────────────────────

test("1 · modal generates one operation key per open and reuses it on submit + retry", async () => {
  const jsx = await src(MODAL);
  assert.match(jsx, /operationKeyRef\.current = newPaymentOperationKey\(\)/);
  assert.match(jsx, /useEffect\(\(\) => \{\s*\n\s*if \(!open\) return;\s*\n\s*operationKeyRef\.current = newPaymentOperationKey\(\)/);
  assert.match(jsx, /operationKey: operationKeyRef\.current,/);
  // submit failure preserves key + staged files (no reset, no auto-retry)
  assert.match(jsx, /catch \(error\) \{\s*\n\s*\/\/ Preserve the operation key \+ staged files[\s\S]*setSubmitError/);
  assert.doesNotMatch(jsx, /setAttachments\(\[\]\)[\s\S]{0,80}catch/);
});

test("2 · reference and proof are optional; confirm gates only on amount / active upload / failed upload / pending", async () => {
  const jsx = await src(MODAL);
  assert.match(jsx, /const canSubmit = amountValid && !overBalance && !isPending && !uploading && !failed;/);
  assert.match(jsx, /reference: reference\.trim\(\) \|\| null,/);
  assert.match(jsx, /Bank \/ receipt reference <span[^>]*>\(optional\)/);
  assert.doesNotMatch(jsx, /referenceValid/);
});

test("3 · multi-file JPG/PNG/PDF picker + drag-drop; 15 MB / type rejected client-side via the leaf rules module", async () => {
  const jsx = await src(MODAL);
  assert.match(jsx, /accept=\{ACCEPT_ATTR\}/);
  assert.match(jsx, /const ACCEPT_ATTR = "\.jpg,\.jpeg,\.png,\.pdf,image\/jpeg,image\/png,application\/pdf"/);
  assert.match(jsx, /<input\s+ref=\{fileInputRef\}\s+type="file"\s+accept=\{ACCEPT_ATTR\}\s+multiple/);
  assert.match(jsx, /onDrop=\{\(e\) => \{ e\.preventDefault\(\); setDragActive\(false\); addFiles\(e\.dataTransfer\?\.files\); \}\}/);
  // client-side validation is the shared leaf helper, imported (not pulled through the api module)
  assert.match(jsx, /import \{ paymentProofFileProblem \} from "@\/features\/invoices\/paymentProofRules"/);
  assert.match(jsx, /const fileProblem = paymentProofFileProblem;/);
  assert.match(jsx, /const problem = fileProblem\(file\);/);
});

test("3b · shared proof rules live in a leaf module; api re-exports the constants", async () => {
  const rules = await src(RULES);
  assert.match(rules, /export const PAYMENT_PROOF_ACCEPT = \["image\/jpeg", "image\/jpg", "image\/png", "application\/pdf"\]/);
  assert.match(rules, /export const PAYMENT_PROOF_MAX_BYTES = 15 \* 1024 \* 1024/);
  assert.match(rules, /export function paymentProofFileProblem\(file\)/);
  assert.match(rules, /if \(!PAYMENT_PROOF_ACCEPT\.includes\(type\)\) return "Only JPG, PNG or PDF/);
  assert.match(rules, /Number\(file\?\.size \|\| 0\) > PAYMENT_PROOF_MAX_BYTES\) return "Proof-of-payment files must be 15 MB or smaller/);
  // leaf: no imports at all
  assert.doesNotMatch(rules, /^import /m);
  const js = await src(API);
  assert.match(js, /import \{ PAYMENT_PROOF_ACCEPT, PAYMENT_PROOF_MAX_BYTES \} from "@\/features\/invoices\/paymentProofRules"/);
  assert.match(js, /export \{ PAYMENT_PROOF_ACCEPT, PAYMENT_PROOF_MAX_BYTES \};/);
});

test("4 · staging goes through the RPC helper, not a direct table write; per-file states", async () => {
  const jsx = await src(MODAL);
  assert.match(jsx, /await stagePaymentProof\(\{\s*\n\s*invoiceId: invoice\.id,\s*\n\s*operationKey: operationKeyRef\.current,\s*\n\s*file,\s*\n\s*\}\)/);
  assert.doesNotMatch(jsx, /\.from\("payment_attachments"\)/);
  assert.match(jsx, /status: "uploading"/);
  assert.match(jsx, /\{ \.\.\.a, status: "done", row \}/);
  assert.match(jsx, /status: "error", error:/);
  // preview via signed URL, remove-before-confirm
  assert.match(jsx, /getPaymentProofSignedUrl\(row\)/);
  assert.match(jsx, /await removeStagedPaymentProof\(target\.row\.id\)/);
});

test("5 · cancel/close cleans up staged uploads; success does not", async () => {
  const jsx = await src(MODAL);
  assert.match(jsx, /if \(!next && !succeededRef\.current\) void cleanupStaged\(\)/);
  assert.match(jsx, /succeededRef\.current = true;\s*\n\s*onOpenChange\?\.\(false\)/);
  assert.match(jsx, /cleanupAbandonedPaymentProof\(operationKeyRef\.current\)/);
});

// ── payments history section ─────────────────────────────────────────

test("6 · payments section: per-entry amount/method/date/reference + proof chips with signed-URL open", async () => {
  const jsx = await src(SECTION);
  assert.match(jsx, /export default function InvoicePaymentsSection\(/);
  assert.match(jsx, /money\(payment\.amount\)/);
  assert.match(jsx, /METHOD_LABELS\[payment\.method\]/);
  assert.match(jsx, /shortDate\(payment\.paid_at\)/);
  assert.match(jsx, /payment\.reference \?[\s\S]*<span className="italic">No reference<\/span>/);
  assert.match(jsx, /getPaymentProofSignedUrl\(row\)[\s\S]*window\.open\(url, "_blank", "noopener,noreferrer"\)/);
});

test("7 · add proof (existing payment) + retire with mandatory reason for finance only; no ledger change implied", async () => {
  const jsx = await src(SECTION);
  assert.match(jsx, /onAddProof\?\.\(payment, file\)/);
  assert.match(jsx, /canRetireProof && \(/);
  assert.match(jsx, /onRequestRetire\(a\)/);
  assert.match(jsx, /if \(!retireTarget \|\| !retireReason\.trim\(\)\) return;/);
  assert.match(jsx, /disabled=\{!retireReason\.trim\(\) \|\| isProofBusy\}/);
  assert.match(jsx, /does not delete it, change the payment, or alter any total/);
  // superseded evidence shown, struck through, with reason
  assert.match(jsx, /a\.status === "superseded"/);
  assert.match(jsx, /line-through/);
  assert.match(jsx, /Retired<\/span>/);
  assert.match(jsx, /a\.supersede_reason/);
});

// ── wiring ───────────────────────────────────────────────────────────

test("8 · api: newPaymentOperationKey + listInvoicePaymentsWithProof", async () => {
  const js = await src(API);
  assert.match(js, /export function newPaymentOperationKey\(\) \{[\s\S]*crypto\.randomUUID\(\)/);
  assert.match(js, /export async function listInvoicePaymentsWithProof\(invoiceId\) \{/);
  assert.match(js, /\.from\("invoice_payments"\)\s*\n\s*\.select\("id, amount, paid_at, method, reference, source, client_operation_key/);
  assert.match(js, /\.from\("payment_attachments"\)\s*\n\s*\.select\("\*"\)\s*\n\s*\.eq\("invoice_id", invoiceId\)/);
  assert.match(js, /rows\.map\(\(p\) => \(\{ \.\.\.p, attachments: byPayment\.get\(p\.id\) \|\| \[\] \}\)\)/);
});

test("9 · Invoices.jsx: payments query + add/retire proof mutations wired to the drawer", async () => {
  const jsx = await src(PAGE);
  assert.match(jsx, /queryKey: \["invoicePayments", selectedInvoice\?\.id\]/);
  assert.match(jsx, /listInvoicePaymentsWithProof\(selectedInvoice\.id\)/);
  assert.match(jsx, /const addPaymentProofMutation = useMutation\(\{\s*\n\s*mutationFn: \(\{ payment, file \}\) => attachProofToPayment\(\{ paymentId: payment\.id, file \}\)/);
  assert.match(jsx, /const retirePaymentProofMutation = useMutation\(\{\s*\n\s*mutationFn: \(\{ attachment, reason \}\) => supersedePaymentAttachment\(attachment\.id, reason\)/);
  assert.match(jsx, /payments=\{paymentsQuery\.data \|\| \[\]\}/);
  assert.match(jsx, /canRetireProof=\{canReopen\}/);
  assert.match(jsx, /onAddPaymentProof=\{\(payment, file\) => addPaymentProofMutation\.mutateAsync\(\{ payment, file \}\)\}/);
  assert.match(jsx, /operationKey \}\) =>\s*\n\s*recordInvoicePayment\(\{ invoice, amount, method, reference, paidAt, note, mode, operationKey \}\)/);
});

test("10 · drawer renders the payments section from props", async () => {
  const jsx = await src(DRAWER);
  assert.match(jsx, /import InvoicePaymentsSection from "\.\/InvoicePaymentsSection"/);
  assert.match(jsx, /<InvoicePaymentsSection\s*\n\s*payments=\{payments\}\s*\n\s*canRetireProof=\{canRetireProof\}/);
});

// ── hardening migration ─────────────────────────────────────────────

test("11 · hardening: anon SELECT revoked, authenticated keeps SELECT only", async () => {
  const sql = await src(HARDEN);
  assert.match(sql, /revoke all on public\.payment_attachments from anon, public/);
  assert.match(sql, /grant select on public\.payment_attachments to authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*payment_attachments[^;]*authenticated/i);
});

test("12 · hardening: RESTRICTIVE storage.objects delete + update policies lock linked/superseded proof", async () => {
  const sql = await src(HARDEN);
  assert.match(sql, /create or replace function public\._payment_proof_object_locked\(p_bucket text, p_name text\)[\s\S]*pa\.status in \('linked', 'superseded'\)/);
  assert.match(sql, /create policy payment_proof_object_locked_delete\s*\n\s*on storage\.objects as restrictive for delete to authenticated\s*\n\s*using \(\s*\n\s*bucket_id <> 'uploads'\s*\n\s*or not public\._payment_proof_object_locked\(bucket_id, name\)/);
  assert.match(sql, /create policy payment_proof_object_locked_update\s*\n\s*on storage\.objects as restrictive for update to authenticated/);
  // does not touch existing policies / bucket privacy / RPCs
  assert.doesNotMatch(sql, /drop policy if exists (private_uploads|phd_staging)/);
  assert.doesNotMatch(sql, /storage\.buckets/);
  assert.doesNotMatch(sql, /(create or replace|drop) function public\.record_manual_invoice_payment/);
  assert.doesNotMatch(sql, /(create or replace|drop|alter)\s+function\s+\S*payfast/i);
});

test("13 · hardening migration is idempotent-guarded + preflight", async () => {
  const sql = await src(HARDEN);
  assert.match(sql, /to_regclass\('public\.payment_attachments'\) is null then\s*\n\s*raise exception 'PAYMENT_PROOF_HARDENING/);
  assert.match(sql, /drop policy if exists payment_proof_object_locked_delete on storage\.objects/);
  assert.match(sql, /drop policy if exists payment_proof_object_locked_update on storage\.objects/);
  assert.match(sql, /create or replace function public\._payment_proof_object_locked/);
});
