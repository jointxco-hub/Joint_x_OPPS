import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { previewInvoiceOrderSync } from "@/api/invoices";
import { canSyncInvoiceToOrder, isOrderProductsLocked } from "./orderToInvoiceItems";
import SyncDiffSummary from "./SyncDiffSummary";

const UIButton = /** @type {any} */ (Button);
const UIDialogContent = /** @type {any} */ (DialogContent);
const UIDialogHeader = /** @type {any} */ (DialogHeader);
const UIDialogTitle = /** @type {any} */ (DialogTitle);
const UIDialogDescription = /** @type {any} */ (DialogDescription);
const UIDialogFooter = /** @type {any} */ (DialogFooter);

// The single "invoice -> order" sync implementation - preview
// (previewInvoiceOrderSync), confirm dialog (SyncDiffSummary), removal
// choices, and the apply call via onSyncFromInvoke. Both the invoice
// detail view (OrderLinkPanel.jsx) and the Order Drawer's linked-invoice
// status card render THIS component for the action - neither
// reimplements any of this logic, so there is exactly one place that can
// ever drift. Lifecycle rule (canSyncInvoiceToOrder/isOrderProductsLocked)
// lives in orderToInvoiceItems.js, re-exported here for callers that
// already import from this file.
export { canSyncInvoiceToOrder, isOrderProductsLocked };

export default function InvoiceOrderSyncAction({ order, invoice, onSyncFromInvoice, isPending, triggerLabel = "Sync invoice → order" }) {
  const [reverseConfirm, setReverseConfirm] = useState(/** @type {any} */ (null));
  const [removalChoices, setRemovalChoices] = useState(/** @type {Set<string>} */ (new Set()));
  const [productionConfirmed, setProductionConfirmed] = useState(/** @type {Set<string>} */ (new Set()));
  const [previewLoading, setPreviewLoading] = useState(false);

  const eligible = canSyncInvoiceToOrder(invoice?.status);
  const locked = isOrderProductsLocked(order);

  const openPreview = async () => {
    if (!order || !invoice) return;
    setPreviewLoading(true);
    try {
      const preview = await previewInvoiceOrderSync(order, invoice);
      setRemovalChoices(new Set());
      setProductionConfirmed(new Set());
      setReverseConfirm({ order, ...preview });
    } finally {
      setPreviewLoading(false);
    }
  };

  const toggleRemoval = (lineId) => {
    setRemovalChoices((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  const toggleProductionConfirmed = (lineId) => {
    setProductionConfirmed((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  // A removal choice on a production-data-bearing line requires its own
  // stronger confirmation checkbox before it counts - unchecked removal
  // choices on protected lines are dropped, not silently applied.
  const removalChoicesReady = Array.from(removalChoices).every((lineId) => {
    const entry = reverseConfirm?.diff?.missingFromInvoice?.find((row) => row.line_id === lineId);
    return !entry?.hasProductionData || productionConfirmed.has(lineId);
  });

  const confirmApply = () => {
    if (!reverseConfirm) return;
    onSyncFromInvoice?.(reverseConfirm.order, invoice, {
      productsLocked: locked,
      removeLineIds: Array.from(removalChoices),
    });
    setReverseConfirm(null);
  };

  if (!order || !invoice) return null;

  return (
    <>
      {!eligible && (
        <p className="text-xs text-muted-foreground">
          This invoice is {invoice.status} - invoice → order sync is blocked.
        </p>
      )}
      {eligible && locked && (
        <p className="text-xs text-amber-700">Unlock order for correction before syncing invoice changes.</p>
      )}
      {eligible && invoice.status === "approved" && (
        <p className="text-xs text-muted-foreground">
          This invoice is approved. Syncing will not change the invoice itself - the order will be aligned to this approved financial record.
        </p>
      )}
      {eligible && (
        <UIButton
          type="button"
          variant="outline"
          size="sm"
          onClick={openPreview}
          disabled={isPending || previewLoading || locked}
          className="h-8 rounded-xl text-xs"
          title={locked ? "Unlock order for correction before syncing invoice changes" : undefined}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" /> {triggerLabel}
        </UIButton>
      )}

      <Dialog open={Boolean(reverseConfirm)} onOpenChange={(open) => !open && setReverseConfirm(null)}>
        <UIDialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl">
          <UIDialogHeader>
            <UIDialogTitle>Sync invoice → order?</UIDialogTitle>
            <UIDialogDescription>
              Pulling the latest commercial line items from invoice {invoice.invoice_number} into order {reverseConfirm?.order?.order_number}.
              {invoice.status === "approved" && " This invoice is approved and will not be changed - only the order is updated."}
              {" "}Inventory identity, Product Composition, artwork, and production tracking are never touched by this.
            </UIDialogDescription>
          </UIDialogHeader>
          {reverseConfirm && <SyncDiffSummary diff={reverseConfirm.diff} direction="invoiceToOrder" />}
          {reverseConfirm?.diff?.missingFromInvoice?.length > 0 && (
            <div className="rounded-xl border border-border bg-secondary/20 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Choose what to do with removed lines</p>
              <div className="mt-2 space-y-2">
                {reverseConfirm.diff.missingFromInvoice.map((entry) => (
                  <div key={entry.line_id} className="rounded-lg border border-border bg-card p-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={removalChoices.has(entry.line_id)} onChange={() => toggleRemoval(entry.line_id)} />
                      Remove &quot;{entry.name}&quot; from the order (default: keep)
                    </label>
                    {entry.hasProductionData && removalChoices.has(entry.line_id) && (
                      <label className="mt-1.5 flex items-center gap-2 pl-6 text-xs font-semibold text-red-700">
                        <input type="checkbox" checked={productionConfirmed.has(entry.line_id)} onChange={() => toggleProductionConfirmed(entry.line_id)} />
                        I understand this line has snapshots/reservations/tracking and will use the release workflow separately
                      </label>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <UIDialogFooter>
            <UIButton variant="outline" onClick={() => setReverseConfirm(null)} className="rounded-xl">Cancel</UIButton>
            <UIButton onClick={confirmApply} disabled={isPending || !removalChoicesReady || locked} className="rounded-xl">
              Apply sync
            </UIButton>
          </UIDialogFooter>
        </UIDialogContent>
      </Dialog>
    </>
  );
}
