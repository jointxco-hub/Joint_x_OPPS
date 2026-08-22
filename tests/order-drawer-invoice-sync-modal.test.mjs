import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// Root cause: the shared shadcn Dialog primitive sat at z-50 - BELOW the
// Order Drawer's own backdrop (z-[55]) and panel (z-[60]). Every dialog
// consumer that had ever been triggered from inside the drawer used its
// own ad-hoc z-[80]/z-[90]/z-[95] override (OrderFilesTab.jsx,
// ClientAssetPickerModal.jsx, OrderQuickPrintSheet.jsx) - the shared
// Dialog component itself had simply never been exercised from inside a
// drawer before this feature, so the gap was latent. These tests guard
// the fix and the "single shared implementation" requirement - none of
// them can substitute for an actual browser check of paint order, which
// this environment cannot perform.
// ─────────────────────────────────────────────────────────────────────

test("the shared Dialog primitive renders above the Order Drawer panel (z-[90] > drawer's z-[60])", async () => {
  const source = await readSource("src/components/ui/dialog.jsx");
  // Check the actual className strings, not just absence of the digits
  // "z-50" anywhere in the file - the file's own explanatory comment
  // legitimately mentions the old value as history.
  assert.ok(!source.includes('"fixed inset-0 z-50 '), "DialogOverlay must not regress to the pre-fix className");
  assert.ok(!source.includes("top-[50%] z-50 grid"), "DialogContent must not regress to the pre-fix className");
  const zIndexOccurrences = (source.match(/z-\[90\]/g) || []).length;
  assert.ok(zIndexOccurrences >= 2, "both DialogOverlay and DialogContent must use z-[90] - the already-established above-drawer layer used by ClientAssetPickerModal/OrderFilesTab/OrderQuickPrintSheet");
});

test("the fix is centralized in the one shared Dialog component, not scattered per-usage overrides", async () => {
  const [orderLinkPanel, invoiceOrderSyncAction, invoicesTab] = await Promise.all([
    readSource("src/features/invoices/OrderLinkPanel.jsx"),
    readSource("src/features/invoices/InvoiceOrderSyncAction.jsx"),
    readSource("src/components/orders/drawer/InvoicesTab.jsx"),
  ]);
  for (const source of [orderLinkPanel, invoiceOrderSyncAction, invoicesTab]) {
    assert.ok(!source.includes("z-[90]"), "sync UI files must not need their own z-index override - the shared Dialog component owns that now");
  }
});

test("InvoicesTab (Order Drawer) renders the same InvoiceOrderSyncAction component OrderLinkPanel (invoice page) uses - no second implementation", async () => {
  const invoicesTab = await readSource("src/components/orders/drawer/InvoicesTab.jsx");
  const orderLinkPanel = await readSource("src/features/invoices/OrderLinkPanel.jsx");
  assert.ok(invoicesTab.includes('import InvoiceOrderSyncAction from "@/features/invoices/InvoiceOrderSyncAction"'));
  assert.ok(invoicesTab.includes("<InvoiceOrderSyncAction"));
  assert.ok(orderLinkPanel.includes('import InvoiceOrderSyncAction, { canSyncInvoiceToOrder } from "./InvoiceOrderSyncAction"'));
  assert.ok(orderLinkPanel.includes("<InvoiceOrderSyncAction"));
});

test("Order Drawer's linked-invoice status card computes match/differ with the shared diff builder, not ad-hoc comparison", async () => {
  const source = await readSource("src/components/orders/drawer/InvoicesTab.jsx");
  assert.ok(source.includes("buildInvoiceOrderSyncPlan"));
  assert.ok(source.includes("LinkedInvoiceSyncStatus"));
});

test("Review differences renders read-only - no mutation call inside the review dialog itself", async () => {
  const source = await readSource("src/components/orders/drawer/InvoicesTab.jsx");
  const start = source.indexOf("function LinkedInvoiceSyncStatus(");
  const dialogStart = source.indexOf("<Dialog open={reviewOpen}", start);
  assert.notEqual(dialogStart, -1, "the Review differences dialog must exist");
  const dialogEnd = source.indexOf("</Dialog>", dialogStart);
  const dialogBody = source.slice(dialogStart, dialogEnd);
  assert.ok(!dialogBody.includes("onSyncFromInvoice"), "the read-only review dialog must never itself trigger the sync mutation");
  assert.ok(dialogBody.includes("SyncDiffSummary"), "must render the diff preview, not a form/input");
});

test("the sync action still requires an explicit confirm click before writing - preview does not auto-apply", async () => {
  const source = await readSource("src/features/invoices/InvoiceOrderSyncAction.jsx");
  const previewStart = source.indexOf("const openPreview = async ()");
  const previewEnd = source.indexOf("\n  };", previewStart);
  const previewBody = source.slice(previewStart, previewEnd);
  assert.ok(!previewBody.includes("onSyncFromInvoice"), "opening the dialog (fetching a preview) must never itself call the mutation trigger");

  const confirmStart = source.indexOf("const confirmApply = ()");
  assert.notEqual(confirmStart, -1);
  const confirmBody = source.slice(confirmStart, source.indexOf("\n  };", confirmStart));
  assert.ok(confirmBody.includes("onSyncFromInvoice?.("), "the mutation trigger call must live in the explicit confirm handler");
  assert.ok(source.includes("Apply sync"), "the confirm button must exist and require an explicit click");
});
