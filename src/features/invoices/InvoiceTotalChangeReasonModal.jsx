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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INVOICE_CHANGE_REASON_TYPES,
  CUSTOM_REASON,
  isChangeReasonValid,
  buildOverrideReasonString,
} from "./invoiceChangeReason";

function money(v) {
  const n = Number(v || 0);
  return `R${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Shown when a commercial edit changes an invoice's saved total. Collects
// ONE reason for the whole save transaction. `mode` is "save" | "approve"
// only to label the confirm button. The reason state is kept local so a
// retriable save failure (parent keeps the modal mounted) doesn't lose
// what the user typed.
export default function InvoiceTotalChangeReasonModal({
  open,
  mode = "save",
  previousTotal,
  nextTotal,
  changes = [],
  isSubmitting = false,
  onCancel,
  onConfirm,
}) {
  const [reasonType, setReasonType] = useState("");
  const [note, setNote] = useState("");

  // Reset only when the modal transitions closed -> open for a fresh save.
  useEffect(() => {
    if (open) {
      setReasonType("");
      setNote("");
    }
  }, [open]);

  const isCustom = reasonType === CUSTOM_REASON;
  const valid = useMemo(() => isChangeReasonValid(reasonType, note), [reasonType, note]);
  const confirmLabel = mode === "approve" ? "Approve invoice" : "Save changes";

  const handleConfirm = () => {
    if (!valid || isSubmitting) return;
    onConfirm(buildOverrideReasonString(reasonType, note));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !isSubmitting) onCancel(); }}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Explain invoice total change</DialogTitle>
          <DialogDescription>
            This invoice total changed from <strong>{money(previousTotal)}</strong> to{" "}
            <strong>{money(nextTotal)}</strong>. Select a reason before saving.
          </DialogDescription>
        </DialogHeader>

        {changes.length > 0 && (
          <ul className="max-h-32 overflow-y-auto rounded-xl border border-border bg-secondary/40 p-3 text-sm">
            {changes.slice(0, 8).map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1 py-0.5 text-foreground">
                <span className="font-medium">{c.label}:</span>
                <span className="text-muted-foreground">
                  {c.from == null ? "added" : c.to == null ? `${c.from} removed` : `${c.from} → ${c.to}`}
                </span>
              </li>
            ))}
            {changes.length > 8 && (
              <li className="pt-1 text-xs text-muted-foreground">+{changes.length - 8} more…</li>
            )}
          </ul>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="invoice-change-reason-type" className="text-sm font-medium text-foreground">
              Reason type <span className="text-destructive">*</span>
            </label>
            <Select value={reasonType} onValueChange={setReasonType}>
              <SelectTrigger id="invoice-change-reason-type" className="h-11 rounded-xl">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {INVOICE_CHANGE_REASON_TYPES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label htmlFor="invoice-change-reason-note" className="text-sm font-medium text-foreground">
              Additional note{isCustom ? <span className="text-destructive"> *</span> : <span className="text-muted-foreground"> (optional)</span>}
            </label>
            <Textarea
              id="invoice-change-reason-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={isCustom ? "Please explain the change." : "Add detail (optional)"}
              className="rounded-xl"
            />
            {isCustom && !note.trim() && (
              <p className="text-xs text-destructive">Please explain the change.</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl sm:h-10"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-11 rounded-xl sm:h-10"
            onClick={handleConfirm}
            disabled={!valid || isSubmitting}
          >
            {isSubmitting ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
