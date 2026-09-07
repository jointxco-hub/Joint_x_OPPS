import { useEffect, useMemo, useState } from "react";
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

const METHOD_OPTIONS = [
  { value: "eft", label: "EFT / bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

const OVERPAY_TOLERANCE = 0.02;

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// One compact modal for every ledger payment entry. `mode`:
//   pay        - settle the outstanding balance (amount defaults to it)
//   partial    - record a smaller amount now (amount starts empty)
//   reconcile  - the invoice already reads paid but the ledger has no
//                record; add the missing row without collecting money again
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

  const balance = Number(outstandingBalance || 0);

  useEffect(() => {
    if (!open) return;
    setAmount(mode === "partial" ? "" : balance > 0 ? String(balance.toFixed(2)) : "");
    setMethod("eft");
    setReference("");
    setPaidAt(today());
    setNote(mode === "reconcile" ? "Reconciled from legacy paid status - no new payment collected" : "");
    setSubmitError("");
  }, [open, mode, balance]);

  const amountNumber = Number(amount);
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0;
  const overBalance = amountValid && balance > 0 && amountNumber > balance + OVERPAY_TOLERANCE;
  const referenceValid = reference.trim().length > 0;
  const canSubmit = amountValid && !overBalance && referenceValid && !isPending;

  const title = mode === "reconcile"
    ? "Reconcile recorded payment"
    : mode === "partial"
      ? "Record a partial payment"
      : "Record payment";

  const description = mode === "reconcile"
    ? "This invoice shows as paid but has no entry in the payment ledger. Recording the payment here adds the missing ledger row - it does not collect money again."
    : "This adds one entry to the canonical payment ledger. The customer's invoice view and the OPPS balance update from it.";

  const submit = async () => {
    if (!canSubmit || !invoice) return;
    setSubmitError("");
    try {
      await onSubmit?.({
        amount: Number(amountNumber.toFixed(2)),
        method,
        reference: reference.trim(),
        paidAt,
        note: note.trim() || null,
        mode,
      });
      onOpenChange?.(false);
    } catch (error) {
      setSubmitError(error?.message || "Could not record the payment.");
    }
  };

  const balanceAfter = useMemo(() => {
    if (!amountValid) return balance;
    return Math.max(balance - amountNumber, 0);
  }, [amountValid, amountNumber, balance]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isPending) onOpenChange?.(next); }}>
      <DialogContent className="rounded-2xl">
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
            <Label htmlFor="invoice-payment-reference">Payment reference</Label>
            <Input
              id="invoice-payment-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Bank / EFT reference"
              className="h-11 rounded-xl"
            />
            {!referenceValid && (
              <p className="text-xs text-muted-foreground">Required - used for the audit trail and to prevent a duplicate entry.</p>
            )}
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

          <div className="space-y-1">
            <Label htmlFor="invoice-payment-note">Note (optional)</Label>
            <Textarea
              id="invoice-payment-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Anything the finance team should see against this payment"
              className="min-h-20 rounded-xl"
            />
          </div>

          <div className="rounded-xl bg-secondary/50 p-3 text-sm text-muted-foreground">
            Balance after this payment: <span className="tabular-nums text-foreground">{money(balanceAfter)}</span>
          </div>

          {submitError && <p className="text-sm text-destructive">{submitError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)} disabled={isPending} className="rounded-xl">
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="rounded-xl">
            {isPending ? "Recording..." : "Confirm payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
