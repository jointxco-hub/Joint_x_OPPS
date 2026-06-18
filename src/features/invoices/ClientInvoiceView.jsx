import { getInvoiceDisplayStates } from "./invoiceDisplayStatus";

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateText(value) {
  if (!value) return "Not set";
  return String(value).slice(0, 10);
}

export default function ClientInvoiceView({ invoice, order }) {
  const states = getInvoiceDisplayStates(invoice);
  const items = Array.isArray(invoice?.items) ? invoice.items : [];

  return (
    <article className="client-invoice mx-auto min-h-[297mm] max-w-[210mm] bg-white px-10 py-10 text-zinc-950 shadow-2xl print:min-h-0 print:max-w-none print:shadow-none">
      <header className="flex items-start justify-between gap-8 border-b border-zinc-200 pb-8">
        <div>
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-zinc-950 text-sm font-bold text-white">JX</div>
            <div>
              <p className="text-lg font-semibold tracking-tight">Joint X</p>
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">OPPS Invoice</p>
            </div>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">Invoice</h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">Thank you for your order. Please use this invoice for your records and payment reference.</p>
        </div>
        <div className="min-w-[210px] rounded-2xl border border-zinc-200 p-4 text-sm">
          <Meta label="Invoice number" value={invoice.invoice_number} />
          <Meta label="Invoice date" value={dateText(invoice.invoice_date)} />
          <Meta label="Due date" value={dateText(invoice.due_date)} />
          <Meta label="Payment terms" value={invoice.payment_terms || "Not set"} />
          <Meta label="Payment status" value={states.payment.label} />
        </div>
      </header>

      <section className="grid gap-6 border-b border-zinc-200 py-8 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Billed to</p>
          <h2 className="mt-3 text-xl font-semibold">{invoice.customer_name}</h2>
          <div className="mt-3 space-y-1 text-sm leading-6 text-zinc-600">
            {invoice.customer_email && <p>{invoice.customer_email}</p>}
            {invoice.customer_phone && <p>{invoice.customer_phone}</p>}
            {invoice.customer_billing_address && <p className="whitespace-pre-line">{invoice.customer_billing_address}</p>}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Reference</p>
          <div className="mt-3 space-y-2 text-sm text-zinc-600">
            <p><span className="text-zinc-400">Reference:</span> {invoice.reference_number || order?.order_number || "Not set"}</p>
            {order?.tracking_number && <p><span className="text-zinc-400">Order tracking:</span> {order.tracking_number}</p>}
            <p><span className="text-zinc-400">Currency:</span> {invoice.currency_code || "ZAR"}</p>
          </div>
        </div>
      </section>

      <section className="py-8">
        <div className="hidden grid-cols-[72px_1fr_70px_90px_100px] gap-4 border-b border-zinc-200 pb-3 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500 sm:grid">
          <span>Item</span>
          <span>Description</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Unit</span>
          <span className="text-right">Total</span>
        </div>
        <div className="divide-y divide-zinc-100">
          {items.map((item, index) => (
            <div key={item.id || item.line_number || index} className="grid gap-4 py-5 sm:grid-cols-[72px_1fr_70px_90px_100px] sm:items-start">
              <div className="h-16 w-16 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
                {item.thumbnail_url ? (
                  <img src={item.thumbnail_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Item</div>
                )}
              </div>
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold">{item.item_name}</p>
                {(item.item_description || item.variant_details) && (
                  <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-zinc-500">
                    {[item.item_description, item.variant_details].filter(Boolean).join("\n")}
                  </p>
                )}
              </div>
              <p className="text-sm text-zinc-600 sm:text-right">{item.quantity}</p>
              <p className="text-sm text-zinc-600 sm:text-right">{money(item.rate)}</p>
              <p className="text-sm font-semibold sm:text-right">{money(item.item_total)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-8 border-t border-zinc-200 pt-8 sm:grid-cols-[1fr_300px]">
        <div className="space-y-5 text-sm leading-6 text-zinc-600">
          {invoice.notes && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Notes</p>
              <p className="whitespace-pre-line">{invoice.notes}</p>
            </div>
          )}
          {invoice.terms && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Terms</p>
              <p className="whitespace-pre-line">{invoice.terms}</p>
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Payment</p>
            <p>Use the invoice number as your payment reference. Banking details can be added here once confirmed.</p>
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-200 p-5">
          <Summary label="Subtotal" value={invoice.subtotal} />
          <Summary label="Discount" value={-Number(invoice.discount_total || 0)} />
          <Summary label="Shipping" value={invoice.shipping_charge} />
          <Summary label="Adjustment" value={invoice.adjustment} />
          <Summary label="Tax" value={invoice.tax_total} />
          <div className="my-3 border-t border-zinc-200" />
          <Summary label="Total" value={invoice.total} strong />
          <Summary label="Paid" value={invoice.amount_paid} />
          <div className="mt-4 rounded-2xl bg-zinc-950 px-4 py-3 text-white">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Balance due</span>
              <span className="text-xl font-semibold">{money(invoice.balance_due)}</span>
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-10 border-t border-zinc-200 pt-6 text-center text-xs text-zinc-500">
        Thank you for your order.
      </footer>
    </article>
  );
}

function Meta({ label, value }) {
  return (
    <div className="flex justify-between gap-4 border-b border-zinc-100 py-2 last:border-0">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Summary({ label, value, strong = false }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={strong ? "font-semibold" : "text-zinc-500"}>{label}</span>
      <span className={strong ? "text-lg font-semibold" : "font-medium"}>{money(value)}</span>
    </div>
  );
}
