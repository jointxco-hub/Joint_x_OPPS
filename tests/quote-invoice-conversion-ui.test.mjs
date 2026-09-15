import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

// Frontend wiring for Quote -> Invoice direct conversion (the second
// Phase 1 path). Static-source-text checks, mirroring the convention in
// quote-order-conversion-ui.test.mjs.

test("quotes.js: convertQuoteToInvoice hits convert_quote_to_invoice RPC and maps the RPC's own error codes", async () => {
  const s = await src("src/api/quotes.js");
  assert.ok(s.includes('supabase.rpc("convert_quote_to_invoice", { p_quote_id: quoteId })'));
  for (const code of [
    "QUOTE_INVOICE_FINANCE_PERMISSION_REQUIRED", "QUOTE_NOT_FOUND", "QUOTE_TENANT_ACCESS_DENIED",
    "QUOTE_ORDER_ALREADY_EXISTS", "QUOTE_NOT_CONVERTIBLE", "QUOTE_NO_ACCEPTED_SNAPSHOT",
    "QUOTE_ACCEPTED_SNAPSHOT_MISSING", "QUOTE_SNAPSHOT_EMPTY_ITEMS",
  ]) {
    assert.ok(s.includes(code), `error map is missing ${code}`);
  }
  const fn = s.match(/export async function convertQuoteToInvoice[\s\S]*?\n\}/)[0];
  assert.ok(!/\.from\(["'](opps_invoice|opps_quote|orders)/.test(fn), "conversion goes through the RPC only, never a direct table write");
  assert.ok(fn.includes("data?.ok") && fn.includes("data?.invoice_id"), "validates the RPC returned a real invoice before resolving");
});

test("quotes.js: converted_invoice_id is part of the shared quote projection (list + detail agree)", async () => {
  const s = await src("src/api/quotes.js");
  assert.ok(s.includes('"converted_invoice_id"'));
});

test("QuoteDetailDrawer: Create Order and Create Invoice are independent — all four combinations possible", async () => {
  const s = await src("src/features/quotes/QuoteDetailDrawer.jsx");
  assert.ok(s.includes('const canCreateOrder = status === "accepted" && !convertedOrderId;'));
  assert.ok(s.includes('const canCreateInvoice = status === "accepted" && !convertedInvoiceId;'));
  assert.ok(s.includes("onConvertToInvoice") && s.includes("onViewInvoice"));
  assert.ok(s.includes('{isConvertingToInvoice ? "Creating invoice..." : "Create Invoice"}'));
  assert.ok(s.includes("View Invoice"));
  // paid-invoice-no-order banner
  assert.ok(s.includes('const invoicePaidNoOrder = Boolean(convertedInvoiceId) && !convertedOrderId && linkedInvoiceStatus?.status === "paid";'));
  assert.ok(/Paid — ready to create order/.test(s));
});

test("QuoteDetailDrawer: activity log disambiguates 'converted' events between order and direct-invoice conversion", async () => {
  const s = await src("src/features/quotes/QuoteDetailDrawer.jsx");
  assert.ok(s.includes('ev?.metadata?.conversion_type === "direct_invoice"'));
  assert.ok(s.includes('"Converted to invoice"'));
  assert.ok(s.includes("eventLabel(ev)"), "render call uses the disambiguating helper, not the raw EVENT_LABELS lookup");
});

test("Quotes.jsx: Create Invoice dispatches to the existing order when one exists, direct RPC otherwise — never orphan-invoices an order-bearing quote", async () => {
  const s = await src("src/pages/Quotes.jsx");
  assert.ok(s.includes("convertQuoteToInvoice") && s.includes("convertToInvoiceMutation"));
  const dispatch = s.match(/const handleCreateInvoiceFromQuote[\s\S]*?\n  \};/)[0];
  assert.ok(dispatch.includes("quote?.converted_order_id") && dispatch.includes("navigate(`/Orders?open="), "order-bearing quote is routed to the order, not the direct RPC");
  assert.ok(dispatch.includes("convertToInvoiceMutation.mutate(quote)"));
  assert.ok(s.includes("linkedInvoiceStatusQuery") && s.includes("!detailQuery.data?.converted_order_id"), "paid-banner query only fires with no order yet");
});

test("InvoiceDetailDrawer / OrderLinkPanel: a direct quote invoice with no order shows Source: Quote + Create Order, dispatched through the existing convert_quote_to_order RPC", async () => {
  const panel = await src("src/features/invoices/OrderLinkPanel.jsx");
  assert.ok(panel.includes("invoice?.source_quote_id") && panel.includes("!invoice?.source_order_id"));
  assert.ok(panel.includes("onCreateOrderFromQuote"));
  assert.ok(panel.includes('/Quotes?open=${encodeURIComponent(invoice.source_quote_id)}'));

  const invoicesPage = await src("src/pages/Invoices.jsx");
  assert.ok(invoicesPage.includes("createOrderFromQuoteMutation"));
  assert.ok(invoicesPage.includes("convertQuoteToOrder(quoteId)"), "reuses the SAME RPC the quote drawer's own Create Order calls — no parallel mechanism");
  assert.ok(invoicesPage.includes('navigate(`/Orders?open=${result.order_id}`)'));
});
