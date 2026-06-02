import { useState } from "react";
import { format } from "date-fns";
import { Paperclip, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dataClient } from "@/api/dataClient";
import { toast } from "sonner";
import MediaPreview from "@/components/common/MediaPreview";

// Extract an invoice/reference number from a filename.
// Matches patterns like INV-1234, ZB-5678, INV_001, ZB001, 2024-INV-99, etc.
// Falls back to the full filename stem so any name (e.g. "xlab labels") is trackable.
function extractInvoiceNumber(/** @type {string} */ filename) {
  const stem = filename.replace(/\.[^.]+$/, "");
  const patterns = [
    /\b(INV[-_]?\d+)\b/i,
    /\b(ZB[-_]?\d+)\b/i,
    /\b([A-Z]{2,6}[-_]\d{3,})\b/i,
    /\b(\d{4,})\b/,
  ];
  for (const re of patterns) {
    const m = stem.match(re);
    if (m) return m[1].toUpperCase().replace(/[_\s]/g, "-");
  }
  // Fallback: normalise the full stem so the tracker can still find this order
  return stem.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9\-]/g, "") || null;
}

function parseMoneyInput(/** @type {string | number | null | undefined} */ value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatCurrency(/** @type {number | null | undefined} */ value) {
  return `R${Number(value || 0).toLocaleString()}`;
}

export default function InvoicesTab({ order, onUpdate, totalPaid = 0, onPrint }) {
  const [uploading, setUploading] = useState(false);
  const [manualRef, setManualRef] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [amountIdx, setAmountIdx] = useState(/** @type {number|null} */ (null));
  const [amountInput, setAmountInput] = useState("");
  const orderTotal = Number(order.total_amount || 0);
  const typedInvoiceTotal = parseMoneyInput(invoiceTotal);
  const visibleInvoiceTotal = typedInvoiceTotal ?? orderTotal;
  const visibleBalance = Math.max(visibleInvoiceTotal - totalPaid, 0);
  const hasOrderTotal = orderTotal > 0;

  const saveInvoiceAmount = (idx) => {
    const amount = parseMoneyInput(amountInput);
    if (!amount) return;
    const files = [...(order.invoice_files || [])];
    files[idx] = {
      ...files[idx],
      invoice_total: amount,
      balance_after_payments: Math.max(amount - totalPaid, 0),
    };
    onUpdate(order.id, {
      invoice_files: files,
      total_amount: amount,
    });
    setAmountIdx(null);
    setAmountInput("");
  };

  const uploadInvoice = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const existing = order.invoice_files || [];
      const existingNumbers = order.invoice_numbers || [];
      const invoiceAmountInput = parseMoneyInput(invoiceTotal);
      const invoiceAmount = invoiceAmountInput ?? (hasOrderTotal ? orderTotal : null);
      const shouldSetOrderTotal = Boolean(invoiceAmountInput);
      const uploadedInvoices = [];
      const uploadedNumbers = [];

      for (const file of files) {
        const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
        const invoiceNumber = extractInvoiceNumber(file.name);
        if (invoiceNumber) uploadedNumbers.push(invoiceNumber);
        uploadedInvoices.push({
          name: file.name,
          url: file_url,
          type: file.type,
          uploaded_at: new Date().toISOString(),
          source: 'zoho_books',
          invoice_number: invoiceNumber,
          invoice_total: invoiceAmount,
          balance_after_payments: invoiceAmount ? Math.max(invoiceAmount - totalPaid, 0) : undefined,
          paid_at_upload: totalPaid,
        });
      }

      onUpdate(order.id, {
        ...(shouldSetOrderTotal ? { total_amount: invoiceAmount } : {}),
        invoice_files: [...existing, ...uploadedInvoices],
        // Append extracted number to the searchable invoice_numbers array
        invoice_numbers: Array.from(new Set([...existingNumbers, ...uploadedNumbers])),
      });
      setInvoiceTotal("");
      toast.success(files.length === 1
        ? (uploadedNumbers[0] ? `Invoice uploaded - reference ${uploadedNumbers[0]} added to tracking` : "Invoice uploaded")
        : `${files.length} invoices uploaded`);
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removeInvoice = (idx) => {
    const files = order.invoice_files || [];
    const updated = files.filter((/** @type {any} */ _, /** @type {number} */ i) => i !== idx);
    // Also remove the invoice number from the tracking array if no other file uses it
    const remainingNumbers = updated
      .map((/** @type {any} */ f) => f.invoice_number)
      .filter(Boolean);
    const updatedNumbers = (order.invoice_numbers || []).filter(
      (/** @type {string} */ n) => remainingNumbers.includes(n)
    );
    onUpdate(order.id, { invoice_files: updated, invoice_numbers: updatedNumbers });
  };

  const invoices = order.invoice_files || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
        <div>
          <p className="text-sm font-semibold text-amber-950">Invoice printout</p>
          <p className="text-xs text-amber-700">Print invoice totals, payment status, and invoice links.</p>
        </div>
        <button
          type="button"
          onClick={() => onPrint?.("invoices")}
          className="inline-flex items-center gap-2 rounded-full bg-amber-900 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800"
        >
          <Printer className="h-3.5 w-3.5" />
          Print invoices
        </button>
      </div>
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
        <p className="text-xs font-semibold text-amber-800 mb-0.5">Invoices &amp; Tracking References</p>
        <p className="text-xs text-amber-700">
          Upload invoices - reference numbers are extracted from filenames automatically. You can also add a reference manually so any name (e.g. "xlab labels") works in the tracker.
        </p>
        {(order.invoice_numbers || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {(order.invoice_numbers || []).map((/** @type {string} */ n) => (
              <span key={n} className="text-xs font-mono bg-amber-200 text-amber-900 px-2 py-0.5 rounded-md flex items-center gap-1">
                {n}
                <button
                  onClick={() => {
                    const updated = (order.invoice_numbers || []).filter((/** @type {string} */ x) => x !== n);
                    onUpdate(order.id, { invoice_numbers: updated });
                  }}
                  className="text-amber-600 hover:text-red-600 transition-colors leading-none"
                  title="Remove reference"
                >x</button>
              </span>
            ))}
          </div>
        )}
        {/* Manual reference number */}
        <div className="flex gap-2 pt-1">
          <Input
            value={manualRef}
            onChange={(/** @type {any} */ e) => setManualRef(e.target.value.toUpperCase())}
            placeholder="Add reference manually (e.g. XLAB-LABELS)"
            className="h-8 rounded-lg text-xs font-mono flex-1"
            onKeyDown={(/** @type {any} */ e) => {
              if (e.key === "Enter") {
                const ref = manualRef.trim().replace(/\s+/g, "-");
                if (!ref) return;
                const existing = order.invoice_numbers || [];
                if (!existing.includes(ref)) {
                  onUpdate(order.id, { invoice_numbers: [...existing, ref] });
                }
                setManualRef("");
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-xs px-3 border-amber-300 text-amber-800 hover:bg-amber-100"
            onClick={() => {
              const ref = manualRef.trim().replace(/\s+/g, "-");
              if (!ref) return;
              const existing = order.invoice_numbers || [];
              if (!existing.includes(ref)) {
                onUpdate(order.id, { invoice_numbers: [...existing, ref] });
              }
              setManualRef("");
            }}
          >
            Add
          </Button>
        </div>
      </div>

      <div className="rounded-xl bg-card border border-border p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Invoice pricing</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hasOrderTotal
                ? "Saving an invoice total updates the order value used by tracking and balance checks."
                : "Add the invoice total before upload to set the missing order price."}
            </p>
          </div>
          {hasOrderTotal && (
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
              Order {formatCurrency(orderTotal)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input
            value={invoiceTotal}
            onChange={(/** @type {any} */ e) => setInvoiceTotal(e.target.value)}
            placeholder={hasOrderTotal ? "Invoice total (optional)" : "Invoice total"}
            type="number"
            min="0"
            step="0.01"
            className="h-9 rounded-xl text-sm"
          />
          <div className="sm:col-span-2 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-secondary/50 px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground">Invoice</p>
              <p className="text-xs font-semibold text-foreground">{formatCurrency(visibleInvoiceTotal)}</p>
            </div>
            <div className="rounded-lg bg-green-50 px-2 py-1.5">
              <p className="text-[10px] text-green-700">Paid</p>
              <p className="text-xs font-semibold text-green-800">{formatCurrency(totalPaid)}</p>
            </div>
            <div className={`rounded-lg px-2 py-1.5 ${visibleBalance > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
              <p className={`text-[10px] ${visibleBalance > 0 ? 'text-red-700' : 'text-green-700'}`}>Balance</p>
              <p className={`text-xs font-semibold ${visibleBalance > 0 ? 'text-red-800' : 'text-green-800'}`}>{formatCurrency(visibleBalance)}</p>
            </div>
          </div>
        </div>
      </div>

      <label className="cursor-pointer block">
        <div className={`flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-2xl transition-all ${
          uploading ? 'border-border opacity-60' : 'border-amber-300 hover:border-amber-400 hover:bg-amber-50/50'
        }`}>
          <Paperclip className="w-4 h-4 text-amber-600" />
          <span className="text-sm text-amber-700 font-medium">
            {uploading ? 'Uploading invoice...' : 'Upload Zoho Books invoice'}
          </span>
        </div>
        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" multiple onChange={uploadInvoice} disabled={uploading} />
      </label>

      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4 bg-secondary/30 rounded-xl">
          No invoices uploaded yet
        </p>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
              <MediaPreview url={inv.url || inv.file_url} title={inv.name || `Invoice ${i + 1}`} className="h-10 w-10 flex-shrink-0 rounded-lg border-amber-200 bg-amber-100" />
              <div className="flex-1 min-w-0">
                <p className="block max-w-full truncate text-sm font-medium text-amber-800">
                  {inv.name}
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  {inv.invoice_number && (
                    <span className="font-mono bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded mr-1.5">{inv.invoice_number}</span>
                  )}
                  Zoho Books / {inv.uploaded_at ? format(new Date(inv.uploaded_at), 'd MMM yyyy') : 'Uploaded'}
                </p>
                {amountIdx === i ? (
                  <div className="mt-2 flex items-center gap-1.5">
                    <Input
                      type="number"
                      placeholder="Invoice total (R)"
                      value={amountInput}
                      onChange={(/** @type {any} */ e) => setAmountInput(e.target.value)}
                      className="h-7 text-xs rounded-lg flex-1"
                      autoFocus
                      onKeyDown={(/** @type {any} */ e) => e.key === 'Enter' && saveInvoiceAmount(i)}
                    />
                    <Button size="sm" onClick={() => saveInvoiceAmount(i)} className="h-7 text-xs px-2 rounded-lg">Save</Button>
                    <button onClick={() => { setAmountIdx(null); setAmountInput(""); }} className="text-xs text-muted-foreground px-1">x</button>
                  </div>
                ) : inv.invoice_total ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      onClick={() => { setAmountIdx(i); setAmountInput(String(inv.invoice_total)); }}
                      className="text-[11px] font-semibold bg-white/70 text-amber-900 border border-amber-200 rounded-full px-2 py-0.5 hover:bg-amber-100 transition-colors"
                      title="Click to edit"
                    >
                      Invoice {formatCurrency(inv.invoice_total)}
                    </button>
                    <span className="text-[11px] font-semibold bg-green-50 text-green-800 border border-green-100 rounded-full px-2 py-0.5">
                      Paid {formatCurrency(totalPaid)}
                    </span>
                    <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border ${
                      Math.max(inv.invoice_total - totalPaid, 0) > 0
                        ? 'bg-red-50 text-red-800 border-red-100'
                        : 'bg-green-50 text-green-800 border-green-100'
                    }`}>
                      Balance {formatCurrency(Math.max(inv.invoice_total - totalPaid, 0))}
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAmountIdx(i); setAmountInput(""); }}
                    className="mt-1 text-xs text-amber-700 hover:text-amber-900 underline underline-offset-2 transition-colors block"
                  >
                    + Set invoice total
                  </button>
                )}
              </div>
              <button
                onClick={() => removeInvoice(i)}
                className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                title="Remove"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
