import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, Clock3, Copy, CreditCard, Download, CheckCircle2, MoreHorizontal, Pencil, Printer, RefreshCw, RotateCcw, RotateCw, Share2, Unlink } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import InvoiceStatusBadge from "./InvoiceStatusBadge";
import OrderLinkPanel from "./OrderLinkPanel";
import { buildZohoInvoiceCsv, getZohoInvoiceExportFileName } from "./zohoInvoiceCsv";
import { getInvoiceDisplayStates } from "./invoiceDisplayStatus";
import { printIminReceipt } from "@/lib/pos/iminPrinter";
import { getClientContactSnapshot, clientToInvoiceContactFields, buildPublicInvoiceUrl } from "@/api/invoices";
import { getCourierRequirementGap } from "@/lib/shippingRequirements";
import { toast } from "sonner";

// An issued share is "active" only while it is currently resolvable by the
// public route — matches get_public_invoice()'s own checks (P3) so the
// staff UI never offers to "copy" a link that would actually 404 for the
// client: public_visible, not revoked, not expired.
function hasActiveShare(invoice) {
  if (!invoice?.share_token || invoice.public_visible !== true || invoice.share_revoked_at) return false;
  if (invoice.share_expires_at && new Date(invoice.share_expires_at).getTime() < Date.now()) return false;
  return true;
}

const CONTACT_FIELD_LABELS = {
  contact_person: "Contact person",
  customer_phone: "Phone",
  customer_email: "Email",
  customer_billing_address: "Billing address",
  shipping_address: "Shipping address",
  shipping_courier: "Courier",
  shipping_courier_code: "Courier / PAXI code",
  delivery_instructions: "Delivery instructions",
  fulfillment_type: "Fulfillment type",
};

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

const REOPEN_REASON_PRESETS = [
  { value: "quantity_correction", label: "Quantity correction" },
  { value: "pricing_correction", label: "Pricing correction" },
  { value: "client_amendment", label: "Client amendment" },
  { value: "incorrect_item", label: "Incorrect item" },
  { value: "staff_entry_error", label: "Staff entry error" },
  { value: "other", label: "Other" },
];

export default function InvoiceDetailDrawer({
  invoice,
  summaryInvoice,
  activity = [],
  duplicateInvoices = [],
  isActivityLoading = false,
  open,
  isLoading,
  loadError,
  onOpenChange,
  onRetry,
  onApprove,
  onEditDraft,
  onMarkExported,
  onMarkImported,
  onMarkPaid,
  onMarkPartiallyPaid,
  onMarkVoid,
  onVoidDuplicate,
  onDuplicateDraft,
  onLinkOrder,
  onUnlinkOrder,
  onSyncFromOrder,
  onSyncFromInvoice,
  isOrderLinkPending,
  canReopen = false,
  onReopen,
  isReopenPending = false,
  onRefreshContact,
  isRefreshContactPending = false,
  onIssueShare,
  isIssueSharePending = false,
  onRevokeShare,
  isRevokeSharePending = false,
  onRotateShare,
  isRotateSharePending = false,
}) {
  const [partialPaymentOpen, setPartialPaymentOpen] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");
  const [partialNote, setPartialNote] = useState("");
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);
  const [revokeShareConfirmOpen, setRevokeShareConfirmOpen] = useState(false);
  const [duplicateToVoid, setDuplicateToVoid] = useState(null);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [unlinkedApproveWarningOpen, setUnlinkedApproveWarningOpen] = useState(false);
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false);
  const [reopenReasonPreset, setReopenReasonPreset] = useState("quantity_correction");
  const [reopenReasonDetail, setReopenReasonDetail] = useState("");
  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);

  const clientSnapshotQuery = useQuery({
    queryKey: ["clientContactSnapshot", invoice?.customer_id],
    queryFn: () => getClientContactSnapshot(invoice.customer_id),
    enabled: refreshDialogOpen && Boolean(invoice?.customer_id),
  });

  const contactDiff = (() => {
    if (!clientSnapshotQuery.data || !invoice) return [];
    const proposed = clientToInvoiceContactFields(clientSnapshotQuery.data);
    return Object.keys(CONTACT_FIELD_LABELS)
      .map((key) => ({ key, label: CONTACT_FIELD_LABELS[key], from: invoice[key] || "", to: proposed[key] || "" }))
      .filter((row) => row.from !== row.to);
  })();

  const shippingGapReason = invoice
    ? getCourierRequirementGap({
        fulfillmentType: invoice.fulfillment_type,
        courier: invoice.shipping_courier,
        courierCode: invoice.shipping_courier_code,
      })
    : null;
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  const activeDuplicates = duplicateInvoices.filter((item) => item.status !== "void");
  const displayStates = getInvoiceDisplayStates(invoice);
  const isDraft = invoice?.status === "draft";
  const canTakePayment = invoice && !["draft", "paid", "void"].includes(invoice.status);
  // Eligible to issue a public link at all: matches issue_invoice()'s own
  // guard (void refused) plus a client-side rule the RPC doesn't enforce —
  // a draft invoice technically CAN be issued (the RPC auto-approves it as
  // a side effect), but this UI keeps that a distinct, deliberate action
  // (Approve) rather than something a share click does silently.
  const shareEligible = Boolean(invoice) && !isDraft && invoice.status !== "void";
  const shareActive = hasActiveShare(invoice);
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

  // Standalone invoices remain valid - this never forces every invoice to
  // have an order. It only warns because approving first makes linking
  // harder later (the item-resync-on-link path is draft-only), so staff
  // who intend to link should know before they lock themselves out of the
  // easy path. "Approve anyway" always remains one click away.
  const handleApproveClick = () => {
    if (invoice && !invoice.source_order_id) {
      setUnlinkedApproveWarningOpen(true);
      return;
    }
    onApprove?.(invoice);
  };

  const openReopenDialog = () => {
    setReopenReasonPreset("quantity_correction");
    setReopenReasonDetail("");
    setReopenDialogOpen(true);
  };

  const reopenReasonInvalid = reopenReasonPreset === "other" && !reopenReasonDetail.trim();

  const submitReopen = () => {
    if (!invoice || reopenReasonInvalid) return;
    const presetLabel = REOPEN_REASON_PRESETS.find((option) => option.value === reopenReasonPreset)?.label || reopenReasonPreset;
    const reason = reopenReasonDetail.trim() ? `${presetLabel}: ${reopenReasonDetail.trim()}` : presetLabel;
    onReopen?.(invoice, reason);
    setReopenDialogOpen(false);
  };

  const copyPublicLink = async () => {
    if (!invoice?.share_token) return;
    const url = buildPublicInvoiceUrl(invoice.share_token);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Public invoice link copied");
    } catch {
      toast.error("Couldn't copy the link — copy it from " + url + " instead.");
    }
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
          ) : loadError ? (
            <InvoiceLoadFailure
              summary={summaryInvoice}
              onRetry={onRetry}
              onClose={() => onOpenChange?.(false)}
            />
          ) : invoice ? (
            <div className="space-y-3 md:space-y-5">
              {invoice.status === "exported" || invoice.status === "imported_to_zoho" ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  This invoice was already exported. Re-export only if you need to upload again or fix a mapping issue.
                </div>
              ) : null}

              {shippingGapReason && (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                  <div>
                    <p className="font-semibold">Delivery details incomplete</p>
                    <p className="mt-0.5 text-amber-800">{shippingGapReason}. Collection or service-only invoices don't need this.</p>
                    <button
                      type="button"
                      onClick={() => setRefreshDialogOpen(true)}
                      className="mt-1.5 text-xs font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
                    >
                      Update client delivery details
                    </button>
                  </div>
                </div>
              )}
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
                </div>
              </div>

              <OrderLinkPanel
                invoice={invoice}
                isDraft={isDraft}
                isPending={isOrderLinkPending}
                onLink={(order) => onLinkOrder?.(invoice, order)}
                onUnlink={() => onUnlinkOrder?.(invoice)}
                onSync={(order) => onSyncFromOrder?.(invoice, order)}
                onSyncFromInvoice={(order, sourceInvoice, options) => onSyncFromInvoice?.(order, sourceInvoice, options)}
              />

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
                      <Button size="sm" onClick={handleApproveClick} className="h-9 rounded-xl text-xs sm:text-sm">
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
                    {shareEligible && !shareActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onIssueShare?.(invoice)}
                        disabled={isIssueSharePending}
                        className="h-11 rounded-xl text-xs sm:h-8"
                      >
                        <Share2 className="h-3.5 w-3.5" /> {isIssueSharePending ? "Creating link..." : "Share invoice"}
                      </Button>
                    )}
                    {shareActive && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={copyPublicLink}
                          className="h-11 rounded-xl text-xs sm:h-8"
                        >
                          <Copy className="h-3.5 w-3.5" /> Copy public link
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onRotateShare?.(invoice)}
                          disabled={isRotateSharePending}
                          className="h-11 rounded-xl text-xs sm:h-8"
                        >
                          <RotateCw className="h-3.5 w-3.5" /> {isRotateSharePending ? "Rotating..." : "Rotate link"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRevokeShareConfirmOpen(true)}
                          disabled={isRevokeSharePending}
                          className="h-11 rounded-xl text-xs text-destructive hover:text-destructive sm:h-8"
                        >
                          <Unlink className="h-3.5 w-3.5" /> Revoke link
                        </Button>
                      </>
                    )}
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
                    {canReopen && !['draft', 'paid', 'void'].includes(invoice.status) && (
                      <Button variant="outline" size="sm" onClick={openReopenDialog} className="h-8 rounded-xl text-xs">
                        <RotateCcw className="h-3.5 w-3.5" /> Reopen
                      </Button>
                    )}
                    {invoice.customer_id && (
                      <Button variant="outline" size="sm" onClick={() => setRefreshDialogOpen(true)} className="h-8 rounded-xl text-xs">
                        <RefreshCw className="h-3.5 w-3.5" /> Refresh from client
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
    <Dialog open={unlinkedApproveWarningOpen} onOpenChange={setUnlinkedApproveWarningOpen}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>This invoice is not linked to an order</DialogTitle>
          <DialogDescription>
            Standalone invoices are fine - this is just a heads-up that linking an order becomes more involved once an
            invoice is approved. You can still link one later if you need to.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => setUnlinkedApproveWarningOpen(false)}
          >
            Link order first
          </Button>
          <Button
            className="rounded-xl"
            onClick={() => {
              setUnlinkedApproveWarningOpen(false);
              onApprove?.(invoice);
            }}
          >
            Approve anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={reopenDialogOpen} onOpenChange={setReopenDialogOpen}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Reopen invoice for correction</DialogTitle>
          <DialogDescription>
            You are reopening an approved invoice. This allows financial details to be changed and will be recorded
            in invoice history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={reopenReasonPreset} onValueChange={setReopenReasonPreset}>
            <SelectTrigger className="h-11 rounded-xl">
              <SelectValue placeholder="Select a reason" />
            </SelectTrigger>
            <SelectContent>
              {REOPEN_REASON_PRESETS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={reopenReasonDetail}
            onChange={(event) => setReopenReasonDetail(event.target.value)}
            placeholder={reopenReasonPreset === "other" ? "Describe the reason for reopening" : "Optional additional detail"}
            className="min-h-20 rounded-xl"
          />
          {reopenReasonInvalid && (
            <p className="text-sm text-destructive">Please describe the reason for reopening.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setReopenDialogOpen(false)} className="rounded-xl">Cancel</Button>
          <Button onClick={submitReopen} disabled={reopenReasonInvalid || isReopenPending} className="rounded-xl">
            {isReopenPending ? "Reopening..." : "Reopen invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={refreshDialogOpen} onOpenChange={setRefreshDialogOpen}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Refresh from client profile</DialogTitle>
          <DialogDescription>
            Only contact and shipping details change. Line items, prices, totals, payments, and approval status are
            never touched.
          </DialogDescription>
        </DialogHeader>
        {clientSnapshotQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading client profile...</p>
        ) : contactDiff.length === 0 ? (
          <p className="text-sm text-muted-foreground">This invoice already matches the client's current profile.</p>
        ) : (
          <div className="space-y-2">
            {contactDiff.map((row) => (
              <div key={row.key} className="rounded-xl border border-border p-3 text-sm">
                <p className="font-semibold text-foreground">{row.label}</p>
                <p className="mt-1 text-muted-foreground">
                  <span className="line-through">{row.from || "(empty)"}</span>
                  {" "}&rarr;{" "}
                  <span className="text-foreground">{row.to || "(empty)"}</span>
                </p>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setRefreshDialogOpen(false)} className="rounded-xl">Cancel</Button>
          <Button
            onClick={() => {
              const fields = clientToInvoiceContactFields(clientSnapshotQuery.data);
              onRefreshContact?.(invoice, fields);
              setRefreshDialogOpen(false);
            }}
            disabled={contactDiff.length === 0 || isRefreshContactPending}
            className="rounded-xl"
          >
            {isRefreshContactPending ? "Refreshing..." : "Apply refresh"}
          </Button>
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
      open={revokeShareConfirmOpen}
      onOpenChange={setRevokeShareConfirmOpen}
      title="Revoke public link?"
      description="The current link stops working immediately for the client. You can issue a new one later."
      confirmText="Revoke link"
      variant="destructive"
      onConfirm={() => {
        if (invoice) onRevokeShare?.(invoice);
        setRevokeShareConfirmOpen(false);
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

function InvoiceLoadFailure({ summary, onRetry, onClose }) {
  const [showSummary, setShowSummary] = useState(false);
  const reference = summary?.id ? String(summary.id).slice(-8) : "unavailable";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <p className="flex items-center gap-2 font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4 text-destructive" /> Invoice details could not be loaded
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Invoice details could not be loaded. Saving has been disabled to protect the existing invoice.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Error reference: INVOICE_DETAIL_LOAD_FAILED-{reference}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={onRetry} className="rounded-xl">Retry</Button>
          <Button type="button" variant="outline" onClick={() => setShowSummary((value) => !value)} className="rounded-xl">
            {showSummary ? "Hide read-only summary" : "Open read-only summary"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} className="rounded-xl">Close</Button>
        </div>
      </div>

      {showSummary && (
        <div className="rounded-2xl border border-border bg-card p-4" aria-label="Read-only invoice summary">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Read-only summary</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Info label="Invoice" value={summary?.invoice_number || "Unavailable"} />
            <Info label="Customer" value={summary?.customer_name || "Unavailable"} />
            <Info label="Status" value={summary?.status || "Unavailable"} />
            <Info label="Total" value={summary?.total != null ? money(summary.total) : "Unavailable"} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Line items and edit actions are intentionally unavailable until Retry succeeds.</p>
        </div>
      )}
    </div>
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
