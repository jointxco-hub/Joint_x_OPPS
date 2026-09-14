import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const SECTION = "src/components/clients/ClientProductsSection.jsx";
const API = "src/api/xosClientProduct.js";

// CLIENT PRODUCT PRICING CONFIGURATION — the staff-facing "why is this
// unit R250?" pricing preview panel.

test("1 · getClientProductPriceComposition calls the canonical preview RPC, never re-implements composition client-side", async () => {
  const src_ = await src(API);
  const start = src_.indexOf("export async function getClientProductPriceComposition");
  const end = src_.indexOf("\n}", start);
  const body = src_.slice(start, end);
  assert.match(body, /supabase\.rpc\("admin_get_client_product_price_composition"/);
  assert.match(body, /p_client_product_id:\s*clientProductId/);
});

test("2 · the two new compose-RPC price-gate error codes are mapped to staff-facing copy", async () => {
  const src_ = await src(API);
  assert.match(src_, /XOS_CP_REQUIRES_QUOTE/);
  assert.match(src_, /XOS_CP_PRICE_UNRESOLVED/);
});

test("3 · ClientProductPriceComposition never computes a sell price from anything except the RPC's own breakdown fields — no second pricing engine in the UI", async () => {
  const sectionSrc = await src(SECTION);
  const start = sectionSrc.indexOf("function ClientProductPriceComposition(");
  const end = sectionSrc.indexOf("\nfunction Section(", start);
  const body = sectionSrc.slice(start, end);
  assert.match(body, /getClientProductPriceComposition\(\{ clientProductId: product\.id \}\)/);
  // the only arithmetic performed client-side is summing the amounts the
  // server already returned per component - never a fresh price lookup
  assert.match(body, /breakdown\.per_unit\.reduce\(/);
  assert.doesNotMatch(body, /default_sell_price|product_components/, "must read only the RPC's jsonb shape, never query product_components directly");
});

test("4 · requires_quote is checked before rendering any composed breakdown", async () => {
  const sectionSrc = await src(SECTION);
  const start = sectionSrc.indexOf("function ClientProductPriceComposition(");
  const end = sectionSrc.indexOf("\nfunction Section(", start);
  const body = sectionSrc.slice(start, end);
  const requiresQuoteAt = body.indexOf("result.requires_quote");
  const breakdownAt = body.indexOf("const breakdown = result.breakdown");
  assert.ok(requiresQuoteAt > -1 && breakdownAt > -1 && requiresQuoteAt < breakdownAt);
});

test("5 · unresolved components render a distinct, visible warning rather than being silently omitted", async () => {
  const sectionSrc = await src(SECTION);
  const start = sectionSrc.indexOf("function ClientProductPriceComposition(");
  const end = sectionSrc.indexOf("\nfunction Section(", start);
  const body = sectionSrc.slice(start, end);
  assert.match(body, /unresolved\.length > 0/);
  assert.match(body, /has no sell price set/);
});

test("6 · a reconciliation mismatch (saved client_price vs calculated sum) is surfaced, not silently hidden", async () => {
  const sectionSrc = await src(SECTION);
  const start = sectionSrc.indexOf("function ClientProductPriceComposition(");
  const end = sectionSrc.indexOf("\nfunction Section(", start);
  const body = sectionSrc.slice(start, end);
  assert.match(body, /breakdown\.reconciled === false/);
});

test("7 · the preview panel is wired into the existing Pricing preview Section, not a new/competing tab", async () => {
  const sectionSrc = await src(SECTION);
  const sectionBlockStart = sectionSrc.indexOf('<Section title="Pricing preview"');
  const sectionBlockEnd = sectionSrc.indexOf("</Section>", sectionBlockStart);
  const block = sectionSrc.slice(sectionBlockStart, sectionBlockEnd);
  assert.match(block, /<ClientProductPriceComposition product={product} \/>/);
});
