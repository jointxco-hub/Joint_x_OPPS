import { useState } from "react";
import { AlertTriangle, Ban, Clock3, Copy, CreditCard, Download, CheckCircle2, MoreHorizontal, Pencil, Printer } from "lucide-react";
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
import { printIminReceipt } from "@/lib/pos/iminPrinter";
import { toast } from "sonner";

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
  const url = new URL("/ClientInvoicePrint", window.location.origin);
  url.searchParams.set("invoice", invoice.id);
  if (print) url.searchParams.set("print", "1");
  window.location.assign(url.toString());
}

export default function InvoiceDetailDrawer({
  invoice,
  activity = [],
  duplicateInvoices = [],
  isActivityLoading = false,
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
  onVoidDuplicate,
  onDuplicateDraft,
}) {
  const [partialPaymentOpen, setPartialPaymentOpen] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");
  const [partialNote, setPartialNote] = useState("");
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);
  const [duplicateToVoid, setDuplicateToVoid] = useState(null);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  const activeDuplicates = duplicateInvoices.filter((item) => item.status !== "void");
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

  const printPosInvoiceSummary = async () => {
    const result = await printIminReceipt(buildInvoiceThermalPayload(invoice));
    if (result.ok) {
      toast.success(`Printed POS receipt via ${result.bridgeName || "iMin printer"}`);
      return;
    }

    toast.info("iMin printer not detected. Opening browser invoice print instead.");
    openClientInvoice(invoice, true);
  };

  return (
    <>
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-h-[92vh] max-w-4xl rounded-t-2xl md:rounded-t-3xl">
        <DrawerHeader className="border-b border-border px-4 py-3 text-left md:px-6 md:py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DrawerTitle>{invoice?.invoice_number || "Invoice"}</DrawerTitle>
              <DrawerDescription>{invoice?.customer_name || "Loading invoice..."}</DrawerDescription>
            </div>
            {invoice?.status && <InvoiceStatusBadge status={invoice.status} />}
          </div>
        </DrawerHeader>

        <div className="overflow-y-auto px-3 py-4 md:px-6 md:py-5">
          {isLoading ? (
            <div className="rounded-2xl border border-border bg-secondary/30 p-6 text-sm text-muted-foreground">Loading invoice details...</div>
          ) : invoice ? (
            <div className="space-y-3 md:space-y-5">
              {invoice.status === "exported" || invoice.status === "imported_to_zoho" ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  This invoice was already exported. Re-export only if you need to upload again or fix a mapping issue.
                </div>
              ) : null}
              {!isDraft && (
                <div className="rounded-xl border border-border bg-secondary/30 p-3 text-sm text-muted-foreground md:p-4">
                  This invoice is locked because it has already moved beyond draft.
                </div>
              )}

              {activeDuplicates.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <p className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4" /> Possible duplicate invoice for this order
                  </p>
                  <p className="mt-1 text-amber-800">Choose which invoice to keep. OPPS will not auto-void duplicates.</p>
                  <div className="mt-3 space-y-2">
                    {activeDuplicates.map((duplicate) => (
                      <div key={duplicate.id} className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-white/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-semibold text-foreground">{duplicate.invoice_number}</p>
                          <p className="text-xs text-muted-foreground">{duplicate.status} / {money(duplicate.total)}</p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDuplicateToVoid(duplicate)}
                          className="h-8 rounded-xl text-destructive hover:text-destructive"
                        >
                          <Ban className="h-3.5 w-3.5" /> Void this duplicate
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-border bg-card px-3 py-2.5 md:px-4">
                <div className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 md:grid-cols-3">
                  <DetailRow label="Payment" value={displayStates.payment.label} />
                  <DetailRow label="Zoho" value={displayStates.zoho.label} />
                  <DetailRow label="Email" value={invoice.customer_email || "Missing"} />
                  <DetailRow label="Invoice date" value={String(invoice.invoice_date || "").slice(0, 10)} />
                  <DetailRow label="Due date" value={invoice.due_date ? String(invoice.due_date).slice(0, 10) : "Missing"} />
                  {invoice.source_order_id && <DetailRow label="Source" value={invoice.source_order_id} compact />}
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="border-b border-border px-3 py-2.5 md:px-4 md:py-3">
                  <p className="text-sm font-semibold text-foreground">Line items</p>
                </div>
                <div className="divide-y divide-border">
                  {items.map((item) => (
                    <div key={item.id || item.line_number} className="grid gap-1.5 px-3 py-2.5 text-sm md:grid-cols-[1fr_80px_100px_100px] md:px-4 md:py-3">
                      <div>
                        <p className="font-semibold text-foreground">{item.item_name}</p>
                        {item.item_description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.item_description}</p>}
                      </div>
                      <p className="text-muted-foreground">Qty {item.quantity}</p>
                      <p className="text-muted-foreground">{money(item.rate)}</p>
                      <p className="font-semibold text-foreground">{money(item.item_total)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_280px]">
                <details className="rounded-xl border border-border bg-card p-3 text-sm">
                  <summary className="cursor-pointer font-semibold text-foreground">Notes and terms</summary>
                  <div className="mt-3 space-y-3 text-muted-foreground">
                    <p>{invoice.notes || "No notes"}</p>
                    <p>{invoice.terms || "No terms"}</p>
                  </div>
                </details>
                <div className="rounded-xl border border-border bg-secondary/30 p-3 md:p-4">
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

              <ActivitySection activity={activity} isLoading={isActivityLoading} />
              <div className="sticky bottom-0 -mx-3 border-t border-border bg-background/95 px-3 py-2.5 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pt-4">
                <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                  {isDraft ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => onEditDraft?.(invoice)} className="h-9 rounded-xl text-xs sm:text-sm">
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button size="sm" onClick={() => onApprove?.(invoice)} className="h-9 rounded-xl text-xs sm:text-sm">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => onDuplicateDraft?.(invoice)} className="h-9 rounded-xl text-xs sm:text-sm">
                      <Copy className="h-3.5 w-3.5" /> Duplicate
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => openClientInvoice(invoice)} className="h-9 rounded-xl text-xs sm:text-sm">
                    <Download className="h-3.5 w-3.5" /> Open
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowMoreActions((value) => !value)} className="h-9 rounded-xl text-xs sm:text-sm">
                    <MoreHorizontal className="h-3.5 w-3.5" /> More
                  </Button>
                  {canTakePayment && (
                    <Button size="sm" onClick={() => onMarkPaid?.(invoice)} className="col-span-3 h-9 rounded-xl text-xs sm:col-span-1 sm:text-sm">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Mark paid
                    </Button>
                  )}
                </div>
                {showMoreActions && (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    <Button variant="outline" size="sm" onClick={() => openClientInvoice(invoice, true)} className="h-8 rounded-xl text-xs">
                      <Printer className="h-3.5 w-3.5" /> Client print
                    </Button>
                    <Button variant="outline" size="sm" onClick={printPosInvoiceSummary} className="h-8 rounded-xl text-xs">
                      <Printer className="h-3.5 w-3.5" /> POS print
                    </Button>
                    {["approved", "exported", "imported_to_zoho"].includes(invoice.status) && (
                      <Button variant="outline" size="sm" onClick={exportSingle} className="h-8 rounded-xl text-xs">
                        <Download className="h-3.5 w-3.5" /> {invoice.status === "approved" ? "Export" : "Re-export"}
                      </Button>
                    )}
                    {invoice.status === "exported" && (
                      <Button size="sm" onClick={() => onMarkImported?.(invoice)} className="h-8 rounded-xl text-xs">
                        Imported
                      </Button>
                    )}
                    {canTakePayment && (
                      <Button variant="outline" size="sm" onClick={openPartialPayment} className="h-8 rounded-xl text-xs">
                        <CreditCard className="h-3.5 w-3.5" /> Partial
                      </Button>
                    )}
                    {!['paid', 'void'].includes(invoice.status) && (
                      <Button variant="outline" size="sm" onClick={() => setVoidConfirmOpen(true)} className="h-8 rounded-xl text-xs text-destructive hover:text-destructive">
                        <Ban className="h-3.5 w-3.5" /> Void
                      </Button>
                    )}
                  </div>
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
    <ConfirmDialog
      open={Boolean(duplicateToVoid)}
      onOpenChange={(open) => {
        if (!open) setDuplicateToVoid(null);
      }}
      title="Void duplicate invoice?"
      description={`This keeps ${duplicateToVoid?.invoice_number || "the invoice"} in history but removes it from normal payment and export work.`}
      confirmText="Void duplicate"
      variant="destructive"
      onConfirm={() => {
        if (duplicateToVoid) onVoidDuplicate?.(duplicateToVoid);
        setDuplicateToVoid(null);
      }}
    />
    </>
  );
}

function DetailRow({ label, value, compact = false }) {
  return (
    <div className={compact ? "min-w-0 sm:col-span-2 md:col-span-1" : "min-w-0"}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 md:p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}


function buildInvoiceThermalPayload(invoice) {
  const items = Array.isArray(invoice?.items) ? invoice.items : [];

  return {
    type: "invoice_summary",
    storeName: "Joint X OPPS",
    invoiceNumber: invoice?.invoice_number,
    orderNumber: invoice?.source_order_id,
    customerName: invoice?.customer_name,
    dateTime: invoice?.invoice_date ? String(invoice.invoice_date).slice(0, 10) : new Date().toLocaleString(),
    status: invoice?.status,
    lineItems: items.map((item) => ({
      qty: item.quantity,
      itemName: item.item_name || item.item_description || "Invoice item",
      notes: item.item_description,
    })),
    totals: [
      { label: "Subtotal", value: money(invoice?.subtotal) },
      invoice?.shipping_charge ? { label: "Shipping", value: money(invoice.shipping_charge) } : null,
      { label: "Total", value: money(invoice?.total) },
      invoice?.amount_paid ? { label: "Paid", value: money(invoice.amount_paid) } : null,
      invoice?.balance_due !== undefined && invoice?.balance_due !== null ? { label: "Balance", value: money(invoice.balance_due) } : null,
    ].filter(Boolean),
    footer: "Printed from OPPS",
  };
}
function ActivitySection({ activity, isLoading }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-3 py-2.5 md:px-4 md:py-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Clock3 className="h-4 w-4 text-muted-foreground" /> Activity
        </p>
      </div>
      <div className="divide-y divide-border">
        {isLoading ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Loading activity...</p>
        ) : activity.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          activity.map((entry) => (
            <div key={entry.id} className="px-3 py-2.5 text-sm md:px-4 md:py-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-semibold text-foreground">{entry.activity_label}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(entry.created_at)}</p>
              </div>
              {(entry.from_status || entry.to_status) && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {[entry.from_status, entry.to_status].filter(Boolean).join(" -> ")}
                </p>
              )}
              {entry.activity_note && <p className="mt-1 break-words text-xs text-muted-foreground">{entry.activity_note}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
