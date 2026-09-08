import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildQuoteDocumentModel,
  buildInvoiceDocumentModel,
  assertNoInternalLeak,
} from "../src/features/commercial-doc/commercialDocumentModel.js";
import {
  isQuoteEditable,
  NON_EDITABLE_QUOTE_STATUSES,
  HAS_QUOTE_SEND_TRANSITION,
  QUOTE_STATUSES,
} from "../src/features/quotes/quoteStatus.js";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

// The staging Q1 fixture: QT-2026-000002, current rev #2, total R1,595
// (JET T-Shirt 5×155, DTF Printing 5×140, shipping 120), rev1 was R1,645.
const QUOTE_DOC = {
  id: "q-1",
  quote_number: "QT-2026-000002",
  status: "draft",
  currency_code: "ZAR",
  valid_until: "2026-10-06",
  created_date: "2026-09-06",
  payment_terms: "50% deposit",
  reference_number: "Autumn drop",
  terms: "Quote valid 14 days.",
  customer_name: "Acme Streetwear",
  customer_billing_address: "1 Long St, Cape Town",
  shipping_address: "Unit 4, Maitland",
  subtotal: 1475,
  discount_total: 0,
  shipping_charge: 120,
  tax_total: 0,
  total: 1595,
  revision_number: 2,
  is_accepted_revision: false,
  accepted_at: null,
  items: [
    { line_number: 1, role: "product", item_name: "JET T-Shirt", quantity: 5, rate: 155, discount: 0, tax_percentage: 0, item_total: 775 },
    { line_number: 2, role: "product", item_name: "DTF Printing", quantity: 5, rate: 140, discount: 0, tax_percentage: 0, item_total: 700 },
  ],
};

// ── model ──────────────────────────────────────────────────────────────
test("buildQuoteDocumentModel produces a kind='quote' model with the fixture numbers", () => {
  const m = buildQuoteDocumentModel(QUOTE_DOC);
  assert.equal(m.kind, "quote");
  assert.equal(m.invoiceNumber, "QT-2026-000002");
  assert.equal(m.revisionNumber, 2);
  assert.equal(m.validUntil, "2026-10-06");
  assert.equal(m.totals.grandTotal, 1595);
  assert.equal(m.totals.subtotal, 1475);
  assert.equal(m.totals.shipping, 120);
  assert.equal(m.lines.length, 2);
  assert.equal(m.lines[0].name, "JET T-Shirt");
  assert.equal(m.lines[1].lineTotal, 700);
  // a quote is never paid
  assert.equal(m.totals.amountPaid, 0);
  assert.equal(m.totals.balanceDue, 1595);
  assert.deepEqual(m.paymentHistory, []);
});

test("quote model strips every internal / financial field", () => {
  const m = buildQuoteDocumentModel({
    ...QUOTE_DOC,
    // things a caller might accidentally pass through — must not appear
    tenant_id: "t-1",
    customer_id: "c-1",
    customer_email: "buyer@acme.test",
    customer_phone: "0821234567",
    notes: "INTERNAL: chase deposit",
    source_client_product_id: "cp-1",
    items: QUOTE_DOC.items.map((it) => ({
      ...it,
      source_metadata: { unit_cost: 40, margin: 0.6, supplier: "ACME" },
      source_client_product_id: "cp-9",
    })),
  });
  const json = JSON.stringify(m);
  for (const leak of ["tenant_id", "customer_id", "customer_email", "buyer@acme.test",
                      "0821234567", "source_metadata", "source_client_product_id", "unit_cost",
                      '"margin"', "supplier", "chase deposit", "INTERNAL"]) {
    assert.ok(!json.includes(leak), `quote model leaked ${leak}`);
  }
  assert.equal(m.customer.email, null);
  assert.equal(m.customer.phone, null);
  assert.equal(m.notes, null);
  assert.doesNotThrow(() => assertNoInternalLeak(m));
});

test("composed price_breakdown is projected label/amount only, no cost/margin", () => {
  const m = buildQuoteDocumentModel({
    ...QUOTE_DOC,
    items: [{
      ...QUOTE_DOC.items[0],
      price_breakdown: {
        mode: "composed",
        unit_price: 155,
        reconciled: true,
        per_unit: [
          { label: "Blank", role: "blank", amount: 90, unit_cost: 55, production_method: "stock" },
          { label: "Print", role: "print", amount: 65, margin: 0.4, production_method: "DTF", placement: "front" },
        ],
      },
    }, QUOTE_DOC.items[1]],
  });
  const pb = m.lines[0].priceBreakdown;
  assert.ok(pb && pb.perUnit.length === 2);
  const s = JSON.stringify(pb);
  assert.ok(!/unit_cost|margin|supplier|procurement/i.test(s), "price breakdown leaked an internal key");
  assert.equal(pb.perUnit[0].amount, 90);
});

test("invoice renderer parity: buildInvoiceDocumentModel is unchanged for a paid invoice fixture", () => {
  const inv = {
    id: "inv-1", invoice_number: "OPPS-INV-2026-0009", status: "paid",
    invoice_date: "2026-09-01", due_date: "2026-09-15", currency_code: "ZAR",
    customer_name: "Lazi", customer_email: "lazi@example.com",
    subtotal: 2800, discount_total: 0, shipping_charge: 120, adjustment: 0, tax_total: 0,
    total: 2920, amount_paid: 2920, balance_due: 0,
    items: [{ line_number: 1, item_name: "JET T-Shirt", quantity: 10, rate: 280, item_total: 2800 }],
  };
  const m = buildInvoiceDocumentModel(inv, { audience: "customer" });
  assert.equal(m.kind, "invoice");
  assert.equal(m.paymentStatus, "paid");
  assert.equal(m.totals.balanceDue, 0);
  assert.equal(m.totals.amountPaid, 2920);
  // the quote additions never bleed into the invoice model
  assert.equal(m.revisionNumber, undefined);
  assert.equal(m.quoteStatus, undefined);
});

// ── status rules ───────────────────────────────────────────────────────
test("accepted / converted / declined quotes are not editable; everything else is", () => {
  assert.deepEqual([...NON_EDITABLE_QUOTE_STATUSES].sort(), ["accepted", "converted", "declined"]);
  for (const s of ["draft", "sent", "viewed", "changes_requested", "expired"]) {
    assert.equal(isQuoteEditable(s), true, `${s} should be editable`);
  }
  for (const s of ["accepted", "converted", "declined"]) {
    assert.equal(isQuoteEditable(s), false, `${s} must be read-only`);
  }
  assert.deepEqual(QUOTE_STATUSES, [
    "draft", "sent", "viewed", "accepted", "changes_requested", "declined", "expired", "converted",
  ]);
});

// Q2.5 amends this: the send transition now exists (public.mark_quote_sent).
// The drawer still writes NO status directly — the publish/status change is
// server-side inside mark_quote_sent.
test("Q2.5: the drawer publishes only through mark_quote_sent, never a direct status write", async () => {
  assert.equal(HAS_QUOTE_SEND_TRANSITION, true);
  const drawer = await src("src/features/quotes/QuoteDetailDrawer.jsx");
  assert.ok(drawer.includes("onSend?.(quote)"), "Send calls the onSend handler (-> markQuoteSent)");
  assert.ok(!/\.update\(\{[^}]*status|supabase\.rpc\(/.test(drawer), "drawer never itself writes status or calls an RPC");
});

// ── API: the only writes are canonical RPCs ──────────────────────────
// Q1/Q2.5: save_opps_quote_with_items + mark_quote_sent.
// Q3.1: the three public-share RPCs (issue_quote / rotate_quote_share_token
//       / revoke_quote_share). Still NEVER a direct opps_quote* table write.
test("quotes.js writes ONLY through canonical RPCs — never a direct table write", async () => {
  const s = await src("src/api/quotes.js");
  assert.ok(s.includes('supabase.rpc("save_opps_quote_with_items"'), "save routes through the Q1 RPC");
  assert.ok(s.includes('supabase.rpc("mark_quote_sent"'), "publish routes through the Q2.5 RPC");
  assert.ok(!/\.from\("opps_quote[s_a-z]*"\)\s*\.\s*(insert|update|delete|upsert)/.test(s),
    "no direct insert/update/delete/upsert on opps_quote* tables");
  const rpcCalls = [...new Set(s.match(/supabase\.rpc\("[a-z_]+"/g) || [])].sort();
  assert.deepEqual(rpcCalls, [
    'supabase.rpc("issue_quote"',
    'supabase.rpc("mark_quote_sent"',
    'supabase.rpc("revoke_quote_share"',
    'supabase.rpc("rotate_quote_share_token"',
    'supabase.rpc("save_opps_quote_with_items"',
  ], "the ONLY rpcs this module calls are the Q1/Q2.5 save+send and the Q3.1 canonical share RPCs");
});

test("saveQuoteWithItems passes the Q1 7-arg contract incl. optimistic lock + item-count guard", async () => {
  const s = await src("src/api/quotes.js");
  const fn = s.match(/export async function saveQuoteWithItems[\s\S]*?\n\}/)[0];
  for (const p of ["p_tenant_id", "p_quote_id", "p_quote", "p_items",
                   "p_expected_updated_at", "p_expected_item_count", "p_allow_total_override"]) {
    assert.ok(fn.includes(p), `save passes ${p}`);
  }
  assert.ok(fn.includes("input.id ? (input.expected_updated_at || null) : null"), "optimistic lock only on update");
  assert.ok(fn.includes("input.id ? Number(input.expected_item_count ?? 0) : null"), "item-count guard only on update");
  assert.ok(fn.includes("QUOTE_SAVE_ERROR_MESSAGES") || s.includes("QUOTE_SAVE_ERROR_MESSAGES"), "maps QUOTE_* errors");
  assert.ok(s.includes("QUOTE_NOT_EDITABLE") && s.includes("QUOTE_STALE_VERSION") && s.includes("QUOTE_TOTAL_MISMATCH"),
    "the friendly error map covers the Q1 rejection codes");
});

test("create-from-request links source_request_id ONLY on the create path and never actions the request", async () => {
  const s = await src("src/api/quotes.js");
  const save = s.match(/export async function saveQuoteWithItems[\s\S]*?\n\}/)[0];
  assert.ok(save.includes("source_request_id: input.id ? undefined : (input.source_request_id || null)"),
    "source_request_id is sent only when creating (input.id is null)");
  const draft = s.match(/export function quoteDraftFromClientRequest[\s\S]*?\n\}/)[0];
  assert.ok(!/update_internal_client_request_status|approve_client_quote_request|_activate_client_quote_request_order|create_checkout_order/.test(draft),
    "building the draft never touches request-status / order-activation RPCs");
  assert.ok(draft.includes("id: null"), "the draft is always an unsaved create");
  // request text lands in the STAFF notes field, not a customer-visible one
  assert.ok(/notes: detailLines/.test(draft), "client request details go into internal notes");
});

// ── list mapping ───────────────────────────────────────────────────────
test("listQuotes: default sort = updated_at desc; maps revision number + source-request + converted flags", async () => {
  const s = await src("src/api/quotes.js");
  const fn = s.match(/export async function listQuotes[\s\S]*?\n\}/)[0];
  assert.ok(fn.includes('.order(options.sortBy || "updated_at", { ascending: options.ascending === true })'),
    "default order is updated_at, descending");
  assert.ok(fn.includes("const currentNo = revisionNumberById[row.current_revision_id] ?? null;") &&
            fn.includes("current_revision_number: currentNo"), "maps current revision number");
  assert.ok(fn.includes("has_source_request: Boolean(row.source_request_id)"), "maps source-request indicator");
  assert.ok(fn.includes("is_converted: Boolean(row.converted_order_id)"), "maps converted flag");
  assert.ok(fn.includes('.eq("tenant_id", tenantId)'), "tenant-scoped");
  assert.ok(fn.includes('query.ilike("quote_number"') && fn.includes('query.ilike("customer_name"'),
    "quote-number search + customer search filters");
});

test("listQuoteRevisions maps total from totals.total and orders newest first (read-only history)", async () => {
  const s = await src("src/api/quotes.js");
  const fn = s.match(/export async function listQuoteRevisions[\s\S]*?\n\}/)[0];
  assert.ok(fn.includes('.order("revision_number", { ascending: false })'), "newest revision first");
  assert.ok(fn.includes("total: Number(r?.totals?.total ?? 0)"), "total derived from the frozen totals jsonb");
  assert.ok(!/insert|update|delete|rpc\(/.test(fn), "revision history is a pure read");
});

// ── route + nav ────────────────────────────────────────────────────────
test("Quotes page is registered and reachable from the finance-gated nav", async () => {
  const pages = await src("src/pages.config.js");
  assert.ok(pages.includes("const Quotes = lazy(() => import('./pages/Quotes'))"), "lazy import added");
  assert.ok(pages.includes('"Quotes": Quotes,'), "PAGES entry added");
  const layout = await src("src/Layout.jsx");
  assert.ok(layout.includes('{ name: "Quotes", page: "Quotes", icon: FileText, financeOnly: true },'),
    "nav entry added under the same financeOnly gate as Invoices");
});

// ── mobile / tap targets ───────────────────────────────────────────────
test("quote editor + line editor + drawer use >=44px (h-11) mobile tap targets", async () => {
  for (const [file, needles] of [
    ["src/features/quotes/QuoteLineItemsEditor.jsx", ["h-11 w-11", "h-11 rounded-xl"]],
    ["src/features/quotes/QuoteEditor.jsx", ["h-11 rounded-xl"]],
    ["src/features/quotes/QuoteDetailDrawer.jsx", ["h-11 rounded-xl", "h-11 w-11 rounded-xl"]],
  ]) {
    const s = await src(file);
    for (const n of needles) assert.ok(s.includes(n), `${file} has a ${n} tap target`);
  }
});

test("QuoteDetailDrawer reuses the accepted drawer primitive, not a bespoke one", async () => {
  const raw = await src("src/features/quotes/QuoteDetailDrawer.jsx");
  const s = raw.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n"); // executable code only
  assert.ok(s.includes('from "@/components/ui/drawer"'), "uses the shared Drawer");
  assert.ok(s.includes("max-h-[92vh] max-w-4xl"), "same size language as InvoiceDetailDrawer");
  assert.ok(s.includes('kind="quote"') && s.includes("buildQuoteDocumentModel"), "preview renders through the canonical CommercialDocument");
  // no invoice-only actions wired
  assert.ok(!/onMarkPaid|onMarkExported|markInvoiceExported|invoice_payments|apply_invoice_payfast|issue_invoice\(|rotate_invoice_share_token/.test(s),
    "no invoice payment / export / share actions leak into the quote drawer");
});
