import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const INVOICES_PAGE = "src/pages/Invoices.jsx";
const ORDERS_PAGE = "src/pages/Orders.jsx";

function sliceBetween(s, startMarker, endMarker) {
  const start = s.indexOf(startMarker);
  const end = s.indexOf(endMarker, start);
  return s.slice(start, end === -1 ? undefined : end);
}

// Closes specific gaps found in the OPPS data-freshness investigation: a
// payment recorded on Invoices.jsx never refreshed the linked order's own
// Payments tab / Invoices-tab card; approve/reopen never refreshed the
// order drawer's Invoices tab; a total-correction save left the Partial
// Payment modal's cached ["invoicePaymentSummary", id] stale (the confirmed
// source of the R13,700-vs-R14,375 discrepancy); an order edit never
// refreshed its linked invoice card. None of these touch OrderDrawer.jsx or
// useOrderDrawerData.js, which overlap PR #73 and are deliberately left
// alone — see the final report for that deferral.

test("saveMutation invalidates invoicePaymentSummary — fixes the stale Partial Payment modal balance", async () => {
  const s = await src(INVOICES_PAGE);
  const body = sliceBetween(s, "const saveMutation = useMutation", "onSuccess: (invoice) =>");
  assert.match(body, /invalidateQueries\(\{ queryKey: \["invoicePaymentSummary", saved\.id\] \}\)/);
});

test("approveMutation and reopenMutation both invalidate invoicePaymentSummary and orderOppsInvoices", async () => {
  const s = await src(INVOICES_PAGE);
  const approveBody = sliceBetween(s, "const approveMutation = useMutation", "const reopenMutation = useMutation");
  const reopenBody = sliceBetween(s, "const reopenMutation = useMutation", "const issueShareMutation = useMutation");
  for (const [label, body] of [["approve", approveBody], ["reopen", reopenBody]]) {
    assert.match(body, /invalidateQueries\(\{ queryKey: \["invoicePaymentSummary", selectedInvoice\?\.id\] \}\)/, `${label} invalidates invoicePaymentSummary`);
    assert.match(body, /invalidateQueries\(\{ queryKey: \["orderOppsInvoices", selectedInvoice\.source_order_id\] \}\)/, `${label} invalidates the linked order's Invoices tab`);
  }
});

test("recordPaymentMutation invalidates the linked order's payments query and Invoices-tab card", async () => {
  const s = await src(INVOICES_PAGE);
  const body = sliceBetween(s, "const recordPaymentMutation = useMutation", "const addPaymentProofMutation = useMutation");
  assert.match(body, /invalidateQueries\(\{ queryKey: \["payments", selectedInvoice\.source_order_id\] \}\)/);
  assert.match(body, /invalidateQueries\(\{ queryKey: \["orderOppsInvoices", selectedInvoice\.source_order_id\] \}\)/);
});

test("InvoiceDetailDrawer receives isApprovePending from the real mutation, not a hardcoded false", async () => {
  const s = await src(INVOICES_PAGE);
  assert.match(s, /isApprovePending=\{approveMutation\.isPending\}/);
});

test("order updateMutation invalidates the order's linked-invoice query — does not touch OrderDrawer.jsx", async () => {
  const s = await src(ORDERS_PAGE);
  const body = sliceBetween(s, "const updateMutation = useMutation", "onError: (/** @type {any} */ err) => {\n      const { message, shouldRefetch }");
  assert.match(body, /invalidateQueries\(\{ queryKey: \["orderOppsInvoices", updatedOrder\.id\] \}\)/);
});
