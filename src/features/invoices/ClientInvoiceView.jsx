import {
  CreditCard,
  Globe2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ReceiptText,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { getInvoiceDisplayStates } from "./invoiceDisplayStatus";
import { normalizeClientTemplateSetting } from "./invoiceSettings";

const BRAND = {
  name: "JointX",
  email: "jointx.co@gmail.com",
  phone: "+27 7453 4646",
  whatsapp: "+27 7453 4646",
  primarySite: "xlab.jointx.co.za",
  samplePacksSite: "x1.jointx.co.za",
  logo: "/icons/jointx-logo.png",
};

const TERMS = [
  "Payment confirms the order and allows production to begin. Production starts once payment, artwork, sizing, quantities, and delivery details are confirmed.",
  "Custom and personalised orders are made to order. Returns or refunds are considered only for verified production faults, incorrect items, or defects reported within 7 days of receiving the order.",
  "Colours, garment fit, print placement, and material finish may vary slightly between screens, suppliers, blanks, and production methods.",
  "Courier, PEP/PAXI, pickup, and delivery timelines start after production is complete. Missing artwork, unavailable blanks, client changes, or courier delays may affect completion.",
  `For current order information and product details, use ${BRAND.primarySite}. For X1 sample packs, use ${BRAND.samplePacksSite}.`,
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

function compactRows(rows) {
  return rows.filter(([, value]) => value !== undefined && value !== null && value !== "");
}

function summaryRows(invoice) {
  return [
    ["Subtotal", invoice.subtotal],
    ["Discount", -Number(invoice.discount_total || 0)],
    ["Shipping", invoice.shipping_charge],
    ["Adjustment", invoice.adjustment],
    ["Tax", invoice.tax_total],
  ].filter(([label, value]) => ["Subtotal", "Tax"].includes(label) || Number(value || 0) !== 0);
}

function deliveryRows(order) {
  if (!order) return [];
  return compactRows([
    ["Courier", order.courier],
    ["PEP/PAXI code", order.pep_code],
    ["Tracking", order.tracking_number || order.tracking_code],
    ["Delivery note", order.delivery_note],
  ]);
}

export default function ClientInvoiceView({ invoice, order, template: rawTemplate }) {
  const template = normalizeClientTemplateSetting(rawTemplate);
  const brand = {
    name: template.businessDisplayName || BRAND.name,
    email: template.contactEmail || BRAND.email,
    phone: template.contactPhone || BRAND.phone,
    whatsapp: template.contactWhatsapp || BRAND.whatsapp,
    primarySite: template.primarySite || BRAND.primarySite,
    samplePacksSite: template.samplePacksSite || BRAND.samplePacksSite,
    logo: template.logoUrl || BRAND.logo,
  };
  const states = getInvoiceDisplayStates(invoice);
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  const reference = invoice.reference_number || order?.order_number || "Not set";
  const delivery = deliveryRows(order);

  return (
    <article className="client-invoice mx-auto min-h-[297mm] max-w-[210mm] bg-white px-9 py-9 text-slate-950 shadow-2xl print:min-h-0 print:max-w-none print:shadow-none">
      <header className="border-b border-slate-200 pb-7">
        <div className="flex items-start justify-between gap-8">
          <div className="min-w-0">
            <div className="mb-7 flex items-center gap-4">
              <img
                src={brand.logo}
                alt={brand.name}
                className="h-14 w-14 rounded-lg border border-slate-200 object-contain"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
              <div>
                <p className="text-xl font-semibold tracking-tight">{brand.name}</p>
                <div className="mt-2 grid gap-1 text-xs leading-5 text-slate-500">
                  {brand.email && <InlineContact icon={Mail} value={brand.email} />}
                  {brand.phone && <InlineContact icon={Phone} value={brand.phone} />}
                  {brand.whatsapp && <InlineContact icon={MessageCircle} value={`WhatsApp ${brand.whatsapp}`} />}
                  {brand.primarySite && <InlineContact icon={Globe2} value={brand.primarySite} />}
                  {brand.samplePacksSite && <InlineContact icon={Globe2} value={`${brand.samplePacksSite} - sample packs`} />}
                </div>
              </div>
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#007f6b]">Client invoice</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Invoice</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
              Order, payment, and delivery details in one clean record.
            </p>
          </div>

          <div className="w-[245px] rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            <Meta label="Invoice number" value={invoice.invoice_number} strong />
            <Meta label="Invoice date" value={dateText(invoice.invoice_date)} />
            <Meta label="Due date" value={dateText(invoice.due_date)} />
            <Meta label="Payment terms" value={invoice.payment_terms || "Due on receipt"} />
            <div className="mt-4 rounded-lg bg-slate-950 px-4 py-3 text-white">
              <p className="text-xs text-slate-300">Balance due</p>
              <p className="mt-1 text-xl font-semibold">{money(invoice.balance_due)}</p>
            </div>
            <div className="mt-3 rounded-lg border border-[#00866f]/20 bg-[#00866f]/10 px-4 py-3">
              <p className="text-xs text-slate-500">Payment status</p>
              <p className="mt-1 font-semibold text-[#006f5d]">{states.payment.label}</p>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-7 border-b border-slate-200 py-7 sm:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Billed to" icon={ReceiptText}>
          <h2 className="text-xl font-semibold">{invoice.customer_name}</h2>
          <div className="mt-3 space-y-1 text-sm leading-6 text-slate-600">
            {invoice.customer_email && <p>{invoice.customer_email}</p>}
            {invoice.customer_phone && <p>{invoice.customer_phone}</p>}
            {invoice.customer_billing_address ? (
              <p className="whitespace-pre-line">{invoice.customer_billing_address}</p>
            ) : (
              <p className="text-slate-400">Billing address not supplied</p>
            )}
          </div>
        </Panel>

        <Panel title="Reference" icon={ShieldCheck}>
          <div className="space-y-2 text-sm text-slate-600">
            <KeyValue label="Order reference" value={reference} />
            <KeyValue label="Currency" value={invoice.currency_code || "ZAR"} />
            <KeyValue label="Support" value={brand.email || "Not configured"} />
            {brand.primarySite && <KeyValue label="Primary site" value={brand.primarySite} />}
            {brand.samplePacksSite && <KeyValue label="Sample packs" value={brand.samplePacksSite} />}
          </div>
        </Panel>
      </section>

      {delivery.length > 0 && (
        <section className="border-b border-slate-200 py-5">
          <Panel title="Delivery and tracking" icon={Truck}>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {delivery.map(([label, value]) => (
                <SmallInfo key={label} label={label} value={value} icon={label === "Delivery note" ? MapPin : Truck} />
              ))}
            </div>
          </Panel>
        </section>
      )}

      <section className="py-7">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Order items</p>
            <p className="mt-1 text-sm text-slate-500">{items.length} line item{items.length === 1 ? "" : "s"}</p>
          </div>
          <div className="rounded-lg bg-[#c8adf4]/20 px-4 py-2 text-xs font-semibold text-slate-700">
            Total {money(invoice.total)}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="hidden grid-cols-[70px_1fr_64px_92px_105px] gap-4 bg-slate-50 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:grid">
            <span>Item</span>
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit</span>
            <span className="text-right">Total</span>
          </div>
          <div className="divide-y divide-slate-100">
            {items.map((item, index) => (
              <div key={item.id || item.line_number || index} className="grid gap-4 px-5 py-5 sm:grid-cols-[70px_1fr_64px_92px_105px] sm:items-start">
                <div className="h-14 w-14 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  {template.showProductThumbnails !== false && item.thumbnail_url ? (
                    <img src={item.thumbnail_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">Item</div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold">{item.item_name}</p>
                  {(item.item_description || item.variant_details) && (
                    <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-slate-500">
                      {[item.item_description, item.variant_details].filter(Boolean).join("\n")}
                    </p>
                  )}
                </div>
                <p className="text-sm text-slate-600 sm:text-right">{item.quantity}</p>
                <p className="text-sm text-slate-600 sm:text-right">{money(item.rate)}</p>
                <p className="text-sm font-semibold sm:text-right">{money(item.item_total)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-7 border-t border-slate-200 py-7 sm:grid-cols-[1fr_300px]">
        <div className="space-y-4 text-sm leading-6 text-slate-600">
          <div className="rounded-lg border border-[#00866f]/20 bg-[#00866f]/5 p-4">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#006f5d]">
              <CreditCard className="h-3.5 w-3.5" /> Payment guidance
            </p>
            <p className="mt-3">
              Use <span className="font-semibold text-slate-950">{invoice.invoice_number}</span> as your payment reference.
              {brand.email ? <> Send proof of payment to <span className="font-semibold text-slate-950">{brand.email}</span>.</> : null}
            </p>
          </div>

          {template.paymentInstructions ? (
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <CreditCard className="h-3.5 w-3.5" /> Payment instructions
              </p>
              <p className="whitespace-pre-line break-words text-sm leading-6 text-slate-600">{template.paymentInstructions}</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          {summaryRows(invoice).map(([label, value]) => (
            <Summary key={label} label={label} value={value} />
          ))}
          <div className="my-3 border-t border-slate-200" />
          <Summary label="Total" value={invoice.total} strong />
          {template.showPaidBalanceBlock !== false && (
            <>
              <Summary label="Paid" value={invoice.amount_paid} />
              <div className="mt-4 rounded-lg bg-slate-950 px-4 py-3 text-white">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-300">Balance due</span>
                  <span className="text-xl font-semibold">{money(invoice.balance_due)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="break-before-auto border-t border-slate-200 pt-7">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Terms and conditions</p>
        <ol className="grid gap-2 text-xs leading-5 text-slate-600">
          {TERMS.map((term, index) => (
            <li key={term} className="grid grid-cols-[22px_1fr] gap-2">
              <span className="font-semibold text-[#d62d00]">{index + 1}.</span>
              <span>{term}</span>
            </li>
          ))}
        </ol>
        {template.footerNote && <p className="mt-4 text-xs leading-5 text-slate-500">{template.footerNote}</p>}
      </section>

      <footer className="mt-7 border-t border-slate-200 pt-5 text-center text-xs text-slate-500">
        <p>{template.thankYouMessage || `Thank you for choosing ${brand.name}.`}</p>
        <p className="mt-2">{[brand.primarySite, brand.samplePacksSite].filter(Boolean).join(" / ")}</p>
      </footer>
    </article>
  );
}

function InlineContact({ icon: Icon, value }) {
  return (
    <p className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      <span>{value}</span>
    </p>
  );
}

function Panel({ title, icon: Icon, children }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {Icon && <Icon className="h-3.5 w-3.5 text-[#00866f]" />}
        {title}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SmallInfo({ label, value, icon: Icon }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-medium text-slate-800">{value}</p>
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
      <span className={strong ? "text-base font-semibold" : "font-medium"}>{money(value)}</span>
    </div>
  );
}
