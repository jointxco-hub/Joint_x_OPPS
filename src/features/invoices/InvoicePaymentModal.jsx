import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Paperclip, RefreshCw, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PAYMENT_PROOF_ACCEPT,
  PAYMENT_PROOF_MAX_BYTES,
  cleanupAbandonedPaymentProof,
  getPaymentProofSignedUrl,
  newPaymentOperationKey,
  removeStagedPaymentProof,
  stagePaymentProof,
} from "@/api/invoices";

const METHOD_OPTIONS = [
  { value: "eft", label: "EFT / bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

const OVERPAY_TOLERANCE = 0.02;
const ACCEPT_ATTR = ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf";

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function prettySize(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fileProblem(file) {
  const type = String(file?.type || "").toLowerCase();
  if (!PAYMENT_PROOF_ACCEPT.includes(type)) return "Only JPG, PNG or PDF files can be attached.";
  if (Number(file?.size || 0) > PAYMENT_PROOF_MAX_BYTES) return "File is larger than 15 MB.";
  return null;
}

// One compact modal for every ledger payment entry. `mode`:
//   pay        - settle the outstanding balance (amount defaults to it)
//   partial    - record a smaller amount now (amount starts empty)
//   reconcile  - the invoice already reads paid but the ledger has no
//                record; add the missing row without collecting money again
//
// Attachments: each dropped/picked file is uploaded privately and staged
// via stage_payment_proof under ONE operation key for this attempt. The
// canonical payment RPC links them in the same transaction. On retry the
// same operation key is reused so money is never double-recorded.
export default function InvoicePaymentModal({
  open,
  onOpenChange,
  invoice,
  mode = "pay",
  outstandingBalance = 0,
  recordedPaid = 0,
  isPending = false,
  onSubmit,
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("eft");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(today());
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [attachments, setAttachments] = useState([]); // {localId,name,size,type,status,error,row}
  const [dragActive, setDragActive] = useState(false);

  const operationKeyRef = useRef(null);
  const succeededRef = useRef(false);
  const fileInputRef = useRef(null);
  const seq = useRef(0);

  const balance = Number(outstandingBalance || 0);

  useEffect(() => {
    if (!open) return;
    operationKeyRef.current = newPaymentOperationKey();
    succeededRef.current = false;
    setAmount(mode === "partial" ? "" : balance > 0 ? String(balance.toFixed(2)) : "");
    setMethod("eft");
    setReference("");
    setPaidAt(today());
    setNote(mode === "reconcile" ? "Reconciled from legacy paid status - no new payment collected" : "");
    setSubmitError("");
    setAttachments([]);
    setDragActive(false);
  }, [open, mode, balance]);

  const amountNumber = Number(amount);
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0;
  const overBalance = amountValid && balance > 0 && amountNumber > balance + OVERPAY_TOLERANCE;
  const uploading = attachments.some((a) => a.status === "uploading");
  const failed = attachments.some((a) => a.status === "error");
  // Reference and proof are BOTH optional. Confirm is blocked only by an
  // invalid amount, an in-flight upload, an unresolved failed upload, or a
  // submit already in progress.
  const canSubmit = amountValid && !overBalance && !isPending && !uploading && !failed;

  const title =
    mode === "reconcile" ? "Reconcile recorded payment"
    : mode === "partial" ? "Record a partial payment"
    : "Record payment";
  const description =
    mode === "reconcile"
      ? "This invoice shows as paid but has no entry in the payment ledger. Recording the payment here adds the missing ledger row - it does not collect money again."
      : "This adds one entry to the canonical payment ledger. The customer's invoice view and the OPPS balance update from it.";

  const stageOne = useCallback(async (localId, file) => {
    try {
      const row = await stagePaymentProof({
        invoiceId: invoice.id,
        operationKey: operationKeyRef.current,
        file,
      });
      setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, status: "done", row } : a)));
    } catch (error) {
      setAttachments((prev) =>
        prev.map((a) => (a.localId === localId ? { ...a, status: "error", error: error?.message || "Upload failed" } : a)),
      );
    }
  }, [invoice?.id]);

  const addFiles = useCallback((fileList) => {
    if (!invoice?.id) return;
    const files = Array.from(fileList || []);
    for (const file of files) {
      const localId = `f${++seq.current}`;
      const problem = fileProblem(file);
      if (problem) {
        setAttachments((prev) => [
          ...prev,
          { localId, name: file.name, size: file.size, type: file.type, status: "error", error: problem },
        ]);
        continue;
      }
      setAttachments((prev) => [
        ...prev,
        { localId, name: file.name, size: file.size, type: file.type, status: "uploading" },
      ]);
      void stageOne(localId, file);
    }
  }, [invoice?.id, stageOne]);

  const retryOne = useCallback((localId) => {
    // We no longer hold a failed file's blob — drop the failed entry and
    // reopen the picker so the user re-selects it (creates a fresh upload).
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
    fileInputRef.current?.click();
  }, []);

  const removeOne = useCallback(async (localId) => {
    const target = attachments.find((a) => a.localId === localId);
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
    if (target?.status === "done" && target.row?.id) {
      try { await removeStagedPaymentProof(target.row.id); } catch { /* swept by cleanup */ }
    }
  }, [attachments]);

  const openPreview = useCallback(async (row) => {
    try {
      const url = await getPaymentProofSignedUrl(row);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch { /* ignore */ }
  }, []);

  const cleanupStaged = useCallback(async () => {
    const done = attachments.filter((a) => a.status === "done" && a.row?.id);
    for (const a of done) {
      try { await removeStagedPaymentProof(a.row.id); } catch { /* ignore */ }
    }
    try { await cleanupAbandonedPaymentProof(operationKeyRef.current); } catch { /* ignore */ }
  }, [attachments]);

  const requestClose = useCallback((next) => {
    if (isPending || uploading) return;
    if (!next && !succeededRef.current) void cleanupStaged();
    onOpenChange?.(next);
  }, [isPending, uploading, cleanupStaged, onOpenChange]);

  const submit = async () => {
    if (!canSubmit || !invoice) return;
    setSubmitError("");
    try {
      await onSubmit?.({
        amount: Number(amountNumber.toFixed(2)),
        method,
        reference: reference.trim() || null,
        paidAt,
        note: note.trim() || null,
        operationKey: operationKeyRef.current,
        mode,
      });
      succeededRef.current = true;
      onOpenChange?.(false);
    } catch (error) {
      // Preserve the operation key + staged files so the SAME attempt can be
      // retried without recording a second payment. No auto-retry.
      setSubmitError(error?.message || "Could not record the payment. You can try Confirm again.");
    }
  };

  const balanceAfter = useMemo(() => {
    if (!amountValid) return balance;
    return Math.max(balance - amountNumber, 0);
  }, [amountValid, amountNumber, balance]);

  const stagedCount = attachments.filter((a) => a.status === "done").length;

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl bg-secondary/50 p-3 text-sm text-muted-foreground">
            <div className="flex justify-between"><span>Invoice total</span><span className="tabular-nums">{money(invoice?.total)}</span></div>
            <div className="flex justify-between"><span>Recorded so far</span><span className="tabular-nums">{money(recordedPaid)}</span></div>
            <div className="flex justify-between font-medium text-foreground"><span>Outstanding</span><span className="tabular-nums">{money(balance)}</span></div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="invoice-payment-amount">Amount</Label>
            <Input
              id="invoice-payment-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              className="h-11 rounded-xl"
            />
            {overBalance && (
              <p className="text-sm text-destructive">That is more than the outstanding balance ({money(balance)}).</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="invoice-payment-method">Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="invoice-payment-method" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="invoice-payment-date">Payment date</Label>
            <Input
              id="invoice-payment-date"
              value={paidAt}
              onChange={(event) => setPaidAt(event.target.value)}
              type="date"
              max={today()}
              className="h-11 rounded-xl"
            />
          </div>

          {/* Proof of payment — optional, multi-file */}
          <div className="space-y-1.5">
            <Label>Proof of payment <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { e.preventDefault(); setDragActive(false); addFiles(e.dataTransfer?.files); }}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center text-sm transition-colors ${
                dragActive ? "border-primary bg-primary/5" : "border-border bg-secondary/30"
              }`}
            >
              <Paperclip className="h-4 w-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                Drop a bank slip / screenshot here, or{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  choose files
                </button>
              </p>
              <p className="text-xs text-muted-foreground">JPG, PNG or PDF · up to 15 MB each</p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_ATTR}
                multiple
                className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
              />
            </div>

            {attachments.length > 0 && (
              <ul className="space-y-1.5">
                {attachments.map((a) => (
                  <li
                    key={a.localId}
                    className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  >
                    {String(a.type).includes("pdf")
                      ? <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      : <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{prettySize(a.size)}</span>
                    {a.status === "uploading" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
                    {a.status === "done" && (
                      <button
                        type="button"
                        className="shrink-0 text-xs font-medium text-primary underline underline-offset-2"
                        onClick={() => openPreview(a.row)}
                      >
                        Open
                      </button>
                    )}
                    {a.status === "error" && (
                      <>
                        <span className="shrink-0 text-xs text-destructive">{a.error || "Failed"}</span>
                        <button
                          type="button"
                          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
                          title="Choose the file again"
                          onClick={() => retryOne(a.localId)}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-destructive"
                      title="Remove"
                      onClick={() => removeOne(a.localId)}
                      disabled={a.status === "uploading"}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {failed && (
              <p className="text-xs text-destructive">Remove or re-add the failed file before confirming.</p>
            )}
            {uploading && (
              <p className="text-xs text-muted-foreground">Waiting for uploads to finish…</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="invoice-payment-reference">Bank / receipt reference <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input
              id="invoice-payment-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="e.g. FNB ref 4821 — leave blank if none"
              className="h-11 rounded-xl"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="invoice-payment-note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="invoice-payment-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Anything the finance team should see against this payment"
              className="min-h-16 rounded-xl"
            />
          </div>

          <div className="rounded-xl bg-secondary/50 p-3 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>Balance after this payment</span>
              <span className="tabular-nums text-foreground">{money(balanceAfter)}</span>
            </div>
            {stagedCount > 0 && (
              <div className="mt-1 flex justify-between">
                <span>Proof to attach</span>
                <span className="text-foreground">{stagedCount} file{stagedCount === 1 ? "" : "s"}</span>
              </div>
            )}
          </div>

          {submitError && <p className="text-sm text-destructive">{submitError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => requestClose(false)} disabled={isPending || uploading} className="rounded-xl">
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="rounded-xl">
            {isPending ? "Recording..." : uploading ? "Uploading…" : "Confirm payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
