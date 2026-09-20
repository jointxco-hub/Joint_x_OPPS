import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, UserPlus } from "lucide-react";
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
import { searchOrdersForInvoiceLink } from "@/api/orders";
import { searchClients, findClientsByContact } from "@/api/clients";
import { toast } from "sonner";

// Legacy/untyped boundaries, same local-cast convention as OrderLinkPanel.jsx.
const clientEntity = /** @type {any} */ (dataClient.entities).Client;
const UIButton = /** @type {any} */ (Button);
const UIInput = /** @type {any} */ (Input);
const UIDialogContent = /** @type {any} */ (DialogContent);
const UIDialogHeader = /** @type {any} */ (DialogHeader);
const UIDialogTitle = /** @type {any} */ (DialogTitle);
const UIDialogDescription = /** @type {any} */ (DialogDescription);
const UIDialogFooter = /** @type {any} */ (DialogFooter);

function formatCurrency(value) {
  return `R${Number(value || 0).toLocaleString()}`;
}

// Resolves how (or whether) THIS invoice and a candidate order can be
// linked, purely from the client identity each side already carries.
// Mirrors link_invoice_to_order_relational()'s own rules exactly, so the
// UI never offers an action the server would refuse:
//   - same non-null client on both sides -> link directly, no attach
//   - one side has a client, the other has none -> fill the empty side
//     (server-verified NULL-only attach)
//   - both null but the same source_quote_id -> link directly (existing
//     clientless-same-quote path, unchanged)
//   - both null, no shared quote -> needs a real Client profile picked
//     or created and attached to both sides first
//   - two different non-null clients -> no path at all; staff must
//     resolve/merge client identity outside this dialog
function resolveLinkMode(invoice, order) {
  const invoiceClientId = invoice?.customer_id || null;
  const orderClientId = order?.client_id || null;

  if (invoiceClientId && orderClientId) {
    return invoiceClientId === orderClientId
      ? { mode: "direct" }
      : { mode: "blocked_mismatch" };
  }
  if (invoiceClientId && !orderClientId) {
    return { mode: "attach", attachClientId: invoiceClientId, attachSide: "order" };
  }
  if (!invoiceClientId && orderClientId) {
    return { mode: "attach", attachClientId: orderClientId, attachSide: "invoice" };
  }
  if (invoice?.source_quote_id && order?.source_quote_id && invoice.source_quote_id === order.source_quote_id) {
    return { mode: "direct" };
  }
  return { mode: "both_clientless" };
}

export default function LinkExistingOrderDialog({ invoice, open, onOpenChange, onConfirm, isPending }) {
  const [search, setSearch] = useState("");
  const [pickedOrder, setPickedOrder] = useState(/** @type {any} */ (null));
  const [clientSearch, setClientSearch] = useState("");
  const [pickedClient, setPickedClient] = useState(/** @type {any} */ (null));
  const [creatingClient, setCreatingClient] = useState(false);

  const searchQuery = useQuery({
    queryKey: ["invoiceLinkExistingOrderSearch", search.trim()],
    queryFn: () => searchOrdersForInvoiceLink({ query: search.trim() }),
    enabled: open && search.trim().length >= 2,
  });

  const resolution = useMemo(
    () => (pickedOrder ? resolveLinkMode(invoice, pickedOrder) : null),
    [invoice, pickedOrder]
  );

  const contactSuggestionQuery = useQuery({
    queryKey: ["invoiceLinkContactSuggestion", invoice?.id, pickedOrder?.id],
    queryFn: () => findClientsByContact({
      email: invoice?.customer_email || pickedOrder?.client_email,
      phone: invoice?.customer_phone || pickedOrder?.client_phone,
    }),
    enabled: Boolean(open && resolution?.mode === "both_clientless"),
  });

  const clientSearchQuery = useQuery({
    queryKey: ["invoiceLinkClientSearch", clientSearch.trim()],
    queryFn: () => searchClients({ query: clientSearch.trim() }),
    enabled: Boolean(open && resolution?.mode === "both_clientless" && clientSearch.trim().length >= 2),
  });

  const reset = () => {
    setSearch("");
    setPickedOrder(null);
    setClientSearch("");
    setPickedClient(null);
    setCreatingClient(false);
  };

  // Covers every close path, including the parent closing this dialog
  // directly after a confirm (success or failure) without going through
  // onOpenChange - reopening later must never show a stale picked order.
  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const close = () => {
    onOpenChange?.(false);
  };

  const createAndAttachClient = async () => {
    setCreatingClient(true);
    try {
      const name = invoice?.customer_name || pickedOrder?.client_name || "New client";
      const email = invoice?.customer_email || pickedOrder?.client_email || undefined;
      const phone = invoice?.customer_phone || pickedOrder?.client_phone || undefined;
      const created = await clientEntity.create({
        name,
        email,
        phone,
        status: "active",
        total_orders: 0,
        total_revenue: 0,
      });
      toast.success(`Client "${name}" created`);
      setPickedClient(created);
    } catch (error) {
      toast.error(error?.message || "Could not create client");
    } finally {
      setCreatingClient(false);
    }
  };

  const confirmDirect = () => {
    if (!pickedOrder) return;
    onConfirm?.(pickedOrder, {});
  };

  const confirmAttach = () => {
    if (!pickedOrder || !resolution) return;
    if (resolution.mode === "attach") {
      onConfirm?.(pickedOrder, { attachClientId: resolution.attachClientId });
    } else if (resolution.mode === "both_clientless" && pickedClient) {
      onConfirm?.(pickedOrder, { attachClientId: pickedClient.id });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else onOpenChange?.(true); }}>
      <UIDialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl">
        <UIDialogHeader>
          <UIDialogTitle>Link existing order</UIDialogTitle>
          <UIDialogDescription>
            Search by order number, client name, email, or phone. This only sets the order relationship -
            line items and totals are never changed here. Use &quot;Sync invoice items to order&quot; separately if you also want the order&apos;s products aligned with this invoice.
          </UIDialogDescription>
        </UIDialogHeader>

        {!pickedOrder ? (
          <div className="space-y-2">
            <UIInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search order number, name, email, or phone..."
              className="h-10 rounded-xl"
              autoFocus
            />
            <div className="space-y-2">
              {search.trim().length < 2 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Type at least 2 characters to search.</p>
              ) : searchQuery.isLoading ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Searching...</p>
              ) : (searchQuery.data || []).length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No matching orders found.</p>
              ) : (
                (searchQuery.data || []).map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setPickedOrder(order)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-left text-sm hover:border-primary/40 hover:bg-secondary/40"
                  >
                    <span>
                      <span className="font-semibold text-foreground">{order.order_number}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{order.client_name}</span>
                      {(order.client_email || order.client_phone) && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {[order.client_email, order.client_phone].filter(Boolean).join(" - ")}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatCurrency(order.total_amount)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-secondary/20 p-3">
              <p className="text-sm font-semibold text-foreground">{pickedOrder.order_number}</p>
              <p className="text-xs text-muted-foreground">{pickedOrder.client_name} - {formatCurrency(pickedOrder.total_amount)}</p>
              <button type="button" onClick={() => setPickedOrder(null)} className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                Choose a different order
              </button>
            </div>

            {resolution?.mode === "direct" && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
                <p className="text-foreground">This invoice and order already share the same client identity.</p>
                <p className="mt-1 text-xs text-muted-foreground">Linking sets the order relationship only - no items or totals change.</p>
              </div>
            )}

            {resolution?.mode === "blocked_mismatch" && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                This invoice and this order belong to two different client profiles. Resolve or merge the client
                identity first (outside this dialog) before linking - there is no override for this.
              </div>
            )}

            {resolution?.mode === "attach" && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p>
                  {resolution.attachSide === "order"
                    ? "This order has no client profile yet. Confirming will attach it to this invoice's client."
                    : "This invoice has no client profile yet. Confirming will attach it to this order's client."}
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  This only fills the missing side - it never reassigns an existing client link.
                </p>
              </div>
            )}

            {resolution?.mode === "both_clientless" && (
              <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p>Neither this invoice nor this order has a client profile. Pick or create one to attach to both before linking.</p>
                {(contactSuggestionQuery.data || []).length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-white/60 p-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Matching email/phone found (suggestion only)</p>
                    {contactSuggestionQuery.data.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => setPickedClient(client)}
                        className={`mt-1 flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-left text-xs hover:bg-amber-100 ${pickedClient?.id === client.id ? "border-primary bg-amber-100" : "border-amber-200"}`}
                      >
                        <span>{client.name}</span>
                        <span className="text-muted-foreground">{client.email || client.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
                <UIInput
                  value={clientSearch}
                  onChange={(event) => setClientSearch(event.target.value)}
                  placeholder="Search existing clients..."
                  className="h-9 rounded-lg text-sm"
                />
                {clientSearch.trim().length >= 2 && (
                  <div className="space-y-1">
                    {clientSearchQuery.isLoading ? (
                      <p className="text-xs text-muted-foreground">Searching...</p>
                    ) : (clientSearchQuery.data || []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No matching clients.</p>
                    ) : (
                      clientSearchQuery.data.map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => setPickedClient(client)}
                          className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-left text-xs hover:bg-amber-100 ${pickedClient?.id === client.id ? "border-primary bg-amber-100" : "border-amber-200 bg-white/60"}`}
                        >
                          <span>{client.name}</span>
                          <span className="text-muted-foreground">{client.email || client.phone}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
                <UIButton type="button" variant="outline" size="sm" onClick={createAndAttachClient} disabled={creatingClient} className="h-8 rounded-lg text-xs">
                  <UserPlus className="h-3.5 w-3.5" /> {creatingClient ? "Creating..." : `Create new client "${invoice?.customer_name || pickedOrder.client_name || ""}"`}
                </UIButton>
                {pickedClient && (
                  <p className="text-xs font-semibold text-amber-900">Will attach both sides to: {pickedClient.name}</p>
                )}
              </div>
            )}
          </div>
        )}

        <UIDialogFooter>
          <UIButton variant="outline" onClick={close} className="rounded-xl">Cancel</UIButton>
          {pickedOrder && resolution?.mode === "direct" && (
            <UIButton onClick={confirmDirect} disabled={isPending} className="rounded-xl">
              <Link2 className="h-3.5 w-3.5" /> Link order
            </UIButton>
          )}
          {pickedOrder && resolution?.mode === "attach" && (
            <UIButton onClick={confirmAttach} disabled={isPending} className="rounded-xl">
              <Link2 className="h-3.5 w-3.5" /> Attach and link
            </UIButton>
          )}
          {pickedOrder && resolution?.mode === "both_clientless" && (
            <UIButton onClick={confirmAttach} disabled={isPending || !pickedClient} className="rounded-xl">
              <Link2 className="h-3.5 w-3.5" /> Attach and link
            </UIButton>
          )}
        </UIDialogFooter>
      </UIDialogContent>
    </Dialog>
  );
}
