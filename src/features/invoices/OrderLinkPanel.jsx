import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, ArrowRightLeft, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dataClient } from "@/api/dataClient";
import { buildOrderInvoiceSyncPlan } from "./orderToInvoiceItems";
import { previewInvoiceOrderSync } from "@/api/invoices";
import SyncDiffSummary from "./SyncDiffSummary";

// Legacy/untyped boundaries, isolated locally so the rest of this file stays
// checked. dataClient.entities has no static shape under checkJs, and the
// shared shadcn wrappers below don't publish prop types.
const orderEntity = /** @type {any} */ (dataClient.entities).Order;
const UIButton = /** @type {any} */ (Button);
const UIInput = /** @type {any} */ (Input);
const UIDialogContent = /** @type {any} */ (DialogContent);
const UIDialogHeader = /** @type {any} */ (DialogHeader);
const UIDialogTitle = /** @type {any} */ (DialogTitle);
const UIDialogDescription = /** @type {any} */ (DialogDescription);
const UIDialogFooter = /** @type {any} */ (DialogFooter);

export default function OrderLinkPanel({ invoice, isDraft, onLink, onUnlink, onSync, onSyncFromInvoice, isPending }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmAction, setConfirmAction] = useState(null); // { mode: 'link'|'sync', order, diff }
  const [reverseConfirm, setReverseConfirm] = useState(null); // { order, diff, products } from previewInvoiceOrderSync
  const [removalChoices, setRemovalChoices] = useState(/** @type {Set<string>} */ (new Set()));
  const [productionConfirmed, setProductionConfirmed] = useState(/** @type {Set<string>} */ (new Set()));
  const [previewLoading, setPreviewLoading] = useState(false);

  const linkedOrderQuery = useQuery({
    queryKey: ["invoiceLinkedOrder", invoice?.source_order_id],
    queryFn: () => orderEntity.filter({ id: invoice.source_order_id }, "-created_date", 1).then((rows) => rows?.[0] || null),
    enabled: Boolean(invoice?.source_order_id),
  });

  const candidateOrdersQuery = useQuery({
    queryKey: ["invoiceLinkCandidateOrders", invoice?.customer_id],
    queryFn: () => (
      invoice.customer_id
        ? orderEntity.filter({ client_id: invoice.customer_id }, "-created_date", 50)
        : orderEntity.list("-created_date", 50)
    ),
    enabled: pickerOpen,
  });

  const filteredCandidates = useMemo(() => {
    const list = Array.isArray(candidateOrdersQuery.data) ? candidateOrdersQuery.data : [];
    if (!search.trim()) return list;
    const needle = search.trim().toLowerCase();
    return list.filter((order) => (
      String(order.order_number || "").toLowerCase().includes(needle)
      || String(order.client_name || "").toLowerCase().includes(needle)
    ));
  }, [candidateOrdersQuery.data, search]);

  const openLinkPreview = (order) => {
    const diff = buildOrderInvoiceSyncPlan(order.products, invoice.items || []).diff;
    setPickerOpen(false);
    setConfirmAction({ mode: "link", order, diff });
  };

  const openSyncPreview = () => {
    if (!linkedOrderQuery.data) return;
    const diff = buildOrderInvoiceSyncPlan(linkedOrderQuery.data.products, invoice.items || [], {
      orderApplyShippingFee: linkedOrderQuery.data.apply_shipping_fee,
      orderShippingFee: linkedOrderQuery.data.shipping_fee,
      invoiceShippingCharge: invoice.shipping_charge,
    }).diff;
    setConfirmAction({ mode: "sync", order: linkedOrderQuery.data, diff });
  };

  const confirmApply = () => {
    if (!confirmAction) return;
    if (confirmAction.mode === "link") onLink?.(confirmAction.order);
    else onSync?.(confirmAction.order);
    setConfirmAction(null);
  };

  // PHASE 11: invoice -> order never mutates the invoice, so it is not
  // gated behind isDraft the way order -> invoice (and link/unlink) are -
  // only a paid or void source invoice blocks it. Do not create a hidden
  // bypass: this exact rule is enforced again, independently, server-side
  // in syncOrderItemsFromInvoice.
  const canSyncInvoiceToOrder = invoice.status !== "paid" && invoice.status !== "void";
  const orderProductsLocked = Boolean(
    linkedOrderQuery.data && ((linkedOrderQuery.data.status && linkedOrderQuery.data.status !== "confirmed") || linkedOrderQuery.data.products_locked_at)
  );

  const openReverseSyncPreview = async () => {
    if (!linkedOrderQuery.data) return;
    setPreviewLoading(true);
    try {
      const preview = await previewInvoiceOrderSync(linkedOrderQuery.data, invoice);
      setRemovalChoices(new Set());
      setProductionConfirmed(new Set());
      setReverseConfirm({ order: linkedOrderQuery.data, ...preview });
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
  // stronger confirmation checkbox before it counts (PHASE 9) - unchecked
  // removal choices on protected lines are dropped, not silently applied.
  const removalChoicesReady = Array.from(removalChoices).every((lineId) => {
    const entry = reverseConfirm?.diff?.missingFromInvoice?.find((row) => row.line_id === lineId);
    return !entry?.hasProductionData || productionConfirmed.has(lineId);
  });

  const confirmReverseApply = () => {
    if (!reverseConfirm) return;
    onSyncFromInvoice?.(reverseConfirm.order, invoice, {
      productsLocked: orderProductsLocked,
      removeLineIds: Array.from(removalChoices),
    });
    setReverseConfirm(null);
  };

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5 md:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Order link</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {invoice.source_order_id ? (linkedOrderQuery.data?.order_number || invoice.source_order_id) : "Not linked to an order"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!invoice.source_order_id && isDraft && (
            <UIButton type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)} disabled={isPending} className="h-8 rounded-xl text-xs">
              <Link2 className="h-3.5 w-3.5" /> Link to order
            </UIButton>
          )}
          {invoice.source_order_id && isDraft && (
            <>
              <UIButton type="button" variant="outline" size="sm" onClick={openSyncPreview} disabled={isPending || !linkedOrderQuery.data} className="h-8 rounded-xl text-xs">
                <ArrowRightLeft className="h-3.5 w-3.5" /> Sync order → invoice
              </UIButton>
              <UIButton type="button" variant="outline" size="sm" onClick={() => onUnlink?.()} disabled={isPending} className="h-8 rounded-xl text-xs text-destructive hover:text-destructive">
                <Unlink className="h-3.5 w-3.5" /> Unlink
              </UIButton>
            </>
          )}
          {invoice.source_order_id && canSyncInvoiceToOrder && (
            <UIButton type="button" variant="outline" size="sm" onClick={openReverseSyncPreview} disabled={isPending || previewLoading || !linkedOrderQuery.data} className="h-8 rounded-xl text-xs">
              <ArrowLeftRight className="h-3.5 w-3.5" /> Sync invoice → order
            </UIButton>
          )}
        </div>
      </div>
      {invoice.source_order_id && !isDraft && (
        <p className="mt-2 text-xs text-muted-foreground">
          {invoice.status === "paid" || invoice.status === "void"
            ? "This invoice is settled - sync in either direction is blocked."
            : "Linking, unlinking, and syncing order → invoice need the invoice to be a draft (use Reopen for corrections). Invoice → order sync does not change this invoice, so it stays available."}
        </p>
      )}
      {!invoice.source_order_id && !isDraft && (
        <p className="mt-2 text-xs text-muted-foreground">Linking is only available while the invoice is a draft.</p>
      )}
      {orderProductsLocked && canSyncInvoiceToOrder && (
        <p className="mt-2 text-xs text-amber-700">This order's products are locked - applying an invoice → order sync will be blocked until it is unlocked.</p>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <UIDialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl">
          <UIDialogHeader>
            <UIDialogTitle>Link to an order</UIDialogTitle>
            <UIDialogDescription>
              {invoice.customer_id
                ? "Showing this client's recent orders."
                : "This invoice has no linked client, so showing recent orders across all clients."}
            </UIDialogDescription>
          </UIDialogHeader>
          <UIInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search order number or client..."
            className="h-10 rounded-xl"
          />
          <div className="space-y-2">
            {candidateOrdersQuery.isLoading ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Loading orders...</p>
            ) : filteredCandidates.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No matching orders found.</p>
            ) : (
              filteredCandidates.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => openLinkPreview(order)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-left text-sm hover:border-primary/40 hover:bg-secondary/40"
                >
                  <span>
                    <span className="font-semibold text-foreground">{order.order_number}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{order.client_name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{order.status}</span>
                </button>
              ))
            )}
          </div>
        </UIDialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <UIDialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl">
          <UIDialogHeader>
            <UIDialogTitle>{confirmAction?.mode === "link" ? "Link and pull in items?" : "Sync from order?"}</UIDialogTitle>
            <UIDialogDescription>
              {confirmAction?.mode === "link"
                ? `Linking to order ${confirmAction?.order?.order_number} will update this invoice's line items as shown below.`
                : `Pulling the latest items from order ${confirmAction?.order?.order_number}.`}
            </UIDialogDescription>
          </UIDialogHeader>
          {confirmAction && <SyncDiffSummary diff={confirmAction.diff} direction="orderToInvoice" />}
          <UIDialogFooter>
            <UIButton variant="outline" onClick={() => setConfirmAction(null)} className="rounded-xl">Cancel</UIButton>
            <UIButton onClick={confirmApply} disabled={isPending} className="rounded-xl">
              {confirmAction?.mode === "link" ? "Link and apply" : "Apply sync"}
            </UIButton>
          </UIDialogFooter>
        </UIDialogContent>
      </Dialog>

      <Dialog open={Boolean(reverseConfirm)} onOpenChange={(open) => !open && setReverseConfirm(null)}>
        <UIDialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl">
          <UIDialogHeader>
            <UIDialogTitle>Sync invoice → order?</UIDialogTitle>
            <UIDialogDescription>
              Pulling the latest commercial line items from invoice {invoice.invoice_number} into order {reverseConfirm?.order?.order_number}. Inventory identity, Product Composition, artwork, and production tracking are never touched by this.
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
            <UIButton onClick={confirmReverseApply} disabled={isPending || !removalChoicesReady || orderProductsLocked} className="rounded-xl">
              Apply sync
            </UIButton>
          </UIDialogFooter>
        </UIDialogContent>
      </Dialog>
    </div>
  );
}
