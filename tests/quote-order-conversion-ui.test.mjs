import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

// Frontend wiring for Quote -> Order Phase 1 (the DB/RPC side is covered by
// quote-order-conversion.test.mjs). Static-source-text checks, mirroring
// the convention in quotes-q2-5.test.mjs's "API wiring" / "drawer UI"
// sections.

test("quotes.js: convertQuoteToOrder hits convert_quote_to_order RPC and maps the RPC's own error codes", async () => {
  const s = await src("src/api/quotes.js");
  assert.ok(s.includes('supabase.rpc("convert_quote_to_order", { p_quote_id: quoteId })'));
  for (const code of [
    "QUOTE_ORDER_FINANCE_PERMISSION_REQUIRED", "QUOTE_NOT_FOUND", "QUOTE_TENANT_ACCESS_DENIED",
    "QUOTE_NOT_CONVERTIBLE", "QUOTE_NO_ACCEPTED_SNAPSHOT", "QUOTE_ACCEPTED_SNAPSHOT_MISSING",
    "QUOTE_SNAPSHOT_EMPTY_ITEMS",
  ]) {
    assert.ok(s.includes(code), `error map is missing ${code}`);
  }
  // still no direct quote/order table writes introduced by this export
  const fn = s.match(/export async function convertQuoteToOrder[\s\S]*?\n\}/)[0];
  assert.ok(!/\.from\(["'](opps_quote|orders)/.test(fn), "conversion goes through the RPC only, never a direct table write");
  assert.ok(fn.includes("data?.ok") && fn.includes("data?.order_id"), "validates the RPC returned a real order before resolving");
});

test("QuoteDetailDrawer: Create Order shown only for an accepted quote with no order yet; View Order once converted_order_id is set", async () => {
  const s = await src("src/features/quotes/QuoteDetailDrawer.jsx");
  assert.ok(s.includes('const canCreateOrder = status === "accepted" && !convertedOrderId;'));
  assert.ok(s.includes("onConvertToOrder") && s.includes("onViewOrder"));
  assert.ok(s.includes('{isConvertingToOrder ? "Creating order..." : "Create Order"}'));
  assert.ok(s.includes("View Order"));
  // never a second Create Order once an order exists
  assert.ok(/convertedOrderId \?[\s\S]{0,400}View Order/.test(s));
});

test("Quotes.jsx: ?open= deep-link, convert mutation, and View Order navigates to /Orders?open=<id>", async () => {
  const s = await src("src/pages/Quotes.jsx");
  assert.ok(s.includes('const linkedQuoteId = searchParams.get("open");'));
  assert.ok(s.includes("convertQuoteToOrder") && s.includes("convertToOrderMutation"));
  assert.ok(s.includes('navigate(`/Orders?open=${orderId}`)'), "View Order reuses Orders.jsx's existing ?open= deep-link, no new route needed");
  // does not duplicate quotes.js's own error mapping
  assert.ok(!/QUOTE_NOT_CONVERTIBLE.*:/.test(s), "error copy lives once, in quotes.js — the page only reads error.message");
});

test("InvoicesTab (order drawer): shows quote provenance and links back to /Quotes?open=<source_quote_id>", async () => {
  const s = await src("src/components/orders/drawer/InvoicesTab.jsx");
  assert.ok(s.includes("order?.source_quote_id"));
  assert.ok(s.includes('/Quotes?open=${encodeURIComponent(order.source_quote_id)}'));
});

test("OrderLinkPanel (invoice drawer): surfaces the linked order's source quote, never a new direct invoice->quote FK", async () => {
  const s = await src("src/features/invoices/OrderLinkPanel.jsx");
  assert.ok(s.includes("linkedOrderQuery.data?.source_quote_id"));
  assert.ok(s.includes('/Quotes?open=${encodeURIComponent(linkedOrderQuery.data.source_quote_id)}'));
  // traverses via the already-linked order — does not query opps_quotes directly
  assert.ok(!/from\(["']opps_quotes/.test(s));
});
