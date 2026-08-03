import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  INVOICE_ITEM_LOAD_STATE,
  assertConfirmedItemCount,
  assertInvoiceItemsReadyForSave,
  completeInvoiceDetail,
  invoiceJsonValuesEqual,
  isCompleteInvoiceDetail,
} from "../src/features/invoices/invoiceReliability.js";

const savedItems = [
  { id: "line-1", item_name: "Shirt", quantity: 2 },
  { id: "line-2", item_name: "Print", quantity: 2 },
];

test("a complete invoice detail marks multiple saved items as loaded", () => {
  const invoice = completeInvoiceDetail({ id: "invoice-1", status: "draft" }, savedItems);
  assert.equal(invoice.item_load_state, INVOICE_ITEM_LOAD_STATE.LOADED);
  assert.equal(invoice.loaded_item_count, 2);
  assert.equal(isCompleteInvoiceDetail(invoice), true);
});

test("summary data cannot impersonate complete invoice detail", () => {
  assert.equal(isCompleteInvoiceDetail({ id: "invoice-1", status: "draft", total: 100 }), false);
  assert.equal(isCompleteInvoiceDetail({ id: "invoice-1", items: [] }), false);
});

test("retry can replace a failed/incomplete state with complete detail", () => {
  const failed = { id: "invoice-1", item_load_state: INVOICE_ITEM_LOAD_STATE.FAILED };
  assert.equal(isCompleteInvoiceDetail(failed), false);
  assert.equal(isCompleteInvoiceDetail(completeInvoiceDetail({ id: "invoice-1" }, savedItems)), true);
});

test("an unresolved item collection blocks an existing invoice save", () => {
  assert.throws(
    () => assertInvoiceItemsReadyForSave({ id: "invoice-1", items: [] }),
    (error) => error.code === "INVOICE_ITEMS_NOT_LOADED"
  );
});

test("a failed item load blocks an existing invoice save", () => {
  assert.throws(
    () => assertInvoiceItemsReadyForSave({
      id: "invoice-1",
      items: [],
      items_loaded: false,
      item_load_state: INVOICE_ITEM_LOAD_STATE.FAILED,
      expected_item_count: 2,
    }),
    (error) => error.code === "INVOICE_ITEMS_NOT_LOADED"
  );
});

test("false-empty state cannot replace two saved items", () => {
  assert.throws(
    () => assertInvoiceItemsReadyForSave({
      id: "invoice-1",
      items: [],
      items_loaded: true,
      item_load_state: INVOICE_ITEM_LOAD_STATE.LOADED,
      expected_item_count: 2,
    }),
    (error) => error.code === "INVOICE_FALSE_EMPTY_BLOCKED"
  );
});

test("deliberate line removal is allowed only from a confirmed loaded state", () => {
  assert.doesNotThrow(() => assertInvoiceItemsReadyForSave({
    id: "invoice-1",
    items: [savedItems[0]],
    items_loaded: true,
    item_load_state: INVOICE_ITEM_LOAD_STATE.LOADED,
    expected_item_count: 2,
  }));
});

test("new empty invoice is left to the existing validation rules", () => {
  assert.doesNotThrow(() => assertInvoiceItemsReadyForSave({ id: null, items: [] }));
});

test("post-save verification accepts equal item counts and rejects mismatch", () => {
  const saved = { id: "invoice-1", items: savedItems };
  assert.equal(assertConfirmedItemCount(saved, { ...saved, items: [...savedItems] }).items.length, 2);
  assert.throws(
    () => assertConfirmedItemCount(saved, { ...saved, items: [savedItems[0]] }),
    (error) => error.code === "INVOICE_ITEM_COUNT_MISMATCH"
  );
});

test("database jsonb key ordering does not create a false item-history change", () => {
  const browserSnapshot = {
    item_name: "Browser Item One",
    item_type: "goods",
    rate: 10,
    specifications: { color: "black", sizes: ["M", "L"] },
  };
  const databaseSnapshot = {
    specifications: { sizes: ["M", "L"], color: "black" },
    rate: 10,
    item_type: "goods",
    item_name: "Browser Item One",
  };
  assert.equal(invoiceJsonValuesEqual(browserSnapshot, databaseSnapshot), true);
});

test("atomic migration contains tenant, lock, replace, return and grant safeguards", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202608020001_invoice_item_atomic_persistence.sql", import.meta.url), "utf8");
  assert.match(sql, /can_access_tenant\(p_tenant_id\)/);
  assert.match(sql, /user_finance_level\(\) in \(1, 2\)/);
  assert.match(sql, /for update;/);
  assert.match(sql, /INVOICE_ITEM_OWNERSHIP_MISMATCH/);
  assert.match(sql, /INVOICE_ITEM_INVALID_VALUES/);
  assert.match(sql, /delete from public\.opps_invoice_items/);
  assert.match(sql, /insert into public\.opps_invoice_items/);
  assert.match(sql, /return jsonb_build_object/);
  assert.match(sql, /grant execute .* to authenticated/si);
  assert.match(sql, /set search_path = pg_catalog, public/);
  assert.match(sql, /revoke all .* from public, anon, service_role/si);
  assert.match(sql, /Any exception rolls back/);
});

test("atomic migration rejects cross-tenant line references", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202608020001_invoice_item_atomic_persistence.sql", import.meta.url), "utf8");
  assert.match(sql, /INVOICE_ITEM_TEMPLATE_TENANT_MISMATCH/);
  assert.match(sql, /template\.tenant_id = p_tenant_id/);
  assert.match(sql, /INVOICE_CATALOG_ITEM_TENANT_MISMATCH/);
  assert.match(sql, /product\.tenant_id = p_tenant_id/);
  assert.match(sql, /INVOICE_INVENTORY_ITEM_TENANT_MISMATCH/);
  assert.match(sql, /inventory_item\.tenant_id = p_tenant_id/);
});

test("invoice UI exposes protected load failure and pending save feedback", async () => {
  const page = await readFile(new URL("../src/pages/Invoices.jsx", import.meta.url), "utf8");
  const editor = await readFile(new URL("../src/features/invoices/InvoiceCreateFlow.jsx", import.meta.url), "utf8");
  const drawer = await readFile(new URL("../src/features/invoices/InvoiceDetailDrawer.jsx", import.meta.url), "utf8");
  assert.match(page, /invoice=\{detailQuery\.data \|\| null\}/);
  assert.match(page, /assertConfirmedItemCount/);
  assert.match(page, /toast\.success/);
  assert.match(page, /toast\.error/);
  assert.match(editor, /Saving\.\.\./);
  assert.match(editor, /disabled=\{isSaving/);
  assert.match(drawer, /Saving has been disabled to protect the existing invoice/);
  assert.match(drawer, />Retry</);
  assert.match(drawer, /Open read-only summary/);
});
