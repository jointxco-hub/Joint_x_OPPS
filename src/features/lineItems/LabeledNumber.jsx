// Shared by QuoteLineItemsEditor and InvoiceLineItemsEditor — a small
// labeled input wrapper used for Qty/Price/Discount/Unit/Tax fields on a
// line item. Presentational only; extracted from two identical copies.
export default function LabeledNumber({ label, className = "", children }) {
  return (
    <label className={`block rounded-lg bg-secondary/25 px-2 py-1 ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
