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
  requireOrderProductLineIds,
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

// ─── requireOrderProductLineIds (UPDATE boundary - never generates) ──────

test("requireOrderProductLineIds: all-valid, non-duplicate line_ids succeed and are preserved exactly", () => {
  const products = [
    { name: "A", line_id: "44444444-4444-4444-8444-444444444444" },
    { name: "B", line_id: "66666666-6666-4666-8666-666666666666" },
  ];
  const result = requireOrderProductLineIds(products);
  assert.equal(result[0].line_id, "44444444-4444-4444-8444-444444444444");
  assert.equal(result[1].line_id, "66666666-6666-4666-8666-666666666666");
});

test("requireOrderProductLineIds: a missing line_id fails closed instead of being generated", () => {
  const products = [{ name: "A", line_id: "44444444-4444-4444-8444-444444444444" }, { name: "B" }];
  assert.throws(() => requireOrderProductLineIds(products), OrderProductLineIdError);
});

test("requireOrderProductLineIds: an invalid non-UUID line_id fails closed", () => {
  const products = [{ name: "A", line_id: "not-a-uuid" }];
  assert.throws(() => requireOrderProductLineIds(products), OrderProductLineIdError);
});

test("requireOrderProductLineIds: a same-order duplicate fails closed", () => {
  const products = [
    { name: "A", line_id: "44444444-4444-4444-8444-444444444444" },
    { name: "B", line_id: "44444444-4444-4444-8444-444444444444" },
  ];
  assert.throws(() => requireOrderProductLineIds(products), OrderProductLineIdError);
});

test("requireOrderProductLineIds never generates a new id even when one is missing (unlike ensureOrderProductLineIds)", () => {
  const products = [{ name: "A" }];
  assert.throws(() => requireOrderProductLineIds(products));
  // ensureOrderProductLineIds, by contrast, is fine with the same input.
  assert.doesNotThrow(() => ensureOrderProductLineIds(products));
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

test("dataClient.js imports both insert-may-generate and update-must-require helpers", () => {
  assert.match(
    dataClientSource,
    /import \{ ensureOrderProductLineIds, requireOrderProductLineIds \} from '@\/lib\/orderProductIdentity';/
  );
});

test("dataClient.js runInsert/runUpdate tag the operation so Order.serialize can tell INSERT from UPDATE", () => {
  assert.match(dataClientSource, /const record = entityConfig\.serialize\(payload, \{ operation: 'insert' \}\);/);
  assert.match(dataClientSource, /const record = entityConfig\.serialize\(payload, \{ operation: 'update' \}\);/);
});

test("dataClient.js Order.serialize: INSERT may generate missing line_ids, UPDATE (and any other/unspecified operation) must require them", () => {
  const serializeMatch = dataClientSource.match(/Order: \{[\s\S]*?serialize\(payload, context = \{\}\) \{[\s\S]*?\n {4}\},/);
  assert.ok(serializeMatch, "Order.serialize not found");
  assert.match(
    serializeMatch[0],
    /const sanitizedProducts = !rawProducts\s*\n\s*\? undefined\s*\n\s*: context\.operation === 'insert'\s*\n\s*\? ensureOrderProductLineIds\(rawProducts\)\s*\n\s*: requireOrderProductLineIds\(rawProducts\);/
  );
});

test("dataClient.js Order.serialize does not synthesize a products array when payload.products is undefined and there is no quantity fallback", () => {
  const serializeMatch = dataClientSource.match(/Order: \{[\s\S]*?serialize\(payload, context = \{\}\) \{[\s\S]*?\n {4}\},/);
  assert.ok(serializeMatch, "Order.serialize not found");
  assert.match(serializeMatch[0], /const sanitizedProducts = !rawProducts\s*\n\s*\? undefined/);
});

// ─── src/api/supabase/orders.ts (source-pinned - TS + Supabase client) ────

let ordersTsSource;
test.before(async () => {
  ordersTsSource = await readSource("src/api/supabase/orders.ts");
});

test("orders.ts: OrderProduct type carries an optional order-scoped line_id", () => {
  assert.match(ordersTsSource, /interface OrderProduct \{[\s\S]*?line_id\?: string;[\s\S]*?\}/);
});

test("orders.ts: imports both insert-may-generate and update-must-require helpers", () => {
  assert.match(
    ordersTsSource,
    /import \{ ensureOrderProductLineIds, requireOrderProductLineIds \} from '@\/lib\/orderProductIdentity';/
  );
});

test("orders.ts: createOrderSupabase (CREATE) may generate missing line_ids", () => {
  const createMatch = ordersTsSource.match(/export async function createOrderSupabase\([\s\S]*?\n\}/);
  assert.ok(createMatch, "createOrderSupabase not found");
  assert.match(createMatch[0], /products: ensureOrderProductLineIds\(order\.products \?\? \[\]\),/);
  assert.doesNotMatch(createMatch[0], /requireOrderProductLineIds/);
});

test("orders.ts: updateOrderSupabase (UPDATE) requires existing valid line_ids and never generates", () => {
  const updateMatch = ordersTsSource.match(/export async function updateOrderSupabase\([\s\S]*?\n\}/);
  assert.ok(updateMatch, "updateOrderSupabase not found");
  assert.match(
    updateMatch[0],
    /const normalizedFields = Array\.isArray\(fields\.products\)\s*\n\s*\? \{ \.\.\.fields, products: requireOrderProductLineIds\(fields\.products\) \}\s*\n\s*: fields;/
  );
  assert.doesNotMatch(updateMatch[0], /ensureOrderProductLineIds/);
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

test("migration: SQL legacy fallback priority validates each candidate as UUID-shaped, mirroring uuidOrEmpty() exactly (not a bare coalesce of non-empty strings)", () => {
  // A bare coalesce(nullif(id,''), nullif(catalog_item_id,''), ...) would
  // let a non-UUID, non-empty product.id (free text) hide a later valid
  // catalog_item_id instead of falling through to it - each candidate must
  // be validated as UUID-shaped BEFORE being accepted, in priority order.
  assert.doesNotMatch(migrationSource, /coalesce\(\s*\n\s*nullif\(elem/);
  assert.doesNotMatch(migrationSource, /coalesce\(\s*\n\s*nullif\(v_elem/);
  const fallbackFnMatch = migrationSource.match(/create function pg_temp\.order_product_fallback_key\(elem jsonb\)[\s\S]*?\$fn\$;/);
  assert.ok(fallbackFnMatch, "pg_temp.order_product_fallback_key not found");
  const fn = fallbackFnMatch[0];
  const idIdx = fn.indexOf("elem ->> 'id'");
  const catalogIdx = fn.indexOf("elem ->> 'catalog_item_id'");
  const inventoryIdx = fn.indexOf("elem ->> 'inventory_item_id'");
  assert.ok(idIdx > -1 && catalogIdx > -1 && inventoryIdx > -1 && idIdx < catalogIdx && catalogIdx < inventoryIdx);
  // Every candidate branch validates UUID-shape before accepting it.
  const uuidRe = "\\^\\[0-9a-f\\]\\{8\\}-\\[0-9a-f\\]\\{4\\}-\\[1-5\\]\\[0-9a-f\\]\\{3\\}-\\[89ab\\]\\[0-9a-f\\]\\{3\\}-\\[0-9a-f\\]\\{12\\}\\$";
  assert.match(fn, new RegExp(`nullif\\(elem ->> 'id', ''\\) ~\\* '${uuidRe}'`));
  assert.match(fn, new RegExp(`nullif\\(elem ->> 'catalog_item_id', ''\\) ~\\* '${uuidRe}'`));
  assert.match(fn, new RegExp(`nullif\\(elem ->> 'inventory_item_id', ''\\) ~\\* '${uuidRe}'`));
});

test("migration: pg_temp fallback-key helper is session-scoped, never a permanent schema object", () => {
  assert.match(migrationSource, /create function pg_temp\.order_product_fallback_key/);
  assert.doesNotMatch(migrationSource, /create (or replace )?function public\.order_product_fallback_key/);
});

// ─── Permanent DB identity boundary (source-pinned SQL) ────────────────────

test("migration: creates a permanent trigger that is the final DB authority for line identity, added only after the historical backfill's DO block", () => {
  const doBlockEndIndex = migrationSource.indexOf("end $$;");
  const triggerFnIndex = migrationSource.indexOf("create or replace function public.enforce_order_product_line_identity()");
  assert.ok(doBlockEndIndex > -1 && triggerFnIndex > -1 && doBlockEndIndex < triggerFnIndex);
  assert.match(migrationSource, /before insert or update of products\s*\n\s*on public\.orders\s*\n\s*for each row execute function public\.enforce_order_product_line_identity\(\);/);
});

test("migration: trigger INSERT branch generates a missing line_id with gen_random_uuid(), retrying until unique within the new row's array", () => {
  const fnMatch = migrationSource.match(/create or replace function public\.enforce_order_product_line_identity\(\)[\s\S]*?\nend;\n\$\$;/);
  assert.ok(fnMatch, "enforce_order_product_line_identity function not found");
  const fn = fnMatch[0];
  assert.match(fn, /if tg_op = 'INSERT' then\s*\n\s*loop\s*\n\s*v_line_id := gen_random_uuid\(\)::text;\s*\n\s*exit when not \(v_line_id = any\(v_seen_ids\)\);/);
});

test("migration: trigger rejects an invalid (non-UUID) non-empty line_id on both INSERT and UPDATE", () => {
  const fnMatch = migrationSource.match(/create or replace function public\.enforce_order_product_line_identity\(\)[\s\S]*?\nend;\n\$\$;/);
  const fn = fnMatch[0];
  assert.match(fn, /if v_line_id is not null and v_line_id !~\* v_uuid_re then\s*\n\s*raise exception using errcode = 'P0001', message = 'ORDER_PRODUCT_LINE_ID_INVALID';/);
});

test("migration: trigger rejects a duplicate line_id within the same (new) products array", () => {
  const fnMatch = migrationSource.match(/create or replace function public\.enforce_order_product_line_identity\(\)[\s\S]*?\nend;\n\$\$;/);
  const fn = fnMatch[0];
  assert.match(fn, /elsif v_line_id = any\(v_seen_ids\) then\s*\n\s*raise exception using errcode = 'P0001', message = 'ORDER_PRODUCT_LINE_ID_DUPLICATE_IN_ORDER';/);
});

test("migration: trigger UPDATE branch never generates - a missing line_id fails closed with ORDER_PRODUCT_LINE_ID_REQUIRED_ON_UPDATE", () => {
  const fnMatch = migrationSource.match(/create or replace function public\.enforce_order_product_line_identity\(\)[\s\S]*?\nend;\n\$\$;/);
  const fn = fnMatch[0];
  assert.match(fn, /else\s*\n\s*raise exception using errcode = 'P0001', message = 'ORDER_PRODUCT_LINE_ID_REQUIRED_ON_UPDATE';/);
  // The only place gen_random_uuid() is called inside the trigger is
  // guarded by tg_op = 'INSERT' above - the update path never reaches it.
  const insertBranchIndex = fn.indexOf("if tg_op = 'INSERT' then");
  const updateRejectIndex = fn.indexOf("ORDER_PRODUCT_LINE_ID_REQUIRED_ON_UPDATE");
  assert.ok(insertBranchIndex > -1 && updateRejectIndex > insertBranchIndex);
});

test("migration: trigger preserves valid existing line_ids on UPDATE untouched - no unconditional rewrite of NEW.products for already-valid rows", () => {
  const fnMatch = migrationSource.match(/create or replace function public\.enforce_order_product_line_identity\(\)[\s\S]*?\nend;\n\$\$;/);
  const fn = fnMatch[0];
  // A row whose line_id is already valid falls through both the
  // "is null" and "invalid" branches untouched, and is appended to
  // v_new_products exactly as read from NEW.products (v_elem is never
  // reassigned outside the INSERT-generates branch).
  assert.match(fn, /v_new_products := v_new_products \|\| jsonb_build_array\(v_elem\);/);
});

test("migration: trigger fails closed on a non-array or non-object products shape", () => {
  const fnMatch = migrationSource.match(/create or replace function public\.enforce_order_product_line_identity\(\)[\s\S]*?\nend;\n\$\$;/);
  const fn = fnMatch[0];
  assert.match(fn, /ORDER_PRODUCT_LINE_ID_PRODUCTS_MUST_BE_ARRAY/);
  assert.match(fn, /ORDER_PRODUCT_LINE_ID_ENTRY_MUST_BE_OBJECT/);
});

test("migration: trigger allows products = null through untouched (consistent with existing orders semantics)", () => {
  const fnMatch = migrationSource.match(/create or replace function public\.enforce_order_product_line_identity\(\)[\s\S]*?\nend;\n\$\$;/);
  const fn = fnMatch[0];
  assert.match(fn, /if new\.products is null then\s*\n\s*return new;\s*\n\s*end if;/);
});

test("migration: trigger function uses the same hardened security pattern as the Phase 1B.2 primary-image triggers", () => {
  const fnMatch = migrationSource.match(/create or replace function public\.enforce_order_product_line_identity\(\)[\s\S]*?\nend;\n\$\$;/);
  const fn = fnMatch[0];
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = pg_catalog, public/);
  assert.doesNotMatch(fn, /execute (immediate|format)/i);
  assert.match(migrationSource, /revoke all on function public\.enforce_order_product_line_identity\(\) from public, anon, authenticated;/);
});

test("migration: rollback documentation for the permanent trigger is present and honest about not reversing the historical backfill", () => {
  assert.match(migrationSource, /drop trigger if exists trg_enforce_order_product_line_identity on public\.orders;/);
  assert.match(migrationSource, /drop function if exists public\.enforce_order_product_line_identity\(\);/);
  assert.match(migrationSource, /does NOT reverse the\s*\n-- one-time historical line_id backfill/);
});

// ─── External ingest writers (remote review findings) ─────────────────────

test("no Edge Function code is introduced, modified, or deployed by this phase - sync-to-opps and receive-xlab-order live outside this repo", async () => {
  const { readdir } = await import("node:fs/promises");
  let functionDirs = [];
  try {
    functionDirs = await readdir(new URL("../supabase/functions", import.meta.url));
  } catch {
    functionDirs = [];
  }
  assert.ok(!functionDirs.includes("sync-to-opps"), "sync-to-opps must not be vendored into this repo by this phase");
  assert.ok(!functionDirs.includes("receive-xlab-order"), "receive-xlab-order must not be vendored into this repo by this phase");
});
