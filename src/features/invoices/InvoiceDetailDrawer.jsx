import { useState } from "react";
import { Ban, Copy, CreditCard, Download, ExternalLink, CheckCircle2, Pencil, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import InvoiceStatusBadge from "./InvoiceStatusBadge";
import { buildZohoInvoiceCsv, getZohoInvoiceExportFileName } from "./zohoInvoiceCsv";
import { getInvoiceDisplayStates } from "./invoiceDisplayStatus";

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function downloadTextFile(fileName, contents) {
  const blob = new Blob(["\uFEFF", contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function openClientInvoice(invoice, print = false) {
  if (!invoice?.id) return;
  const url = `/ClientInvoicePrint?invoice=${encodeURIComponent(invoice.id)}${print ? "&print=1" : ""}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function InvoiceDetailDrawer({
  invoice,
  open,
  isLoading,
  onOpenChange,
  onApprove,
  onEditDraft,
  onMarkExported,
  onMarkImported,
  onMarkPaid,
  onMarkPartiallyPaid,
  onMarkVoid,
  onDuplicateDraft,
}) {
  const [partialPaymentOpen, setPartialPaymentOpen] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");
  const [partialNote, setPartialNote] = useState("");
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  const displayStates = getInvoiceDisplayStates(invoice);
  const isDraft = invoice?.status === "draft";
  const canTakePayment = invoice && !["draft", "paid", "void"].includes(invoice.status);
  const partialAmountNumber = Number(partialAmount);
  const partialAmountInvalid = !Number.isFinite(partialAmountNumber)
    || partialAmountNumber < 0
    || partialAmountNumber > Number(invoice?.total || 0);

  const exportSingle = async () => {
    if (!invoice) return;
    const result = buildZohoInvoiceCsv([invoice], { includeAlreadyExported: true });
    downloadTextFile(getZohoInvoiceExportFileName(), result.csv);
    if (invoice.status === "approved") {
      await onMarkExported?.(invoice, result);
    }
  };

  const openPartialPayment = () => {
    setPartialAmount(invoice?.amount_paid ? String(invoice.amount_paid) : "");
    setPartialNote("");
    setPartialPaymentOpen(true);
  };

  const submitPartialPayment = () => {
    if (!invoice || partialAmountInvalid) return;
    onMarkPartiallyPaid?.(invoice, partialAmountNumber, partialNote);
    setPartialPaymentOpen(false);
  };

  return (
    <>
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-h-[92vh] max-w-4xl rounded-t-3xl">
        <DrawerHeader className="border-b border-border text-left">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DrawerTitle>{invoice?.invoice_number || "Invoice"}</DrawerTitle>
              <DrawerDescription>{invoice?.customer_name || "Loading invoice..."}</DrawerDescription>
            </div>
            {invoice?.status && <InvoiceStatusBadge status={invoice.status} />}
          </div>
        </DrawerHeader>

        <div className="overflow-y-auto px-4 py-5 md:px-6">
          {isLoading ? (
            <div className="rounded-2xl border border-border bg-secondary/30 p-6 text-sm text-muted-foreground">Loading invoice details...</div>
          ) : invoice ? (
            <div className="space-y-5">
              {invoice.status === "exported" || invoice.status === "imported_to_zoho" ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  This invoice was already exported. Re-export only if you need to upload again or fix a mapping issue.
                </div>
              ) : null}
              {!isDraft && (
                <div className="rounded-2xl border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
                  This invoice is locked because it has already moved beyond draft.
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Info label="Payment state" value={displayStates.payment.label} />
                <Info label="Zoho workflow" value={displayStates.zoho.label} />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <Info label="Customer email" value={invoice.customer_email || "Missing"} />
                <Info label="Invoice date" value={String(invoice.invoice_date || "").slice(0, 10)} />
                <Info label="Due date" value={invoice.due_date ? String(invoice.due_date).slice(0, 10) : "Missing"} />
              </div>

              {invoice.source_order_id && (
                <div className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source order</p>
                  <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <ExternalLink className="h-4 w-4 text-muted-foreground" /> {invoice.source_order_id}
                  </p>
                </div>
              )}

              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">Line items</p>
                </div>
                <div className="divide-y divide-border">
                  {items.map((item) => (
                    <div key={item.id || item.line_number} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1fr_80px_100px_100px]">
                      <div>
                        <p className="font-semibold text-foreground">{item.item_name}</p>
                        {item.item_description && <p className="mt-1 text-xs text-muted-foreground">{item.item_description}</p>}
                      </div>
                      <p className="text-muted-foreground">Qty {item.quantity}</p>
                      <p className="text-muted-foreground">{money(item.rate)}</p>
                      <p className="font-semibold text-foreground">{money(item.item_total)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[1fr_280px]">
                <div className="space-y-3">
                  <Info label="Notes" value={invoice.notes || "No notes"} />
                  <Info label="Terms" value={invoice.terms || "No terms"} />
                </div>
                <div className="rounded-2xl border border-border bg-secondary/30 p-4">
                  {[
                    ["Subtotal", invoice.subtotal],
                    ["Discount", -Number(invoice.discount_total || 0)],
                    ["Shipping", invoice.shipping_charge],
                    ["Adjustment", invoice.adjustment],
                    ["Tax", invoice.tax_total],
                    ["Total", invoice.total],
                    ["Paid", invoice.amount_paid],
                    ["Balance due", invoice.balance_due],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className="text-sm font-semibold text-foreground">{money(value)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap">
                {isDraft && (
                  <>
                    <Button variant="outline" onClick={() => onEditDraft?.(invoice)} className="rounded-xl">
                      <Pencil className="h-4 w-4" /> Edit draft
                    </Button>
                    <Button onClick={() => onApprove?.(invoice)} className="rounded-xl">
                      <CheckCircle2 className="h-4 w-4" /> Approve invoice
                    </Button>
                  </>
                )}
                {!isDraft && (
                  <Button variant="outline" onClick={() => onDuplicateDraft?.(invoice)} className="rounded-xl">
                    <Copy className="h-4 w-4" /> Duplicate as new draft
                  </Button>
                )}
                <Button variant="outline" onClick={() => openClientInvoice(invoice)} className="rounded-xl">
                  <Download className="h-4 w-4" /> Download client invoice PDF
                </Button>
                <Button variant="outline" onClick={() => openClientInvoice(invoice, true)} className="rounded-xl">
                  <Printer className="h-4 w-4" /> Print client invoice
                </Button>
                {["approved", "exported", "imported_to_zoho"].includes(invoice.status) && (
                  <Button variant="outline" onClick={exportSingle} className="rounded-xl">
                    <Download className="h-4 w-4" /> {invoice.status === "approved" ? "Export CSV" : "Re-export CSV"}
                  </Button>
                )}
                {invoice.status === "exported" && (
                  <Button onClick={() => onMarkImported?.(invoice)} className="rounded-xl">
                    <CheckCircle2 className="h-4 w-4" /> Mark imported to Zoho
                  </Button>
                )}
                {canTakePayment && (
                  <>
                    <Button variant="outline" onClick={openPartialPayment} className="rounded-xl">
                      <CreditCard className="h-4 w-4" /> Mark partially paid
                    </Button>
                    <Button onClick={() => onMarkPaid?.(invoice)} className="rounded-xl">
                      <CheckCircle2 className="h-4 w-4" /> Mark paid
                    </Button>
                  </>
                )}
                {!["paid", "void"].includes(invoice.status) && (
                  <Button variant="outline" onClick={() => setVoidConfirmOpen(true)} className="rounded-xl text-destructive hover:text-destructive">
                    <Ban className="h-4 w-4" /> Mark void
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
    <Dialog open={partialPaymentOpen} onOpenChange={setPartialPaymentOpen}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Mark partially paid</DialogTitle>
          <DialogDescription>Record the total amount paid so far. This updates OPPS only.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={partialAmount}
            onChange={(event) => setPartialAmount(event.target.value)}
            type="number"
            min="0"
            max={invoice?.total || 0}
            step="0.01"
            placeholder="Amount paid"
            className="h-11 rounded-xl"
          />
          {partialAmountNumber > Number(invoice?.total || 0) && (
            <p className="text-sm text-destructive">Amount paid cannot be greater than the invoice total.</p>
          )}
          <Textarea
            value={partialNote}
            onChange={(event) => setPartialNote(event.target.value)}
            placeholder="Optional note"
            className="min-h-20 rounded-xl"
          />
          <div className="rounded-xl bg-secondary/50 p-3 text-sm text-muted-foreground">
            Balance after payment: {money(Math.max(Number(invoice?.total || 0) - (Number.isFinite(partialAmountNumber) ? partialAmountNumber : 0), 0))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPartialPaymentOpen(false)} className="rounded-xl">Cancel</Button>
          <Button onClick={submitPartialPayment} disabled={partialAmountInvalid} className="rounded-xl">Save payment status</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog
      open={voidConfirmOpen}
      onOpenChange={setVoidConfirmOpen}
      title="Void invoice?"
      description="This keeps the invoice record but removes it from normal payment and export work."
      confirmText="Mark void"
      variant="destructive"
      onConfirm={() => {
        if (invoice) onMarkVoid?.(invoice);
        setVoidConfirmOpen(false);
      }}
    />
    </>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 break-words text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
