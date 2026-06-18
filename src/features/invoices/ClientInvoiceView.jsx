import { getInvoiceDisplayStates } from "./invoiceDisplayStatus";

const BRAND = {
  name: "JointX",
  email: "jointx.co@gmail.com",
  website: "jointx.co.za",
  logo: "/icons/jointx-logo.png",
};

const TERMS = [
  "Payment confirms the order and allows production to begin. Production timing starts once payment, artwork, sizing, quantities, and all required order details are confirmed.",
  "Custom and personalised items are made to order. Returns or refunds are only considered for verified production faults, incorrect items, or defects reported within 7 days of receiving the order.",
  "Colours, garment fit, print placement, and material finish may vary slightly between screens, suppliers, blanks, and production methods.",
  "Delivery or courier timelines start after production is complete. Delays caused by missing artwork, unavailable blanks, client changes, or courier issues may affect completion dates.",
  `For invoice questions, order changes, or payment confirmation, contact ${BRAND.email}. Please use the invoice number as your payment reference.`,
];

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateText(value, fallback = "Not set") {
  if (!value) return fallback;
  return String(value).slice(0, 10);
}

function summaryRows(invoice) {
  const rows = [
    ["Subtotal", invoice.subtotal],
    ["Discount", -Number(invoice.discount_total || 0)],
    ["Shipping", invoice.shipping_charge],
    ["Adjustment", invoice.adjustment],
    ["Tax", invoice.tax_total],
  ];

  return rows.filter(([label, value]) =>
    ["Subtotal", "Tax"].includes(label) || Number(value || 0) !== 0
  );
}

export default function ClientInvoiceView({ invoice, order }) {
  const states = getInvoiceDisplayStates(invoice);
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  const reference = invoice.reference_number || order?.order_number || "Not set";

  return (
    <article className="client-invoice mx-auto min-h-[297mm] max-w-[210mm] overflow-hidden bg-white text-slate-950 shadow-2xl print:min-h-0 print:max-w-none print:shadow-none">
      <header className="relative border-b border-slate-200 px-10 pb-8 pt-9">
        <div className="absolute left-0 top-0 h-2 w-full bg-[linear-gradient(90deg,#00866f_0%,#00866f_38%,#d62d00_38%,#d62d00_68%,#c8adf4_68%,#c8adf4_100%)]" />
        <div className="flex items-start justify-between gap-8">
          <div className="min-w-0">
            <div className="mb-8 flex items-center gap-4">
              <img
                src={BRAND.logo}
                alt="JointX"
                className="h-16 w-16 rounded-full border border-slate-200 object-contain"
              />
              <div>
                <p className="text-2xl font-semibold tracking-tight">{BRAND.name}</p>
                <p className="text-sm text-slate-500">{BRAND.email}</p>
                <p className="text-sm text-slate-500">{BRAND.website}</p>
              </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#00866f]">Client invoice</p>
            <h1 className="mt-2 text-5xl font-semibold tracking-tight">Invoice</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
              A clear summary of your order, payment status, and balance due.
            </p>
          </div>

          <div className="w-[255px] rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm">
            <Meta label="Invoice number" value={invoice.invoice_number} strong />
            <Meta label="Invoice date" value={dateText(invoice.invoice_date)} />
            <Meta label="Due date" value={dateText(invoice.due_date)} />
            <Meta label="Payment terms" value={invoice.payment_terms || "Due on receipt"} />
            <div className="mt-4 rounded-2xl bg-slate-950 px-4 py-3 text-white">
              <p className="text-xs text-slate-300">Balance due</p>
              <p className="mt-1 text-2xl font-semibold">{money(invoice.balance_due)}</p>
            </div>
            <div className="mt-3 rounded-2xl border border-[#00866f]/20 bg-[#00866f]/10 px-4 py-3">
              <p className="text-xs text-slate-500">Payment status</p>
              <p className="mt-1 font-semibold text-[#006f5d]">{states.payment.label}</p>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-6 border-b border-slate-200 px-10 py-8 sm:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Billed to">
          <h2 className="text-2xl font-semibold">{invoice.customer_name}</h2>
          <div className="mt-4 space-y-1 text-sm leading-6 text-slate-600">
            {invoice.customer_email && <p>{invoice.customer_email}</p>}
            {invoice.customer_phone && <p>{invoice.customer_phone}</p>}
            {invoice.customer_billing_address ? (
              <p className="whitespace-pre-line">{invoice.customer_billing_address}</p>
            ) : (
              <p className="text-slate-400">Billing address not supplied</p>
            )}
          </div>
        </Panel>

        <Panel title="Reference">
          <div className="space-y-3 text-sm text-slate-600">
            <KeyValue label="Order reference" value={reference} />
            {order?.tracking_number && <KeyValue label="Order tracking" value={order.tracking_number} />}
            <KeyValue label="Currency" value={invoice.currency_code || "ZAR"} />
            <KeyValue label="Support" value={BRAND.email} />
          </div>
        </Panel>
      </section>

      <section className="px-10 py-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Order items</p>
            <p className="mt-1 text-sm text-slate-500">{items.length} line item{items.length === 1 ? "" : "s"}</p>
          </div>
          <div className="rounded-full bg-[#c8adf4]/25 px-4 py-2 text-xs font-semibold text-slate-700">
            Total {money(invoice.total)}
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-200">
          <div className="hidden grid-cols-[76px_1fr_70px_100px_110px] gap-4 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 sm:grid">
            <span>Item</span>
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit</span>
            <span className="text-right">Total</span>
          </div>
          <div className="divide-y divide-slate-100">
            {items.map((item, index) => (
              <div key={item.id || item.line_number || index} className="grid gap-4 px-5 py-5 sm:grid-cols-[76px_1fr_70px_100px_110px] sm:items-start">
                <div className="h-16 w-16 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {item.thumbnail_url ? (
                    <img src={item.thumbnail_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">Item</div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="break-words text-base font-semibold">{item.item_name}</p>
                  {(item.item_description || item.variant_details) && (
                    <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-slate-500">
                      {[item.item_description, item.variant_details].filter(Boolean).join("\n")}
                    </p>
                  )}
                </div>
                <p className="text-sm text-slate-600 sm:text-right">{item.quantity}</p>
                <p className="text-sm text-slate-600 sm:text-right">{money(item.rate)}</p>
                <p className="text-base font-semibold sm:text-right">{money(item.item_total)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-8 border-t border-slate-200 px-10 py-8 sm:grid-cols-[1fr_315px]">
        <div className="space-y-5 text-sm leading-6 text-slate-600">
          <div className="rounded-3xl border border-[#00866f]/20 bg-[#00866f]/5 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#006f5d]">Payment guidance</p>
            <p className="mt-3">
              Use <span className="font-semibold text-slate-950">{invoice.invoice_number}</span> as your payment reference.
              For proof of payment or invoice questions, email <span className="font-semibold text-slate-950">{BRAND.email}</span>.
            </p>
          </div>

          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Terms and conditions</p>
            <ol className="space-y-2">
              {TERMS.map((term, index) => (
                <li key={term} className="grid grid-cols-[24px_1fr] gap-2">
                  <span className="font-semibold text-[#d62d00]">{index + 1}.</span>
                  <span>{term}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          {summaryRows(invoice).map(([label, value]) => (
            <Summary key={label} label={label} value={value} />
          ))}
          <div className="my-3 border-t border-slate-200" />
          <Summary label="Total" value={invoice.total} strong />
          <Summary label="Paid" value={invoice.amount_paid} />
          <div className="mt-4 rounded-2xl bg-slate-950 px-4 py-3 text-white">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Balance due</span>
              <span className="text-2xl font-semibold">{money(invoice.balance_due)}</span>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-10 border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        Thank you for choosing {BRAND.name}. Made for real use, handled with care.
      </footer>
    </article>
  );
}

function Panel({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function KeyValue({ label, value }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

function Meta({ label, value, strong = false }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-200 py-2 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right ${strong ? "font-semibold text-slate-950" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function Summary({ label, value, strong = false }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={strong ? "font-semibold" : "text-slate-500"}>{label}</span>
      <span className={strong ? "text-lg font-semibold" : "font-medium"}>{money(value)}</span>
    </div>
  );
}
