import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// src/api/clientProductApprovals.js imports the supabase client via the
// @/ alias. Load the source, shim the import, and test the pure helpers.
async function loadApi() {
  const src = (await readFile(new URL('../src/api/clientProductApprovals.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const shimmed = src.replace('import { supabase } from "@/lib/supabaseClient";', 'const supabase = null;');
  return import(`data:text/javascript;base64,${Buffer.from(shimmed).toString('base64')}`);
}
const { getClientProductApprovals, hasCurrentRevisionApproval, currentRevisionApprovalRecord } = await loadApi();

async function readSource(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
}

const rows = (extra = []) => ([
  { id: 'a1', status: 'approved', revision: 2, approved_by_email: 'client@acme.test', approved_at: '2026-09-01T10:00:00Z' },
  { id: 'a0', status: 'approved', revision: 1, approved_by_email: 'client@acme.test', approved_at: '2026-08-01T10:00:00Z' },
  { id: 'r0', status: 'rejected', revision: 2, rejected_reason: 'wrong colour' },
  ...extra,
]);

// ── verified current-revision approval ────────────────────────────────

test('hasCurrentRevisionApproval: true only when an approved row matches the EXACT current revision', () => {
  assert.equal(hasCurrentRevisionApproval(rows(), 2), true);
});

test('hasCurrentRevisionApproval: STALE revision -> false (approval was for an older revision)', () => {
  assert.equal(hasCurrentRevisionApproval(rows(), 3), false, 'no approved row for rev 3');
  // an approval exists for rev 1 and rev 2, but the product is now on rev 3
});

test('hasCurrentRevisionApproval: ABSENT approval -> false', () => {
  assert.equal(hasCurrentRevisionApproval([{ id: 'p', status: 'pending', revision: 2 }], 2), false);
  assert.equal(hasCurrentRevisionApproval([], 2), false);
});

test('hasCurrentRevisionApproval: never infers from lifecycle status - only the approvals table rows count', () => {
  // a "rejected" row at the current revision is not an approval
  assert.equal(hasCurrentRevisionApproval([{ id: 'r', status: 'rejected', revision: 5 }], 5), false);
});

test('hasCurrentRevisionApproval: guards bad inputs', () => {
  assert.equal(hasCurrentRevisionApproval(null, 2), false);
  assert.equal(hasCurrentRevisionApproval(rows(), null), false);
  assert.equal(hasCurrentRevisionApproval(rows(), undefined), false);
  assert.equal(hasCurrentRevisionApproval(rows(), 'two'), false);
  assert.equal(hasCurrentRevisionApproval(rows(), 2.5), false);
});

test('currentRevisionApprovalRecord: returns the approver detail for the current revision, else null', () => {
  assert.equal(currentRevisionApprovalRecord(rows(), 2)?.id, 'a1');
  assert.equal(currentRevisionApprovalRecord(rows(), 2)?.approved_by_email, 'client@acme.test');
  assert.equal(currentRevisionApprovalRecord(rows(), 3), null);
  assert.equal(currentRevisionApprovalRecord([], 2), null);
});

// ── wrapper: existing RPC only, read-only, no customer function ────────

test('getClientProductApprovals: guards missing client / supabase', async () => {
  assert.deepEqual(await getClientProductApprovals(''), { data: null, error: 'Missing client product id' });
  assert.deepEqual(await getClientProductApprovals('cp-1'), { data: null, error: 'Supabase not configured' });
});

test('wrapper calls ONLY the existing admin_get_client_product_approvals RPC (read); never writes / never customer fn', async () => {
  const src = await readSource('src/api/clientProductApprovals.js');
  assert.ok(src.includes('supabase.rpc("admin_get_client_product_approvals"'), 'uses the existing shared RPC');
  assert.ok(!/\.rpc\(\s*["'`]approve_client_product_concept/.test(src), 'never calls the customer-only approval function');
  assert.ok(!/\.rpc\(\s*["'`](record|create|set|approve|update|revise)_/.test(src), 'no approval-writing RPC');
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(src), 'no direct table writes');
});

// ── ProductsEditor wiring ────────────────────────────────────────────

test('ProductsEditor: verified approval read wired into the client-product selection panel', async () => {
  const src = await readSource('src/components/orders/drawer/ProductsEditor.jsx');
  assert.ok(src.includes('from "@/api/clientProductApprovals"'), 'imports the wrapper');
  assert.ok(src.includes('getClientProductApprovals(selectedComposedClientProductId)'), 'queries approvals for the selected client product');
  assert.ok(src.includes('hasCurrentRevisionApproval(approvalRows, cpItem.revision)'), 'verifies against the exact current revision');
  assert.ok(src.includes('Customer-approved at revision'), 'shows the verified state');
  assert.ok(src.includes('Not customer-approved at the current revision'), 'shows the unverified state');
  assert.ok(src.includes('Checking customer approval'), 'has a loading state');
  assert.ok(src.includes("Couldn't verify customer approval") || src.includes('Couldn&apos;t verify customer approval'), 'has an error state');
});

test('ProductsEditor: lifecycle status label is kept SEPARATE and never says "Client-approved" from active/ready_to_order', async () => {
  const picker = await readSource('src/features/orders/clientProductPicker.js');
  assert.ok(picker.includes('LIFECYCLE_STAGE_LABELS'), 'lifecycle labels are an explicit neutral map');
  assert.ok(picker.includes('active: "Active"'), 'active -> "Active", not "Client-approved"');
  assert.ok(picker.includes('ready_to_order: "Ready to order"'));
  assert.ok(!/if \(item\.approved\) return "Client-approved"/.test(picker), 'the old status->"Client-approved" shortcut is gone');
  const editor = await readSource('src/components/orders/drawer/ProductsEditor.jsx');
  assert.ok(!editor.includes('cpItem.approved ? "bg-emerald'), 'the selection panel no longer colours a lifecycle badge as approved');
});
