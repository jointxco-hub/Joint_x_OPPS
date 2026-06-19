import { useState } from "react";
import { AlertTriangle, Ban, Clock3, Copy, CreditCard, Download, ExternalLink, CheckCircle2, Pencil, Printer } from "lucide-react";
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

              <ActivitySection activity={activity} isLoading={isActivityLoading} />

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
                  <Download className="h-4 w-4" /> Open client invoice
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

function Info({ label, value }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 break-words text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function ActivitySection({ activity, isLoading }) {
  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
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
            <div key={entry.id} className="px-4 py-3 text-sm">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-semibold text-foreground">{entry.activity_label}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(entry.created_at)}</p>
              </div>
              {(entry.from_status || entry.to_status) && (
                <p className="mt-1 text-xs text-muted-foreground">
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
