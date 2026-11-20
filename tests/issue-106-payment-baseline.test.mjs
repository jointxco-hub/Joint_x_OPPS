import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../src/api/cafePayments.js", import.meta.url), "utf8");
const ui = await readFile(new URL("../src/components/orders/drawer/CafeOrderPayments.jsx", import.meta.url), "utf8");

// Regression gate for #106: protect the already-deployed payment path while
// the read-only Café work queue is introduced. These tests do NOT call Supabase.
test("shared Café payments use canonical RPCs without a client-provided tenant", () => {
  assert.match(api, /supabase\.rpc\("qs_opps_staff_payment_state"/);
  assert.match(api, /supabase\.rpc\("qs_opps_record_staff_payment"/);
  assert.match(api, /supabase\.rpc\("qs_reconcile_invoice_receipts"/);
  assert.doesNotMatch(api, /p_tenant_id|tenantId\s*:/);
});

test("Café receipt UI respects closed, review and settled payment blocks", () => {
  assert.match(ui, /!state\.reviewRequired\s*&&\s*!state\.closed/);
  assert.match(ui, /Number\(state\.balanceDue\)\s*>\s*0/);
  assert.match(ui, /!confirmed\s*\|\|\s*!draft\s*\|\|\s*!payable/);
});

test("cash and EFT use shared receipt writer and preserve retry identity", () => {
  assert.match(ui, /recordCafeOrderPayment\(\{\s*oppsOrderId:\s*orderId,\s*\.\.\.draft\s*\}\)/);
  assert.match(ui, /operationKey:\s*crypto\.randomUUID\(\)/);
  assert.match(ui, /inFlight\.current/);
  assert.match(ui, /draft\.method\s*===\s*"eft"\s*&&\s*!draft\.reference\.trim\(\)/);
});

test("invoice receipt sync does not create a second receipt", () => {
  assert.match(ui, /reconcileCafeInvoiceReceipts\(state\.orderId\)/);
  assert.match(ui, /state\.issues\[0\]\s*===\s*"invoice_projection_missing"/);
  assert.doesNotMatch(ui, /from\(["'](?:invoice_payments|transactions)["']\)\.insert/);
});
