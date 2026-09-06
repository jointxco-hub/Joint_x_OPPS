// ONE responsive commercial-document renderer. Pure presentational HTML/CSS.
// No html2canvas, no jsPDF, no data fetching. OPPS staff view, X LAB account,
// the future public /i/:token route and the future server PDF all render this.
//
// <CommercialDocument kind="invoice" document={model} mode="responsive|document" actions={{onPay,onShare,onDownloadPdf,onPrint}} pdfCapture />
//
// pdfCapture (P4E, document mode only): adds .commercial-doc--pdf-capture.
// Proven root cause (isolated by testing one variable at a time against the
// real markup, not assumed): html2canvas's text layout does not correctly
// compute the line-box baseline when the "once-off" pill badge shares a
// text line with the item name, which measurably shifted Qty/Unit/Total a
// few px below the description column in the exported PDF — CSS Grid vs
// flexbox for the row itself made no difference, so the row layout is
// untouched. The one CSS rule this enables gives that badge its own line
// ONLY inside the capture. Pass pdfCapture ONLY from an offscreen
// html2canvas capture node; never from a print portal — Print was already
// correct and must not change.
//
// Semantic markers for the future paginator: data-doc-block (a section that
// should not split), data-keep-together (a small atomic block), data-line-item,
// data-totals-block. Legacy data-pdf-block kept one release so the current
// invoicePdfBuilder.js / invoicePdf.js do not regress.
//
// CANONICAL SOURCE: Joint_x_OPPS/src/features/commercial-doc/. Synced to
// X LAB by scripts/sync-commercial-doc.mjs — do not edit the X LAB copy.
import React from "react";
import {
  CreditCard, Globe2, Landmark, Mail, MessageCircle, Phone,
  ReceiptText, ShieldCheck, Truck, Download, Printer, Share2, Wallet,
} from "lucide-react";
import { LIFECYCLE_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "./commercialDocumentModel";
import "./commercialDocument.css";

const DEFAULT_TERMS = [
  "Payment confirms the order and allows production to begin. Production starts once payment, artwork, sizing, quantities, and delivery details are confirmed.",
  "Custom and personalised orders are made to order. Returns or refunds are considered only for verified production faults, incorrect items, or defects reported within 7 days of receiving the order.",
  "Colours, garment fit, print placement, and material finish may vary slightly between screens, suppliers, blanks, and production methods.",
  "Courier, PEP/PAXI, pickup, and delivery timelines start after production is complete. Missing artwork, unavailable blanks, client changes, or courier delays may affect completion.",
];

function money(value, currency = "ZAR") {
  const n = Number(value || 0);
  const body = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "ZAR" ? `R${body}` : `${currency} ${body}`;
}
function dateText(value, fallback = "Not set") {
  return value ? String(value).slice(0, 10) : fallback;
}

export default function CommercialDocument({ kind = "invoice", document: model, mode = "responsive", actions = {}, pdfCapture = false, draftPreview = false }) {
  if (!model) return null;
  const documentMode = mode === "document";
  const isQuote = kind === "quote";
  // Quote-only: a working-revision (staff head) preview. The formal
  // customer-facing quote (published revision) NEVER passes this flag.
  const showDraftBanner = isQuote && draftPreview === true;
  const c = model.currency || "ZAR";
  const brand = model.brand || {};
  // The standard legal terms always render; a custom model.terms string (the
  // invoice's own `terms` field, if a staff member set one) is APPENDED, never
  // a silent replacement — so existing invoices keep the same visible terms.
  const terms = [
    ...DEFAULT_TERMS,
    `For current order information and product details, use ${brand.primarySite || "our site"}.${brand.samplePacksSite ? ` For sample packs, use ${brand.samplePacksSite}.` : ""}`,
    ...(typeof model.terms === "string" && model.terms.trim() ? [model.terms.trim()] : []),
  ];
  const lineCount = model.lines.length;

  return (
    <div className={`commercial-doc ${documentMode ? "commercial-doc--document" : "commercial-doc--responsive"} ${documentMode && pdfCapture ? "commercial-doc--pdf-capture" : ""}`}>
      {showDraftBanner ? (
        <div
          role="note"
          data-quote-draft-banner="true"
          style={{
            margin: "0 0 12px", padding: "10px 14px", borderRadius: 10,
            background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a",
            fontWeight: 700, letterSpacing: "0.02em", textAlign: "center",
          }}
        >
          DRAFT — NOT FOR ACCEPTANCE. This is the staff working revision, not the quote sent to the customer.
        </div>
      ) : null}
      <article className="client-invoice commercial-doc__sheet" data-doc-root="true">
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="commercial-doc__header" data-doc-block="true" data-pdf-block="true">
          <div className="commercial-doc__brandcol">
            <div className="invoice-brandline commercial-doc__brandline">
              {brand.logo ? (
                <img src={brand.logo} alt={brand.name} className="commercial-doc__logo"
                     crossOrigin="anonymous"
                     onError={(e) => { e.currentTarget.style.display = "none"; }} />
              ) : null}
              <div className="commercial-doc__brandmeta">
                <p className="commercial-doc__brandname">{brand.name}</p>
                <div className="commercial-doc__contacts">
                  {brand.email ? <InlineContact icon={Mail} value={brand.email} /> : null}
                  {brand.phone ? <InlineContact icon={Phone} value={brand.phone} /> : null}
                  {brand.whatsapp ? <InlineContact icon={MessageCircle} value={`WhatsApp ${brand.whatsapp}`} /> : null}
                  {brand.primarySite ? <InlineContact icon={Globe2} value={brand.primarySite} /> : null}
                  {brand.samplePacksSite ? <InlineContact icon={Globe2} value={`${brand.samplePacksSite} — sample packs`} /> : null}
                </div>
              </div>
            </div>
            <p className="commercial-doc__eyebrow">{kind === "quote" ? "Quote" : "Client invoice"}</p>
            <h1 className="commercial-doc__title">{kind === "quote" ? "Quote" : "Invoice"}</h1>
            <p className="commercial-doc__lede">Order, payment, and delivery details in one clean record.</p>
          </div>

          <aside className="invoice-meta-card commercial-doc__metacard" data-keep-together="true">
            <Meta label={isQuote ? "Quote number" : "Invoice number"} value={model.invoiceNumber} strong />
            <Meta label="Issue date" value={dateText(model.issueDate)} />
            <Meta label={isQuote ? "Valid until" : "Due date"} value={dateText(model.dueDate)} />
            <Meta label="Payment terms" value={model.paymentTerms ?? "Not specified"} />
            {isQuote && model.revisionNumber != null ? (
              <Meta label="Revision" value={`#${model.revisionNumber}${model.isAcceptedRevision ? " · accepted" : ""}`} />
            ) : null}
            <div className="commercial-doc__balancechip">
              <span className="commercial-doc__balancechip-label">{isQuote ? "Quote total" : "Balance due"}</span>
              <span className="commercial-doc__balancechip-value">{money(isQuote ? model.totals.grandTotal : model.totals.balanceDue, c)}</span>
            </div>
            {isQuote
              ? <QuoteStatusRow model={model} />
              : <StatusRow model={model} />}
          </aside>
        </header>

        {/* ── Summary strip (total / paid / balance) ─────────────── */}
        <section className="commercial-doc__summarystrip" data-doc-block="true" data-keep-together="true" data-totals-block="true">
          {isQuote ? (
            <>
              <SummaryStat label="Quote total" value={money(model.totals.grandTotal, c)} accent />
              <SummaryStat label="Valid until" value={dateText(model.dueDate, "On request")} />
              <SummaryStat label="Status" value={model.lifecycleStatusLabel || model.quoteStatus} />
            </>
          ) : (
            <>
              <SummaryStat label="Total" value={money(model.totals.grandTotal, c)} />
              <SummaryStat label="Paid" value={money(model.totals.amountPaid, c)} />
              <SummaryStat label="Balance due" value={money(model.totals.balanceDue, c)} accent />
            </>
          )}
        </section>

        {/* ── Client + reference ────────────────────────────────── */}
        <section className="commercial-doc__cols2" data-doc-block="true" data-pdf-block="true">
          <Panel title={isQuote ? "Quote for" : "Billed to"} icon={ReceiptText}>
            <h2 className="commercial-doc__clientname">{model.customer.name}</h2>
            <div className="commercial-doc__clientlines">
              {model.customer.email ? <p className="commercial-doc__wrap">{model.customer.email}</p> : null}
              {model.customer.phone ? <p>{model.customer.phone}</p> : null}
              {model.customer.billingAddress
                ? <p className="commercial-doc__addr">{model.customer.billingAddress}</p>
                : <p className="commercial-doc__muted">Billing address not supplied</p>}
              {model.customer.shippingAddress
                ? <p className="commercial-doc__addr"><span className="commercial-doc__muted">Ship to: </span>{model.customer.shippingAddress}</p>
                : null}
            </div>
          </Panel>
          <Panel title="Reference" icon={ShieldCheck}>
            <div className="commercial-doc__kvlist">
              <KeyValue label="Reference" value={model.referenceNumber || "Not set"} />
              <KeyValue label="Currency" value={c} />
              {model.salesperson ? <KeyValue label="Salesperson" value={model.salesperson} /> : null}
              <KeyValue label="Support" value={brand.email || "Not configured"} />
            </div>
          </Panel>
        </section>

        {/* ── Delivery & tracking (staff only, when present) ─────── */}
        {model.delivery.length > 0 ? (
          <section className="commercial-doc__delivery" data-doc-block="true" data-pdf-block="true">
            <Panel title="Delivery and tracking" icon={Truck}>
              <div className="commercial-doc__deliverygrid">
                {model.delivery.map((row) => (
                  <div key={row.label} className="commercial-doc__deliverycard" data-keep-together="true">
                    <p className="commercial-doc__deliverylabel">{row.label}</p>
                    <p className="commercial-doc__deliveryvalue">{row.value}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </section>
        ) : null}

        {/* ── Line items ────────────────────────────────────────── */}
        <section className="invoice-items commercial-doc__items">
          <div className="commercial-doc__itemshead" data-doc-block="true">
            <div>
              <p className="commercial-doc__eyebrow-sm">Order items</p>
              <p className="commercial-doc__muted-sm">{lineCount} line item{lineCount === 1 ? "" : "s"}</p>
            </div>
            <div className="commercial-doc__itemstotal">Total {money(model.totals.grandTotal, c)}</div>
          </div>

          <div className="commercial-doc__table">
            <div className="commercial-doc__tablehead" data-doc-block="true" aria-hidden="true">
              <span>Item</span><span>Description</span>
              <span className="commercial-doc__num">Qty</span>
              <span className="commercial-doc__num">Unit</span>
              <span className="commercial-doc__num">Total</span>
            </div>
            <div className="commercial-doc__tablebody">
              {lineCount === 0 ? (
                <p className="commercial-doc__emptyrow">No line items on this {kind}.</p>
              ) : model.lines.map((line) => (
                <div key={line.id} className="invoice-row commercial-doc__row" data-line-item="true" data-doc-block="true" data-pdf-block="true">
                  <div className="commercial-doc__thumb">
                    {line.image
                      ? <img src={line.image} alt="" crossOrigin="anonymous" className="commercial-doc__thumbimg"
                             onError={(e) => { const p = e.currentTarget.parentElement; if (p) p.style.visibility = "hidden"; }} />
                      : <span className="commercial-doc__thumbfallback">Item</span>}
                  </div>
                  <div className="commercial-doc__rowmain">
                    <p className="commercial-doc__rowname">
                      <span className="commercial-doc__rowname-text">{line.name}</span>
                      {line.onceOff ? <span className="commercial-doc__tag">once-off</span> : null}
                    </p>
                    {line.description ? <p className="commercial-doc__rowdesc">{line.description}</p> : null}
                    {line.tax ? (
                      <p className="commercial-doc__rowtax">{line.tax.name}{line.tax.percentage ? ` ${line.tax.percentage}%` : ""}</p>
                    ) : null}
                    {line.priceBreakdown ? <PriceBreakdown breakdown={line.priceBreakdown} currency={c} /> : null}
                  </div>
                  <RowAmount label="Qty" value={`${line.quantity}${line.unit ? ` ${line.unit}` : ""}`} />
                  <RowAmount label="Unit" value={money(line.rate, c)} />
                  <RowAmount label="Total" value={money(line.lineTotal, c)} strong />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Guidance + totals ─────────────────────────────────── */}
        <section className="invoice-summary commercial-doc__summary" data-doc-block="true" data-pdf-block="true">
          <div className="commercial-doc__guidancecol">
            <div className="invoice-guidance-card commercial-doc__guidance" data-keep-together="true">
              <p className="commercial-doc__guidance-title"><CreditCard className="commercial-doc__ic" /> {isQuote ? "Quote guidance" : "Payment guidance"}</p>
              <p className="commercial-doc__guidance-body">
                {isQuote ? (
                  <>
                    Quote <strong>{model.invoiceNumber}</strong>{model.dueDate ? <> is valid until <strong>{dateText(model.dueDate)}</strong></> : null}.
                    {brand.email ? <> Reply to <strong>{brand.email}</strong> to accept or request changes.</> : null}
                  </>
                ) : (
                  <>
                    Use <strong>{model.invoiceNumber}</strong> as your payment reference.
                    {brand.email ? <> Send proof of payment to <strong>{brand.email}</strong>.</> : null}
                  </>
                )}
              </p>
            </div>
            {model.paymentInstructions ? (
              <div className="invoice-banking-card commercial-doc__banking" data-keep-together="true">
                <p className="commercial-doc__banking-title"><Landmark className="commercial-doc__ic" /> Banking details</p>
                <p className="commercial-doc__banking-body">{model.paymentInstructions}</p>
              </div>
            ) : null}
          </div>

          <div className="invoice-summary-card commercial-doc__totals" data-totals-block="true" data-keep-together="true">
            <TotalRow label="Subtotal" value={money(model.totals.subtotal, c)} />
            {model.totals.setupFees > 0 ? <TotalRow label="Setup / once-off" value={money(model.totals.setupFees, c)} memo /> : null}
            {model.totals.discount !== 0 ? <TotalRow label="Discount" value={`- ${money(model.totals.discount, c)}`} /> : null}
            {model.totals.shipping !== 0 ? <TotalRow label="Shipping" value={money(model.totals.shipping, c)} /> : null}
            {model.totals.tax !== 0 ? <TotalRow label="Tax" value={money(model.totals.tax, c)} /> : null}
            {model.totals.adjustment !== 0 ? <TotalRow label="Adjustment" value={money(model.totals.adjustment, c)} /> : null}
            <div className="commercial-doc__totalsrule" />
            <TotalRow label="Total" value={money(model.totals.grandTotal, c)} strong />
            {isQuote ? (
              <div className="commercial-doc__balancebox">
                <span>Quote total</span>
                <span className="commercial-doc__balancebox-value">{money(model.totals.grandTotal, c)}</span>
              </div>
            ) : (
              <>
                <TotalRow label="Paid" value={money(model.totals.amountPaid, c)} />
                <div className="commercial-doc__balancebox">
                  <span>Balance due</span>
                  <span className="commercial-doc__balancebox-value">{money(model.totals.balanceDue, c)}</span>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── Payment history ───────────────────────────────────── */}
        {model.paymentHistory.length > 0 ? (
          <section className="commercial-doc__history" data-doc-block="true" data-pdf-block="true">
            <p className="commercial-doc__eyebrow-sm">Payment history</p>
            <ul className="commercial-doc__historylist">
              {model.paymentHistory.map((p, i) => (
                <li key={i} className="commercial-doc__historyrow" data-keep-together="true">
                  <span>{dateText(p.paidAt, "—")}</span>
                  <span className="commercial-doc__muted">{[p.method, p.reference].filter(Boolean).join(" · ") || "Payment"}</span>
                  <span className="commercial-doc__num commercial-doc__strong">{money(p.amount, c)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ── Terms ─────────────────────────────────────────────── */}
        <section className="commercial-doc__terms" data-doc-block="true" data-pdf-block="true">
          <p className="commercial-doc__eyebrow-sm">Terms and conditions</p>
          <ol className="invoice-terms commercial-doc__termslist">
            {terms.map((term, i) => (
              <li key={i} className="commercial-doc__termsitem">
                <span className="commercial-doc__termsnum">{i + 1}.</span><span>{term}</span>
              </li>
            ))}
          </ol>
          {model.footerNote ? <p className="commercial-doc__termsnote commercial-doc__wrap">{model.footerNote}</p> : null}
        </section>

        <footer className="commercial-doc__footer" data-doc-block="true">
          <p className="commercial-doc__wrap">Thank you for choosing {brand.name}.</p>
          <p className="commercial-doc__wrap">{[brand.primarySite, brand.samplePacksSite].filter(Boolean).join(" / ")}</p>
        </footer>
      </article>

      {/* ── Actions shell — screen only. Document/A4 mode is exclusively
          the print/PDF capture surface, so the buttons are never rendered
          into it at all (not just CSS-hidden — html2canvas rasterizes the
          live DOM regardless of @media print, so a CSS-only hide would
          still bake the buttons into the exported image). ── */}
      {!documentMode ? <DocumentActions actions={actions} model={model} /> : null}
    </div>
  );
}

// ── sub-components ───────────────────────────────────────────────────────
function StatusRow({ model }) {
  const pay = PAYMENT_STATUS_LABEL[model.paymentStatus] || model.paymentStatus;
  const life = LIFECYCLE_STATUS_LABEL[model.lifecycleStatus] || model.lifecycleStatus;
  return (
    <div className="commercial-doc__statusrow" data-keep-together="true">
      <div className="commercial-doc__status">
        <span className="commercial-doc__status-label">Payment status</span>
        <span className={`commercial-doc__status-value commercial-doc__status--${model.paymentStatus}`}>
          <span aria-hidden="true" className="commercial-doc__status-dot" /> {pay}
          {model.overdue ? <span className="commercial-doc__overdue"> · Overdue</span> : null}
        </span>
      </div>
      <div className="commercial-doc__status">
        <span className="commercial-doc__status-label">Document status</span>
        <span className="commercial-doc__status-value">{life}</span>
      </div>
    </div>
  );
}

function QuoteStatusRow({ model }) {
  return (
    <div className="commercial-doc__statusrow" data-keep-together="true">
      <div className="commercial-doc__status">
        <span className="commercial-doc__status-label">Quote status</span>
        <span className="commercial-doc__status-value">{model.lifecycleStatusLabel || model.quoteStatus}</span>
      </div>
      {model.revisionNumber != null ? (
        <div className="commercial-doc__status">
          <span className="commercial-doc__status-label">Revision</span>
          <span className="commercial-doc__status-value">
            #{model.revisionNumber}{model.isAcceptedRevision ? " · accepted" : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function DocumentActions({ actions, model }) {
  // P6: "Pay R{balance_due}" — the model already carries the P1A-derived
  // balance (model.totals.balanceDue), so the amount shown here is always
  // the same server-derived number the payment itself will charge; this
  // component never invents or accepts a different one. actions.payLabel
  // lets a caller override it transiently (e.g. "Redirecting…" while the
  // PayFast handoff is in flight) without changing what gets charged.
  const payLabel = actions.payLabel || `Pay ${money(model.totals.balanceDue, model.currency)}`;
  const items = [
    { key: "pay", label: payLabel, icon: Wallet, fn: actions.onPay, primary: true,
      show: model.paymentStatus !== "paid" && model.lifecycleStatus !== "void" && typeof actions.onPay === "function" },
    { key: "share", label: "Share", icon: Share2, fn: actions.onShare, show: typeof actions.onShare === "function" },
    // P5A: pdfLabel lets a caller name this action for what it actually
    // does on the current device (e.g. "Save PDF" where the handler routes
    // through the OS share sheet instead of a plain download — see
    // src/lib/deviceCapabilities.js in X LAB) without this component
    // knowing anything about platform detection itself.
    { key: "pdf", label: actions.pdfLabel || "PDF", icon: Download, fn: actions.onDownloadPdf, show: typeof actions.onDownloadPdf === "function" },
    { key: "print", label: "Print", icon: Printer, fn: actions.onPrint, show: typeof actions.onPrint === "function" },
  ].filter((a) => a.show);
  if (items.length === 0) return null;
  return (
    <div className="commercial-doc__actions" role="group" aria-label="Invoice actions" data-doc-actions="true">
      {items.map((a) => {
        const Icon = a.icon;
        return (
          <button key={a.key} type="button" onClick={a.fn}
                  className={`commercial-doc__action ${a.primary ? "commercial-doc__action--primary" : ""}`}>
            <Icon className="commercial-doc__ic" aria-hidden="true" /> <span>{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function InlineContact({ icon: Icon, value }) {
  return (
    <p className="commercial-doc__contact">
      <Icon className="commercial-doc__ic-sm" aria-hidden="true" />
      <span className="commercial-doc__wrap">{value}</span>
    </p>
  );
}
function Panel({ title, icon: Icon, children }) {
  return (
    <div className="invoice-panel commercial-doc__panel">
      <p className="commercial-doc__panel-title">{Icon ? <Icon className="commercial-doc__ic" aria-hidden="true" /> : null}{title}</p>
      <div className="commercial-doc__panel-body">{children}</div>
    </div>
  );
}
function KeyValue({ label, value }) {
  return (
    <div className="commercial-doc__kv">
      <span className="commercial-doc__kv-label">{label}</span>
      <span className="commercial-doc__kv-value commercial-doc__wrap">{value}</span>
    </div>
  );
}
function Meta({ label, value, strong = false }) {
  return (
    <div className="commercial-doc__meta">
      <span className="commercial-doc__meta-label">{label}</span>
      <span className={`commercial-doc__meta-value commercial-doc__wrap ${strong ? "commercial-doc__strong" : ""}`}>{value}</span>
    </div>
  );
}
function SummaryStat({ label, value, accent = false }) {
  return (
    <div className={`commercial-doc__stat ${accent ? "commercial-doc__stat--accent" : ""}`}>
      <span className="commercial-doc__stat-label">{label}</span>
      <span className="commercial-doc__stat-value commercial-doc__wrap">{value}</span>
    </div>
  );
}
function TotalRow({ label, value, strong = false, memo = false }) {
  return (
    <div className={`commercial-doc__totalrow ${memo ? "commercial-doc__totalrow--memo" : ""}`}>
      <span className={strong ? "commercial-doc__strong" : ""}>{label}</span>
      <span className={`commercial-doc__num commercial-doc__wrap ${strong ? "commercial-doc__strong" : ""}`}>{value}</span>
    </div>
  );
}
function RowAmount({ label, value, strong = false }) {
  return (
    <div className="commercial-doc__rowamount">
      <span className="commercial-doc__rowamount-label" aria-hidden="true">{label}</span>
      <span className={`commercial-doc__wrap ${strong ? "commercial-doc__strong" : "commercial-doc__muted"}`}>{value}</span>
    </div>
  );
}
function PriceBreakdown({ breakdown, currency }) {
  return (
    <div className="commercial-doc__breakdown" data-keep-together="true">
      <p className="commercial-doc__breakdown-title">Price breakdown</p>
      <ul className="commercial-doc__breakdown-list">
        {breakdown.perUnit.map((row, i) => (
          <li key={i} className="commercial-doc__breakdown-row">
            <span className="commercial-doc__wrap">{row.label}</span>
            <span className="commercial-doc__num">{money(row.amount, currency)} / item</span>
          </li>
        ))}
      </ul>
      {breakdown.reconciled === false && breakdown.unitPrice != null ? (
        <p className="commercial-doc__breakdown-note">Agreed price {money(breakdown.unitPrice, currency)} / item.</p>
      ) : null}
    </div>
  );
}
