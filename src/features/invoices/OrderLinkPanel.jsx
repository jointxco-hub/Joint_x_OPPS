import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, RefreshCw, Unlink } from "lucide-react";
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

function DiffSummary({ diff }) {
  const rows = [
    ["Will be added from the order", diff.added],
    ["Will be updated to match the order", diff.updated],
    ["No longer on the order — will be removed", diff.removedFromOrder],
    ["Kept as-is (not from this order)", diff.keptInvoiceOnly],
  ].filter(([, names]) => names.length > 0);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No changes — invoice lines already match the order.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map(([label, names]) => (
        <div key={label}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label} ({names.length})</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground">
            {names.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function OrderLinkPanel({ invoice, isDraft, onLink, onUnlink, onSync, isPending }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmAction, setConfirmAction] = useState(null); // { mode: 'link'|'sync', order, diff }

  const linkedOrderQuery = useQuery({
    queryKey: ["invoiceLinkedOrder", invoice?.source_order_id],
    queryFn: () => dataClient.entities.Order.filter({ id: invoice.source_order_id }, "-created_date", 1).then((rows) => rows?.[0] || null),
    enabled: Boolean(invoice?.source_order_id),
  });

  const candidateOrdersQuery = useQuery({
    queryKey: ["invoiceLinkCandidateOrders", invoice?.customer_id],
    queryFn: () => (
      invoice.customer_id
        ? dataClient.entities.Order.filter({ client_id: invoice.customer_id }, "-created_date", 50)
        : dataClient.entities.Order.list("-created_date", 50)
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
    const diff = buildOrderInvoiceSyncPlan(linkedOrderQuery.data.products, invoice.items || []).diff;
    setConfirmAction({ mode: "sync", order: linkedOrderQuery.data, diff });
  };

  const confirmApply = () => {
    if (!confirmAction) return;
    if (confirmAction.mode === "link") onLink?.(confirmAction.order);
    else onSync?.(confirmAction.order);
    setConfirmAction(null);
  };

  if (!isDraft) {
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-2.5 md:px-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Order link</p>
        <p className="mt-1 text-sm text-foreground">
          {invoice.source_order_id ? `Linked to order ${linkedOrderQuery.data?.order_number || invoice.source_order_id}` : "Not linked to an order"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Linking, syncing, and unlinking are only available while the invoice is a draft.</p>
      </div>
    );
  }

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
          {invoice.source_order_id ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={openSyncPreview} disabled={isPending || !linkedOrderQuery.data} className="h-8 rounded-xl text-xs">
                <RefreshCw className="h-3.5 w-3.5" /> Sync from order
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onUnlink?.()} disabled={isPending} className="h-8 rounded-xl text-xs text-destructive hover:text-destructive">
                <Unlink className="h-3.5 w-3.5" /> Unlink
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)} disabled={isPending} className="h-8 rounded-xl text-xs">
              <Link2 className="h-3.5 w-3.5" /> Link to order
            </Button>
          )}
        </div>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Link to an order</DialogTitle>
            <DialogDescription>
              {invoice.customer_id
                ? "Showing this client's recent orders."
                : "This invoice has no linked client, so showing recent orders across all clients."}
            </DialogDescription>
          </DialogHeader>
          <Input
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
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{confirmAction?.mode === "link" ? "Link and pull in items?" : "Sync from order?"}</DialogTitle>
            <DialogDescription>
              {confirmAction?.mode === "link"
                ? `Linking to order ${confirmAction?.order?.order_number} will update this invoice's line items as shown below.`
                : `Pulling the latest items from order ${confirmAction?.order?.order_number}.`}
            </DialogDescription>
          </DialogHeader>
          {confirmAction && <DiffSummary diff={confirmAction.diff} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)} className="rounded-xl">Cancel</Button>
            <Button onClick={confirmApply} disabled={isPending} className="rounded-xl">
              {confirmAction?.mode === "link" ? "Link and apply" : "Apply sync"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
