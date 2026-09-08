// ONE customer-safe commercial-document model. Pure, no I/O, no React.
//
// buildInvoiceDocumentModel() takes either shape of invoice row and returns
// the single normalized model <CommercialDocument> renders — OPPS staff,
// X LAB account, and (later) the public /i/:token route and server PDF all
// go through this. Quotes will get a sibling buildQuoteDocumentModel().
//
// It NEVER surfaces: supplier/component cost, margin, component_id /
// source_product_component_id, procurement, internal_notes, admin metadata,
// tenant internals, account_name, raw source_metadata.
//
// CANONICAL SOURCE: Joint_x_OPPS/src/features/commercial-doc/. Synced to
// X LAB by scripts/sync-commercial-doc.mjs — do not edit the X LAB copy.

export const LINE_ROLES = ["product", "addon", "setup_fee", "shipping", "discount", "breakdown"];

const INTERNAL_LINE_KEYS = new Set([
  "source_metadata", "account_name", "catalog_item_id", "inventory_item_id",
  "invoice_item_template_id", "tenant_id", "invoice_id", "source_order_item_id",
  "line_key", "specifications", "proofs",
]);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function round2(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}
function firstNonEmpty(...values) {
  for (const v of values) if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  return "";
}
function isHttp(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}
function dateOnly(value) {
  return value ? String(value).slice(0, 10) : null;
}

// ── line role ────────────────────────────────────────────────────────────
// Prefer an explicit role; then source_metadata.line_role / breakdown_role;
// then infer setup/shipping from the name. Everything else is 'product'.
export function resolveLineRole(item = {}) {
  const explicit = firstNonEmpty(
    item.role,
    item.line_role,
    item.source_metadata && item.source_metadata.line_role,
    item.breakdown_role,
    item.source_metadata && item.source_metadata.breakdown_role,
  );
  if (explicit && LINE_ROLES.includes(String(explicit))) return String(explicit);
  const name = String(item.item_name || item.name || "").toLowerCase();
  if (/\b(setup|set-up|once[- ]?off|artwork setup)\b/.test(name)) return "setup_fee";
  if (/\b(shipping|delivery|courier|paxi|postage)\b/.test(name)) return "shipping";
  return "product";
}

// ── informational per-unit price breakdown (composed Client Products) ─────
// Accepts OPPS shape (item.source_metadata.price_breakdown) and X LAB shape
// (item.price_breakdown, already customer-safe from get_my_invoices). Label +
// amount + method/placement only. NEVER changes any total.
export function normalizePriceBreakdown(item = {}) {
  const pb = (item.price_breakdown && typeof item.price_breakdown === "object" && item.price_breakdown)
    || (item.source_metadata && item.source_metadata.price_breakdown)
    || null;
  if (!pb || pb.mode !== "composed") return null;
  const perUnit = (Array.isArray(pb.per_unit) ? pb.per_unit : [])
    .map((row) => ({
      label: String(row?.label ?? row?.role ?? "Item"),
      role: row?.role ?? null,
      amount: round2(row?.amount),
      method: row?.production_method ?? row?.method ?? null,
      placement: row?.placement ?? null,
    }))
    .filter((row) => row.label);
  if (perUnit.length === 0) return null;
  return {
    perUnit,
    reconciled: pb.reconciled === true ? true : pb.reconciled === false ? false : null,
    difference: typeof pb.difference === "number" ? pb.difference : null,
    unitPrice: typeof pb.unit_price === "number" ? pb.unit_price : null,
  };
}

// ── derived payment state (client-side fallback until an RPC returns it) ──
export function deriveInvoiceStatuses(source = {}) {
  const total = round2(source.total);
  // prefer canonical fields if a P1A-aware RPC provided them
  const paid = source.payment_status || source.amount_paid != null || source.balance_due != null
    ? round2(source.amount_paid)
    : round2(source.amount_paid);
  const balance = source.balance_due != null
    ? Math.max(round2(source.balance_due), 0)
    : Math.max(round2(total - paid), 0);

  const rawStatus = String(source.status || "").toLowerCase();
  const lifecycleStatus =
    rawStatus === "void" ? "void"
    : rawStatus === "draft" ? "draft"
    : ["approved", "exported", "imported_to_zoho", "sent"].includes(rawStatus) ? "issued"
    : rawStatus === "" ? "draft"
    : "issued";

  const paymentStatus = source.payment_status
    ? String(source.payment_status)
    : rawStatus === "void" ? "void"
    : paid <= 0 ? "unpaid"
    : paid < total ? "partial"
    : "paid";

  const dueDate = dateOnly(source.due_date);
  const overdue = source.overdue != null
    ? Boolean(source.overdue)
    : Boolean(dueDate && new Date(dueDate) < new Date(new Date().toISOString().slice(0, 10)) && balance > 0 && paymentStatus !== "paid" && lifecycleStatus !== "void");

  return { total, amountPaid: paid, balanceDue: balance, lifecycleStatus, paymentStatus, overdue };
}

export const PAYMENT_STATUS_LABEL = {
  unpaid: "Awaiting payment",
  partial: "Partially paid",
  paid: "Paid",
  void: "Void",
};
export const LIFECYCLE_STATUS_LABEL = {
  draft: "Draft",
  issued: "Issued",
  void: "Void",
};

/**
 * @param {object} source        one invoice row: get_my_invoices() shape OR
 *                               the OPPS getInvoice()+items shape.
 * @param {object} [opts]
 * @param {'customer'|'staff'} [opts.audience='customer']
 * @param {object} [opts.brand]  { name, email, phone, whatsapp, primarySite, samplePacksSite, logo }
 * @param {string} [opts.paymentInstructions]
 * @param {object} [opts.order]  OPPS staff: linked order for the delivery/tracking strip
 * @param {(item:object)=>string} [opts.resolveImage]  staff: turn a private ref into a plain https URL
 * @returns {object} the normalized document model
 */
export function buildInvoiceDocumentModel(source = {}, opts = {}) {
  const audience = opts.audience === "staff" ? "staff" : "customer";
  const s = source || {};
  const st = deriveInvoiceStatuses(s);
  const resolveImage = typeof opts.resolveImage === "function" ? opts.resolveImage : (v) => v;

  const rawItems = Array.isArray(s.items) ? s.items : [];
  const lines = rawItems
    .map((item, index) => {
      const role = resolveLineRole(item);
      const quantity = num(item.quantity ?? item.qty);
      const rate = round2(item.rate ?? item.unit_price ?? item.price);
      const lineTotal = round2(
        item.item_total ?? item.line_total ?? item.lineTotal ?? quantity * rate,
      );
      const imageRef = resolveImage(item.image_url || item.thumbnail_url || "");
      return {
        id: String(item.id ?? item.line_number ?? index),
        role,
        name: String(item.item_name ?? item.name ?? "Item"),
        description: firstNonEmpty(item.item_description, item.description) || null,
        quantity,
        unit: firstNonEmpty(item.unit) || null,
        rate,
        discount: round2(item.discount),
        tax: item.tax_name || item.tax_percentage
          ? { name: firstNonEmpty(item.tax_name) || "Tax", percentage: num(item.tax_percentage) }
          : null,
        lineTotal,
        onceOff: role === "setup_fee",
        image: isHttp(imageRef) ? imageRef : null,
        priceBreakdown: normalizePriceBreakdown(item),
      };
    })
    .filter((line) => line.role !== "breakdown"); // informational-only rows never render as a billable line

  const setupFees = round2(lines.filter((l) => l.role === "setup_fee").reduce((a, l) => a + l.lineTotal, 0));

  const totals = {
    subtotal: round2(s.subtotal),
    discount: round2(s.discount_total),
    setupFees,
    shipping: round2(s.shipping_charge),
    tax: round2(s.tax_total),
    adjustment: round2(s.adjustment),
    grandTotal: st.total,
    amountPaid: st.amountPaid,
    balanceDue: st.balanceDue,
  };

  const order = opts.order || null;
  const delivery = audience === "staff" && order
    ? [
        ["Courier", order.courier],
        ["PEP / PAXI code", order.pep_code],
        ["Tracking", order.tracking_number || order.tracking_code],
        ["Delivery note", order.delivery_note],
      ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
        .map(([label, value]) => ({ label, value: String(value) }))
    : [];

  return {
    kind: "invoice",
    id: s.id ?? null,
    invoiceNumber: firstNonEmpty(s.invoice_number) || "—",
    lifecycleStatus: st.lifecycleStatus,
    paymentStatus: st.paymentStatus,
    overdue: st.overdue,
    issueDate: dateOnly(s.invoice_date),
    dueDate: dateOnly(s.due_date),
    currency: firstNonEmpty(s.currency_code) || "ZAR",
    referenceNumber: firstNonEmpty(s.reference_number, order && order.order_number) || null,
    salesperson: audience === "staff" ? (firstNonEmpty(s.salesperson_name) || null) : null,
    paymentTerms: firstNonEmpty(s.payment_terms) || "Due on receipt",
    notes: audience === "staff" ? (firstNonEmpty(s.notes) || null) : null,
    terms: firstNonEmpty(s.terms) || null,
    paymentInstructions: firstNonEmpty(opts.paymentInstructions) || null,
    customer: {
      name: firstNonEmpty(s.customer_name) || "—",
      email: audience === "staff" ? (firstNonEmpty(s.customer_email) || null) : null,
      phone: audience === "staff" ? (firstNonEmpty(s.customer_phone) || null) : null,
      billingAddress: firstNonEmpty(s.customer_billing_address) || null,
      // P3: the customer's own delivery address is no more sensitive than
      // their billing address — both audiences see it. Courier/tracking
      // detail stays staff-only via `delivery` below.
      shippingAddress: firstNonEmpty(s.shipping_address) || null,
    },
    lines,
    totals,
    delivery,
    paymentHistory: Array.isArray(s.payment_history || s.payments)
      ? (s.payment_history || s.payments).map((p) => ({
          amount: round2(p.amount),
          paidAt: dateOnly(p.paid_at || p.date),
          method: firstNonEmpty(p.method) || null,
          reference: firstNonEmpty(p.reference) || null,
        }))
      : [],
    brand: {
      name: firstNonEmpty(opts.brand && opts.brand.name) || "JointX",
      email: firstNonEmpty(opts.brand && opts.brand.email) || "jointx.co@gmail.com",
      phone: firstNonEmpty(opts.brand && opts.brand.phone) || "+27 7453 4646",
      whatsapp: firstNonEmpty(opts.brand && opts.brand.whatsapp) || "+27 7453 4646",
      primarySite: firstNonEmpty(opts.brand && opts.brand.primarySite) || "xlab.jointx.co.za",
      samplePacksSite: firstNonEmpty(opts.brand && opts.brand.samplePacksSite) || "x1.jointx.co.za",
      logo: firstNonEmpty(opts.brand && opts.brand.logo) || "/icon.svg",
    },
  };
}

// ── quote model ─────────────────────────────────────────────────────────
// Sibling of buildInvoiceDocumentModel for kind="quote". Consumes the
// customer-safe quote shape (_quote_document_projection() output, or the
// equivalent assembled from a revision snapshot — see
// Joint_x_OPPS/src/api/quotes.js getQuoteDocument()). It has NO access to
// opps_quotes/opps_quote_items internals: no tenant_id, customer_id,
// customer_email/phone, staff notes, source_client_product_id, raw
// source_metadata, cost, margin, supplier or procurement fields. A quote
// is never paid, so there is no paid / balance-due / payment-history
// concept — grandTotal is the amount, full stop.
const QUOTE_STATUS_LABEL = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  changes_requested: "Changes requested",
  declined: "Declined",
  expired: "Expired",
  converted: "Converted",
};

/**
 * @param {object} source  a customer-safe quote document (see above).
 * @param {object} [opts]   { brand, paymentInstructions }
 * @returns {object} the normalized quote model <CommercialDocument kind="quote"> renders
 */
export function buildQuoteDocumentModel(source = {}, opts = {}) {
  const s = source || {};
  const currency = firstNonEmpty(s.currency_code) || "ZAR";

  const rawItems = Array.isArray(s.items) ? s.items : [];
  const lines = rawItems
    .map((item, index) => {
      const role = resolveLineRole(item);
      const quantity = num(item.quantity ?? item.qty);
      const rate = round2(item.rate ?? item.unit_price ?? item.price);
      const lineTotal = round2(item.item_total ?? item.line_total ?? item.lineTotal ?? quantity * rate);
      return {
        id: String(item.line_number ?? item.id ?? index),
        role,
        name: String(item.item_name ?? item.name ?? "Item"),
        description: firstNonEmpty(item.item_description, item.description) || null,
        quantity,
        unit: firstNonEmpty(item.unit) || null,
        rate,
        discount: round2(item.discount),
        tax: item.tax_name || item.tax_percentage
          ? { name: firstNonEmpty(item.tax_name) || "Tax", percentage: num(item.tax_percentage) }
          : null,
        lineTotal,
        onceOff: role === "setup_fee",
        image: isHttp(item.image_url) ? item.image_url : null,
        priceBreakdown: normalizePriceBreakdown(item),
      };
    })
    .filter((line) => line.role !== "breakdown");

  const setupFees = round2(lines.filter((l) => l.role === "setup_fee").reduce((a, l) => a + l.lineTotal, 0));
  const grandTotal = round2(s.total);

  const rawStatus = String(s.status || "draft").toLowerCase();

  return {
    kind: "quote",
    id: s.id ?? null,
    invoiceNumber: firstNonEmpty(s.quote_number) || "—",   // shared meta slot → renders as "Quote number"
    lifecycleStatus: rawStatus,
    lifecycleStatusLabel: QUOTE_STATUS_LABEL[rawStatus] || rawStatus.replace(/_/g, " "),
    quoteStatus: rawStatus,
    revisionNumber: s.revision_number != null ? Number(s.revision_number) : null,
    isAcceptedRevision: Boolean(s.is_accepted_revision),
    acceptedAt: dateOnly(s.accepted_at),
    // a quote has no payment concept — these are inert for the renderer
    paymentStatus: "quote",
    overdue: false,
    issueDate: dateOnly(s.created_date || s.issue_date),
    dueDate: dateOnly(s.valid_until),   // shared "due date" slot → renders as "Valid until" for quotes
    validUntil: dateOnly(s.valid_until),
    currency,
    referenceNumber: firstNonEmpty(s.reference_number) || null,
    salesperson: null,
    // No fabricated fallback: the revision snapshot is the sole authority
    // for payment terms. A hardcoded "Valid for 14 days" here previously
    // masked the real (empty) value and could contradict validUntil.
    paymentTerms: firstNonEmpty(s.payment_terms) || null,
    notes: null,   // staff notes never enter a customer preview
    terms: firstNonEmpty(s.terms) || null,
    paymentInstructions: firstNonEmpty(opts.paymentInstructions) || null,
    customer: {
      name: firstNonEmpty(s.customer_name) || "—",
      email: null,
      phone: null,
      billingAddress: firstNonEmpty(s.customer_billing_address) || null,
      shippingAddress: firstNonEmpty(s.shipping_address) || null,
    },
    lines,
    totals: {
      subtotal: round2(s.subtotal),
      discount: round2(s.discount_total),
      setupFees,
      shipping: round2(s.shipping_charge),
      tax: round2(s.tax_total),
      adjustment: 0,
      grandTotal,
      amountPaid: 0,
      balanceDue: grandTotal,
    },
    delivery: [],
    paymentHistory: [],
    brand: {
      name: firstNonEmpty(opts.brand && opts.brand.name) || "JointX",
      email: firstNonEmpty(opts.brand && opts.brand.email) || "jointx.co@gmail.com",
      phone: firstNonEmpty(opts.brand && opts.brand.phone) || "+27 7453 4646",
      whatsapp: firstNonEmpty(opts.brand && opts.brand.whatsapp) || "+27 7453 4646",
      primarySite: firstNonEmpty(opts.brand && opts.brand.primarySite) || "xlab.jointx.co.za",
      samplePacksSite: firstNonEmpty(opts.brand && opts.brand.samplePacksSite) || "x1.jointx.co.za",
      logo: firstNonEmpty(opts.brand && opts.brand.logo) || "/icon.svg",
    },
  };
}

// Belt-and-braces: assert no internal key leaked into a line (used by tests).
export function assertNoInternalLeak(model) {
  for (const line of model.lines || []) {
    for (const key of Object.keys(line)) {
      if (INTERNAL_LINE_KEYS.has(key)) throw new Error(`internal key leaked into line: ${key}`);
    }
    if (line.priceBreakdown) {
      const s = JSON.stringify(line.priceBreakdown);
      if (/component_id|unit_cost|cost|margin|supplier|procurement/i.test(s)) {
        throw new Error("internal financials leaked into priceBreakdown");
      }
    }
  }
  return true;
}
