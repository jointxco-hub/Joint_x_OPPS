import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createOrderProductLineId,
  ensureOrderProductLineIds,
  findDuplicateOrderProductLineIds,
  findInvalidOrderProductLineIds,
  isValidOrderProductLineId,
  OrderProductLineIdError,
} from "../src/lib/orderProductIdentity.js";
import { orderProductKey } from "../src/features/invoices/orderToInvoiceItems.js";

const readSource = async (relativePath) => {
  const text = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return text.replace(/\r\n/g, "\n");
};

// ─── Pure helper: src/lib/orderProductIdentity.js ─────────────────────────

test("isValidOrderProductLineId accepts a real UUID and rejects everything else", () => {
  assert.equal(isValidOrderProductLineId("cccccccc-cccc-4ccc-8ccc-cccccccccccc"), true);
  assert.equal(isValidOrderProductLineId("not-a-uuid"), false);
  assert.equal(isValidOrderProductLineId(""), false);
  assert.equal(isValidOrderProductLineId(undefined), false);
  assert.equal(isValidOrderProductLineId(null), false);
  assert.equal(isValidOrderProductLineId(123), false);
});

test("createOrderProductLineId always produces a real UUID, never a line-${Date.now()} style string", () => {
  const id = createOrderProductLineId();
  assert.equal(isValidOrderProductLineId(id), true);
  assert.doesNotMatch(id, /^line-/);
});

test("ensureOrderProductLineIds: valid UUID line_id is preserved exactly", () => {
  const products = [{ name: "A", line_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }];
  const result = ensureOrderProductLineIds(products);
  assert.equal(result[0].line_id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
});

test("ensureOrderProductLineIds: a product missing line_id gets a fresh valid UUID", () => {
  const products = [{ name: "A" }];
  const result = ensureOrderProductLineIds(products);
  assert.equal(isValidOrderProductLineId(result[0].line_id), true);
});

test("ensureOrderProductLineIds: two lines sharing the same catalog_item_id get two DIFFERENT line_id values", () => {
  const products = [
    { name: "JET XS", catalog_item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", size: "XS" },
    { name: "JET XL", catalog_item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", size: "XL" },
  ];
  const result = ensureOrderProductLineIds(products);
  assert.equal(isValidOrderProductLineId(result[0].line_id), true);
  assert.equal(isValidOrderProductLineId(result[1].line_id), true);
  assert.notEqual(result[0].line_id, result[1].line_id);
});

test("ensureOrderProductLineIds: editing business fields alongside a valid line_id does not require a new id", () => {
  const products = [{ name: "A", quantity: 3, price: 50, line_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }];
  const result = ensureOrderProductLineIds(products);
  assert.equal(result[0].line_id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  assert.equal(result[0].quantity, 3);
  assert.equal(result[0].price, 50);
});

test("ensureOrderProductLineIds: an invalid, non-empty persisted line_id fails closed instead of being silently replaced", () => {
  const products = [{ name: "A", line_id: "not-a-uuid" }];
  assert.throws(() => ensureOrderProductLineIds(products), OrderProductLineIdError);
});

test("findInvalidOrderProductLineIds reports non-UUID, non-empty line_id values", () => {
  const products = [{ name: "A", line_id: "not-a-uuid" }, { name: "B", line_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, { name: "C" }];
  assert.deepEqual(findInvalidOrderProductLineIds(products), ["not-a-uuid"]);
});

test("findDuplicateOrderProductLineIds detects a line_id duplicated within the SAME order", () => {
  const products = [
    { name: "A", line_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
    { name: "B", line_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
  ];
  assert.deepEqual(findDuplicateOrderProductLineIds(products), ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]);
});

test("ensureOrderProductLineIds fails closed on a duplicate valid line_id within one order", () => {
  const products = [
    { name: "A", line_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
    { name: "B", line_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
  ];
  assert.throws(() => ensureOrderProductLineIds(products), OrderProductLineIdError);
});

test("the same line_id UUID may legitimately recur across two DIFFERENT orders (no global uniqueness check)", () => {
  const sharedId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const orderA = [{ name: "A", line_id: sharedId }];
  const orderB = [{ name: "B", line_id: sharedId }];
  assert.deepEqual(findDuplicateOrderProductLineIds(orderA), []);
  assert.deepEqual(findDuplicateOrderProductLineIds(orderB), []);
  assert.doesNotThrow(() => ensureOrderProductLineIds(orderA));
  assert.doesNotThrow(() => ensureOrderProductLineIds(orderB));
});

test("duplicate/size-run rows must each get a fresh, distinct identity (helper-level contract used by ProductsEditor)", () => {
  const firstCopy = createOrderProductLineId();
  const secondCopy = createOrderProductLineId();
  assert.notEqual(firstCopy, secondCopy);
});

// ─── Invoice mapper compatibility (src/features/invoices/orderToInvoiceItems.js) ─

test("orderProductKey still prefers line_id over every other identity field", () => {
  const catalogId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    orderProductKey({ line_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", catalog_item_id: catalogId }),
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  );
});

test("orderProductKey legacy fallback (id -> catalog_item_id -> inventory_item_id) remains for payloads without line_id", () => {
  const catalogId = "11111111-1111-4111-8111-111111111111";
  assert.equal(orderProductKey({ catalog_item_id: catalogId }), catalogId);
  assert.equal(orderProductKey({ name: "No id at all" }), null);
});

let orderToInvoiceItemsSource;
test.before(async () => {
  orderToInvoiceItemsSource = await readSource("src/features/invoices/orderToInvoiceItems.js");
});

test("orderToInvoiceItems.js delegates line-id generation to the shared helper, not an inline non-UUID fallback", () => {
  assert.match(orderToInvoiceItemsSource, /import \{ createOrderProductLineId \} from "\.\.\/\.\.\/lib\/orderProductIdentity\.js"/);
  assert.match(orderToInvoiceItemsSource, /line_id: createOrderProductLineId\(\)/);
  assert.doesNotMatch(orderToInvoiceItemsSource, /line-\$\{Date\.now\(\)/);
});

// ─── ProductsEditor.jsx (React - source-pinned) ────────────────────────────

let productsEditorSource;
test.before(async () => {
  productsEditorSource = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
});

test("ProductsEditor.jsx uses the shared identity helper instead of a local newLineId implementation", () => {
  assert.match(productsEditorSource, /import \{ createOrderProductLineId \} from "@\/lib\/orderProductIdentity"/);
  assert.doesNotMatch(productsEditorSource, /function newLineId/);
  assert.doesNotMatch(productsEditorSource, /line-\$\{Date\.now\(\)/);
});

test("ProductsEditor.jsx: add row, add size run, and duplicate row each assign a fresh line_id", () => {
  const addRowMatch = productsEditorSource.match(/const addRow = \(\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(addRowMatch, "addRow not found");
  assert.match(addRowMatch[0], /line_id: createOrderProductLineId\(\)/);

  const addSizeRunMatch = productsEditorSource.match(/const addSizeRun = \(\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(addSizeRunMatch, "addSizeRun not found");
  assert.match(addSizeRunMatch[0], /line_id: createOrderProductLineId\(\)/);

  const duplicateRowMatch = productsEditorSource.match(/const duplicateRow = \([\s\S]*?\n {2}\};/);
  assert.ok(duplicateRowMatch, "duplicateRow not found");
  assert.match(duplicateRowMatch[0], /line_id: createOrderProductLineId\(\)/);
});

test("ProductsEditor.jsx: editing an existing row (saveRow) never regenerates line_id", () => {
  const saveRowMatch = productsEditorSource.match(/const saveRow = \(\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(saveRowMatch, "saveRow not found");
  assert.doesNotMatch(saveRowMatch[0], /createOrderProductLineId/);
  // editRow never carries line_id (see emptyRow / editingIdx setter), so
  // `{ ...p, ...editRow }` preserves p.line_id untouched.
  assert.match(saveRowMatch[0], /\{ \.\.\.p, \.\.\.editRow, quantity: Number\(editRow\.quantity\) \|\| 1 \}/);
});

test("ProductsEditor.jsx: quantity +/- never regenerates line_id", () => {
  const updateQuantityMatch = productsEditorSource.match(/const updateQuantity = \([\s\S]*?\n {2}\};/);
  assert.ok(updateQuantityMatch, "updateQuantity not found");
  assert.doesNotMatch(updateQuantityMatch[0], /createOrderProductLineId/);
});

// ─── NewOrderDrawer.jsx (React - source-pinned) ────────────────────────────

let newOrderDrawerSource;
test.before(async () => {
  newOrderDrawerSource = await readSource("src/components/orders/NewOrderDrawer.jsx");
});

test("NewOrderDrawer.jsx normalizes products with the shared helper before onCreate", () => {
  assert.match(newOrderDrawerSource, /import \{ ensureOrderProductLineIds \} from "@\/lib\/orderProductIdentity"/);
  assert.match(
    newOrderDrawerSource,
    /products: ensureOrderProductLineIds\(form\.products\.filter\(p => p\.name\.trim\(\)\)\),/
  );
});

test("NewOrderDrawer.jsx: repeat-order copies product details but never carries over the previous order's line_id", () => {
  const normalizeMatch = newOrderDrawerSource.match(/function normalizeRepeatProduct\(product = \{\}\) \{[\s\S]*?\n\}/);
  assert.ok(normalizeMatch, "normalizeRepeatProduct not found");
  assert.doesNotMatch(normalizeMatch[0], /line_id/);
});

// ─── dataClient.js write boundary (source-pinned - Supabase client import) ─

let dataClientSource;
test.before(async () => {
  dataClientSource = await readSource("src/api/dataClient.js");
});

test("dataClient.js Order.serialize normalizes products through the shared helper only when a products array is part of the payload", () => {
  assert.match(dataClientSource, /import \{ ensureOrderProductLineIds \} from '@\/lib\/orderProductIdentity';/);
  assert.match(
    dataClientSource,
    /const sanitizedProducts = rawProducts \? ensureOrderProductLineIds\(rawProducts\) : undefined;/
  );
});

test("dataClient.js Order.serialize does not synthesize a products array when payload.products is undefined and there is no quantity fallback", () => {
  const serializeMatch = dataClientSource.match(/Order: \{[\s\S]*?serialize\(payload\) \{[\s\S]*?\n {4}\},/);
  assert.ok(serializeMatch, "Order.serialize not found");
  assert.match(serializeMatch[0], /: undefined;/);
});

// ─── src/api/supabase/orders.ts (source-pinned - TS + Supabase client) ────

let ordersTsSource;
test.before(async () => {
  ordersTsSource = await readSource("src/api/supabase/orders.ts");
});

test("orders.ts: OrderProduct type carries an optional order-scoped line_id", () => {
  assert.match(ordersTsSource, /interface OrderProduct \{[\s\S]*?line_id\?: string;[\s\S]*?\}/);
});

test("orders.ts: createOrderSupabase and updateOrderSupabase normalize products through the shared helper", () => {
  assert.match(ordersTsSource, /import \{ ensureOrderProductLineIds \} from '@\/lib\/orderProductIdentity';/);
  assert.match(ordersTsSource, /products: ensureOrderProductLineIds\(order\.products \?\? \[\]\),/);
  assert.match(
    ordersTsSource,
    /const normalizedFields = Array\.isArray\(fields\.products\)\s*\n\s*\? \{ \.\.\.fields, products: ensureOrderProductLineIds\(fields\.products\) \}\s*\n\s*: fields;/
  );
});

test("orders.ts: updateOrderSupabase does not touch products when the update payload doesn't include them", () => {
  const updateMatch = ordersTsSource.match(/export async function updateOrderSupabase\([\s\S]*?\n\}/);
  assert.ok(updateMatch, "updateOrderSupabase not found");
  assert.match(updateMatch[0], /: fields;/);
});

// ─── Historical backfill migration (source-pinned SQL) ─────────────────────

let migrationSource;
test.before(async () => {
  migrationSource = await readSource("supabase/migrations/202608100002_order_product_line_identity.sql");
});

test("migration: preflight aborts on an invalid existing line_id, before any update", () => {
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_INVALID_EXISTING_LINE_ID/);
  const invalidCheckIndex = migrationSource.indexOf("ORDER_PRODUCT_LINE_ID_BACKFILL_INVALID_EXISTING_LINE_ID");
  const firstUpdateIndex = migrationSource.indexOf("update public.orders set products");
  assert.ok(invalidCheckIndex > -1 && firstUpdateIndex > -1 && invalidCheckIndex < firstUpdateIndex);
});

test("migration: preflight aborts on a duplicate line_id within the same order", () => {
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_DUPLICATE_LINE_ID/);
});

test("migration: preflight aborts on an ambiguous invoice source-order-item mapping (never guesses)", () => {
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_AMBIGUOUS_INVOICE_MAPPING/);
});

test("migration: preflight aborts on an unmatched historical invoice source", () => {
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_UNMATCHED_INVOICE_SOURCE/);
});

test("migration: preserves an invoice-linked historical fallback id as the backfilled line_id", () => {
  assert.match(
    migrationSource,
    /if v_fallback is not null and exists \([\s\S]*?ii\.source_order_item_id::text = v_fallback[\s\S]*?then\s*\n\s*v_line_id := v_fallback;/
  );
});

test("migration: assigns gen_random_uuid() to ordinary missing lines with no invoice-linked fallback", () => {
  assert.match(migrationSource, /v_line_id := gen_random_uuid\(\)::text;/);
});

test("migration: never writes to opps_invoice_items or opps_invoices", () => {
  assert.doesNotMatch(migrationSource, /update public\.opps_invoice_items/i);
  assert.doesNotMatch(migrationSource, /update public\.opps_invoices/i);
  assert.doesNotMatch(migrationSource, /insert into public\.opps_invoice_items/i);
  assert.doesNotMatch(migrationSource, /insert into public\.opps_invoices/i);
  assert.doesNotMatch(migrationSource, /delete from public\.opps_invoice/i);
});

test("migration: only ever sets the products column on orders (no other order business field is written)", () => {
  const updateStatements = migrationSource.match(/update public\.orders[^;]*;/g) || [];
  assert.ok(updateStatements.length > 0, "expected at least one UPDATE public.orders statement");
  updateStatements.forEach((statement) => {
    assert.match(statement, /^update public\.orders set products = /);
  });
});

test("migration: post-backfill invariants are checked and roll back on failure", () => {
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_MISSING_LINE_ID/);
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_INVALID_LINE_ID/);
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_DUPLICATE_LINE_ID/);
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_LINE_ID_NOT_PRESERVED/);
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_BUSINESS_FIELD_CHANGED/);
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_INVOICE_LINKAGE_BROKEN/);
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_PRODUCT_COUNT_CHANGED/);
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_ORDER_COUNT_CHANGED/);
  assert.match(migrationSource, /ORDER_PRODUCT_LINE_ID_BACKFILL_INVARIANT_INVOICE_ROWS_CHANGED/);
});

test("migration: item-primary-mockup / line image roles are NOT introduced here (that is Phase 1B.3)", () => {
  assert.doesNotMatch(migrationSource, /order_item_assets/);
  assert.doesNotMatch(migrationSource, /item_primary_mockup/);
  assert.doesNotMatch(migrationSource, /primary_mockup_asset_id/);
});
