// Shared preview component for both sync directions (PHASE 6/7) - the
// same visual pattern OrderLinkPanel's order->invoice sync already used,
// generalized to also render the invoice->order diff shape (added/
// updated/missingFromInvoice), per-line production-data warnings
// (PHASE 8), and the shipping diff row (PHASE 10). No silent write ever
// happens here - this is preview-only, rendered inside a confirm dialog
// the caller controls.
export default function SyncDiffSummary({ diff, direction }) {
  if (!diff) return null;

  const rows = [];

  if (diff.added?.length) {
    rows.push({
      label: direction === "invoiceToOrder" ? "New commercial order lines" : "Will be added from the order",
      items: diff.added.map((name) => ({ text: name })),
    });
  }
  if (diff.updated?.length) {
    rows.push({
      label: "Changed",
      items: diff.updated.map((entry) => (
        typeof entry === "string"
          ? { text: entry }
          : {
              text: entry.name,
              detail: entry.before && entry.after
                ? `qty ${entry.before.quantity} -> ${entry.after.quantity} - R${entry.before.price} -> R${entry.after.price}`
                : undefined,
              warning: entry.hasProductionData
                ? "Production data exists for this line - reservation recalculation required"
                : undefined,
            }
      )),
    });
  }
  if (diff.missingFromInvoice?.length) {
    rows.push({
      label: "Invoice no longer contains this item",
      items: diff.missingFromInvoice.map((entry) => ({
        text: entry.name,
        detail: "Defaults to Keep on order",
        warning: entry.hasProductionData
          ? "Has snapshots/reservations/tracking - use the release workflow before removing"
          : undefined,
      })),
    });
  }
  if (diff.removedFromOrder?.length) {
    rows.push({ label: "No longer on the order - will be removed", items: diff.removedFromOrder.map((name) => ({ text: name })) });
  }
  if (diff.keptInvoiceOnly?.length) {
    rows.push({ label: "Kept as-is (not from this order)", items: diff.keptInvoiceOnly.map((name) => ({ text: name })) });
  }

  const shippingRow = diff.shipping?.differs
    ? `Shipping differs: Order R${diff.shipping.orderAmount} / Invoice R${diff.shipping.invoiceAmount}`
    : null;

  if (rows.length === 0 && !shippingRow) {
    return <p className="text-sm text-muted-foreground">No changes - already in sync.</p>;
  }

  return (
    <div className="space-y-3">
      {shippingRow && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          {shippingRow}
        </div>
      )}
      {rows.map((row) => (
        <div key={row.label}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{row.label} ({row.items.length})</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">
            {row.items.map((item, index) => (
              <li key={`${item.text}-${index}`}>
                {item.text}
                {item.detail && <span className="text-muted-foreground"> - {item.detail}</span>}
                {item.warning && <span className="mt-0.5 block text-xs font-semibold text-red-700">{item.warning}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
