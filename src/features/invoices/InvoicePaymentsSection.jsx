import { useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Paperclip, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPaymentProofSignedUrl } from "@/api/invoices";

const ACCEPT_ATTR = ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf";
const METHOD_LABELS = {
  eft: "EFT / bank transfer",
  cash: "Cash",
  card: "Card",
  other: "Other",
};

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function shortDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return String(value).slice(0, 10);
  }
}

async function openProof(row) {
  try {
    const url = await getPaymentProofSignedUrl(row);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  } catch { /* ignore */ }
}

// Payments history for the invoice drawer. Read-only ledger truth plus,
// per payment, its private proof attachments. Adding or retiring proof
// NEVER records a payment or changes totals — those go through
// attach_payment_proof / supersede_payment_attachment.
export default function InvoicePaymentsSection({
  payments = [],
  canRetireProof = false,
  isProofBusy = false,
  onAddProof,
  onRetireProof,
}) {
  const [retireTarget, setRetireTarget] = useState(null); // attachment row
  const [retireReason, setRetireReason] = useState("");

  if (!payments.length) return null;

  const submitRetire = () => {
    if (!retireTarget || !retireReason.trim()) return;
    onRetireProof?.(retireTarget, retireReason.trim());
    setRetireTarget(null);
    setRetireReason("");
  };

  return (
    <div className="rounded-2xl border border-border p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Payments</h3>
        <span className="text-xs text-muted-foreground">{payments.length} ledger entr{payments.length === 1 ? "y" : "ies"}</span>
      </div>
      <ul className="space-y-2">
        {payments.map((p) => (
          <PaymentRow
            key={p.id}
            payment={p}
            canRetireProof={canRetireProof}
            isProofBusy={isProofBusy}
            onAddProof={onAddProof}
            onRequestRetire={(att) => { setRetireTarget(att); setRetireReason(""); }}
          />
        ))}
      </ul>

      <Dialog open={Boolean(retireTarget)} onOpenChange={(next) => { if (!next) { setRetireTarget(null); setRetireReason(""); } }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Retire this proof of payment</DialogTitle>
            <DialogDescription>
              The file stays on record as retired evidence — this does not delete it, change the payment, or alter any total.
              A reason is required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="retire-proof-reason">Reason</Label>
            <Textarea
              id="retire-proof-reason"
              value={retireReason}
              onChange={(e) => setRetireReason(e.target.value)}
              placeholder="e.g. client sent a clearer copy; wrong file attached"
              className="min-h-20 rounded-xl"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => { setRetireTarget(null); setRetireReason(""); }}>
              Cancel
            </Button>
            <Button className="rounded-xl" onClick={submitRetire} disabled={!retireReason.trim() || isProofBusy}>
              {isProofBusy ? "Retiring…" : "Retire proof"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentRow({ payment, canRetireProof, isProofBusy, onAddProof, onRequestRetire }) {
  const fileRef = useRef(null);
  const [adding, setAdding] = useState(false);
  const attachments = Array.isArray(payment.attachments) ? payment.attachments : [];
  const live = attachments.filter((a) => a.status !== "superseded");
  const retired = attachments.filter((a) => a.status === "superseded");

  const pickAndAdd = async (fileList) => {
    const file = Array.from(fileList || [])[0];
    if (!file) return;
    setAdding(true);
    try {
      await onAddProof?.(payment, file);
    } finally {
      setAdding(false);
    }
  };

  return (
    <li className="rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold tabular-nums text-foreground">{money(payment.amount)}</span>
        <span className="text-xs text-muted-foreground">
          {METHOD_LABELS[payment.method] || payment.method || "payment"} · {shortDate(payment.paid_at)}
          {payment.source && payment.source !== "manual" ? ` · ${payment.source}` : ""}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {payment.reference ? <>Ref <span className="text-foreground">{payment.reference}</span></> : <span className="italic">No reference</span>}
      </div>

      {(live.length > 0 || retired.length > 0) && (
        <ul className="mt-2 space-y-1">
          {live.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-xs">
              {String(a.mime_type).includes("pdf")
                ? <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                : <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{a.filename || "attachment"}</span>
              <button type="button" className="shrink-0 font-medium text-primary underline underline-offset-2" onClick={() => openProof(a)}>
                Open
              </button>
              {canRetireProof && (
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground underline underline-offset-2 hover:text-destructive"
                  onClick={() => onRequestRetire(a)}
                  disabled={isProofBusy}
                >
                  Retire
                </button>
              )}
            </li>
          ))}
          {retired.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate line-through">{a.filename || "attachment"}</span>
              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">Retired</span>
              <button type="button" className="shrink-0 underline underline-offset-2 hover:text-foreground" onClick={() => openProof(a)}>
                Open
              </button>
            </li>
          ))}
          {retired.map((a) => a.supersede_reason ? (
            <li key={`${a.id}-reason`} className="pl-5 text-[11px] italic text-muted-foreground">“{a.supersede_reason}”</li>
          ) : null)}
        </ul>
      )}

      <div className="mt-2">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => { pickAndAdd(e.target.files); e.target.value = ""; }}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7 rounded-lg text-xs"
          onClick={() => fileRef.current?.click()}
          disabled={adding || isProofBusy}
        >
          {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
          {adding ? "Adding…" : "Add proof"}
        </Button>
      </div>
    </li>
  );
}
