import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The pure mapping module has no React / network deps, so it imports fine
// under node --test. (@/ alias is only used for invoiceCalculations —
// re-implement the one helper it needs so this stays dependency-free.)
async function loadMapping() {
  const src = await readFile(new URL("../src/features/quotes/quoteProductMapping.js", import.meta.url), "utf8");
  // swap the aliased import for a tiny inline numberOrZero
  const shimmed = src.replace(
    'import { numberOrZero } from "@/features/invoices/invoiceCalculations";',
    "const numberOrZero = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };",
  );
  const mod = `data:text/javascript;base64,${Buffer.from(shimmed).toString("base64")}`;
  return import(mod);
}

const src = (rel) =>
  readFile(new URL(`../${rel}`, import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));

// ── product selection: internal catalogue ──────────────────────────────
test("catalogItemToQuoteLine pulls name / description / rate / image from the canonical product", async () => {
  const { catalogItemToQuoteLine } = await loadMapping();
  const line = catalogItemToQuoteLine({
    id: "prod-1",
    name: "Classic Tee",
    description: "180gsm combed cotton",
    price: 145,
    category: "Apparel",
    images: [{ src: "https://x/tee.png" }],
  });
  assert.equal(line.item_name, "Classic Tee");
  assert.equal(line.item_description, "180gsm combed cotton");
  assert.equal(line.rate, 145);
  assert.equal(line.unit, "ea");
  assert.equal(line.image_url, "https://x/tee.png");
  assert.equal(line.role, "product");
  assert.equal(line._needs_price_review, false);
  assert.equal(line.source_client_product_id, null);
  assert.equal(line.source_metadata.source, "catalog");
  assert.equal(line.source_metadata.catalog_item_id, "prod-1");
});

// ── client-specific pricing ───────────────────────────────────────────
test("clientProductToQuoteLine uses the client-facing name + configured client_price", async () => {
  const { clientProductToQuoteLine } = await loadMapping();
  const line = clientProductToQuoteLine({
    id: "cp-9",
    client_facing_name: "Acme Staff Hoodie",
    internal_name: "hoodie-navy-emb",
    client_price: 380,
    currency: "ZAR",
    status: "client_approved",
    opps_product_id: "prod-77",
    print_method: "Embroidery",
    placement: "Left chest",
    garment_color: "Navy",
    internal_notes: "SECRET supplier note — must never surface",
  });
  assert.equal(line.item_name, "Acme Staff Hoodie");
  assert.equal(line.rate, 380);
  assert.equal(line._needs_price_review, false);
  assert.equal(line.source_client_product_id, "cp-9");
  assert.equal(line.source_metadata.source, "client_product");
  assert.equal(line.source_metadata.base_product_id, "prod-77");
  assert.equal(line.source_metadata.client_product_approved, true);
  assert.match(line.item_description, /Embroidery/);
  assert.match(line.item_description, /Left chest/);
  // internal notes never leak into a customer-facing field or metadata
  assert.doesNotMatch(line.item_description, /SECRET/);
  assert.doesNotMatch(JSON.stringify(line.source_metadata), /SECRET|internal_notes/);
});

// ── missing-price behaviour: never invent a price ─────────────────────
test("a missing / zero configured price yields rate 0 + needs_price_review, never a guess", async () => {
  const { clientProductToQuoteLine, catalogItemToQuoteLine, resolveLineRate } = await loadMapping();

  for (const bad of [null, undefined, 0, -10, ""]) {
    assert.deepEqual(resolveLineRate({ price: bad }), { rate: 0, needsPriceReview: true }, `price=${JSON.stringify(bad)}`);
  }
  assert.deepEqual(resolveLineRate({ price: 250 }), { rate: 250, needsPriceReview: false });

  const cp = clientProductToQuoteLine({ id: "cp-x", client_facing_name: "Unpriced item", status: "client_approved" });
  assert.equal(cp.rate, 0);
  assert.equal(cp._needs_price_review, true);

  const cat = catalogItemToQuoteLine({ id: "p-x", name: "No price product" });
  assert.equal(cat.rate, 0);
  assert.equal(cat._needs_price_review, true);
});

test("requires_quote forces staff review even when a client_price is set", async () => {
  const { clientProductToQuoteLine } = await loadMapping();
  const line = clientProductToQuoteLine({
    id: "cp-rq",
    client_facing_name: "Bespoke jacket",
    client_price: 999,
    requires_quote: true,
    status: "active",
  });
  assert.equal(line.rate, 0);
  assert.equal(line._needs_price_review, true);
  assert.equal(line.source_metadata.requires_quote, true);
});

// ── approval-status detection (no silent substitution) ────────────────
test("isClientProductApproved recognises only the audited approved states; archived is excluded by the picker", async () => {
  const { isClientProductApproved, isClientProductArchived, CLIENT_PRODUCT_APPROVED_STATUSES } = await loadMapping();
  for (const s of ["client_approved", "ready_to_order", "active"]) assert.equal(isClientProductApproved({ status: s }), true, s);
  for (const s of ["draft", "ready_for_client_review", "client_changes_requested", "archived", ""]) {
    assert.equal(isClientProductApproved({ status: s }), false, s);
  }
  assert.equal(isClientProductArchived({ status: "archived" }), true);
  assert.deepEqual([...CLIENT_PRODUCT_APPROVED_STATUSES].sort(), ["active", "client_approved", "ready_to_order"]);
});

// ── no supplier cost / margin / internal data in the snapshot payload ─
test("sanitizeQuoteLineSourceMetadata drops every non-allowlisted key (cost / margin / internal)", async () => {
  const { sanitizeQuoteLineSourceMetadata } = await loadMapping();
  const out = sanitizeQuoteLineSourceMetadata({
    source: "client_product",
    catalog_item_id: "p-1",
    base_product_id: "b-1",
    currency: "ZAR",
    // must all be stripped:
    supplier_cost: 42,
    unit_cost: 42,
    margin: 0.55,
    markup: 1.4,
    internal_notes: "x",
    supplier: "ACME Blanks",
    cost_price: 30,
    profit: 12,
  });
  assert.deepEqual(Object.keys(out).sort(), ["base_product_id", "catalog_item_id", "currency", "source"]);
  for (const banned of ["supplier_cost", "unit_cost", "margin", "markup", "internal_notes", "supplier", "cost_price", "profit"]) {
    assert.equal(banned in out, false, `${banned} leaked`);
  }
});

test("mapper output source_metadata never contains a cost / margin / internal key", async () => {
  const { clientProductToQuoteLine, catalogItemToQuoteLine } = await loadMapping();
  const blob = JSON.stringify([
    clientProductToQuoteLine({ id: "c", client_facing_name: "n", client_price: 10, status: "active", internal_notes: "z", supplier_cost: 5 }),
    catalogItemToQuoteLine({ id: "p", name: "n", price: 10, cost: 4, margin: 0.6 }),
  ]);
  assert.doesNotMatch(blob, /supplier|unit_cost|cost_price|"margin"|markup|profit|internal_notes/);
});

// ── tenant isolation + staff permissions: reuse established entities ──
test("the picker reads via tenant-scoped dataClient entities, never a raw cross-tenant query or new RPC", async () => {
  const picker = await src("src/features/quotes/QuoteProductPicker.jsx");
  assert.match(picker, /dataClient\.entities\.ClientProduct\.filter\(\{ client_id: clientId \}/);
  assert.match(picker, /dataClient\.entities\.CatalogItem\.list\(/);
  assert.doesNotMatch(picker, /supabase\.from\(|\.rpc\(/, "no raw table / RPC access from the picker");
  // dataClient marks both entities tenantScoped
  const dc = await src("src/api/dataClient.js");
  assert.match(dc, /ClientProduct:\s*\{\s*\n\s*table:\s*'client_products',\s*\n\s*tenantScoped:\s*true/);
});

// ── frozen revision snapshot: unchanged Q1 contract ──────────────────
test("save path forwards source_client_product_id + source_metadata to save_opps_quote_with_items", async () => {
  const api = await src("src/api/quotes.js");
  const fn = api.slice(api.indexOf("export async function saveQuoteWithItems"), api.indexOf("\n}\n", api.indexOf("export async function saveQuoteWithItems")));
  assert.match(fn, /source_client_product_id: item\.source_client_product_id \|\| null/);
  assert.match(fn, /source_metadata: Object\.keys\(sourceMetadata\)\.length \? sourceMetadata : undefined/);
  assert.match(fn, /sanitizeQuoteLineSourceMetadata\(item\.source_metadata\)/);
});

test("Q1 snapshot builder still allowlists items — source_metadata / source_client_product_id never copied verbatim into a revision", async () => {
  const mig = await src("supabase/migrations/20260906090000_quotes_q1_canonical_schema.sql");
  const snap = mig.slice(mig.indexOf("build the customer-safe snapshot"), mig.indexOf("into v_snapshot;"));
  // the snapshot item object is a fixed jsonb_build_object with a known key set
  assert.match(snap, /'price_breakdown', public\._quote_item_price_breakdown\(qi\.source_metadata\)/);
  assert.doesNotMatch(snap, /'source_metadata'|'source_client_product_id'/, "raw source fields are not in the snapshot");
  // (the mapping change is frontend-only; this migration is NOT modified)
});

test("QuoteEditor keeps the source linkage through a re-opened quote and passes the client to the picker", async () => {
  const editor = await src("src/features/quotes/QuoteEditor.jsx");
  assert.match(editor, /source_client_product_id: item\.source_client_product_id \|\| null/);
  assert.match(editor, /source_metadata:\s*\n?\s*item\.source_metadata && typeof item\.source_metadata === "object"/);
  assert.match(editor, /<QuoteLineItemsEditor[\s\S]*?clientId=\{state\.customer_id \|\| null\}/);
});

test("the line editor surfaces a visible 'price needs staff review' state and a positive rate clears it", async () => {
  const lie = await src("src/features/quotes/QuoteLineItemsEditor.jsx");
  assert.match(lie, /Price needs staff review/);
  assert.match(lie, /if \(item\._needs_price_review && Number\(e\.target\.value\) > 0\) patch\._needs_price_review = false/);
  assert.match(lie, /Add from catalogue/);
});
