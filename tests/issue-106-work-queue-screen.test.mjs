import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [page, app, layout, api, model] = await Promise.all([
  read("../src/pages/CafeWorkQueue.jsx"),
  read("../src/App.jsx"),
  read("../src/Layout.jsx"),
  read("../src/api/cafeWorkQueue.js"),
  read("../src/features/cafeWorkQueue/normalizeWorkQueue.js"),
]);

test("read-only screen uses authenticated RPC client, not browser tenant or payment writers", () => {
  assert.match(page, /getCafeWorkQueue\(\{ cursor, limit: PAGE_SIZE \}\)/);
  assert.match(page, /currentWorkspace\?\.slug === "quick-solution"/);
  assert.match(api, /supabase\.rpc\("qs_cafe_list_work_queue"/);
  assert.doesNotMatch(page, /record_manual_invoice_payment|recordServiceOrderPayment|supabase\.from\(|payfast|paymentLink/i);
  assert.doesNotMatch(page, /p_tenant_id|tenantId\s*:/);
});

test("page represents loading, empty, retry and cursor pagination", () => {
  assert.match(page, /Loading work queue/);
  assert.match(page, /No work cards on this page/);
  assert.match(page, /Try again/);
  assert.match(page, /nextCursor/);
  assert.match(page, /setPageIndex/);
  assert.match(page, /cancelled = true/);
});

test("nested linked invoice status is read-only and never infers order balance", () => {
  assert.match(page, /item\.invoices/);
  assert.match(page, /invoice\.reviewRequired/);
  assert.match(page, /invoice\.balanceDue === 0/);
  assert.match(page, /Order balance not inferred/);
  assert.match(model, /sourceOrderId === item\.id/);
});

test("route is authenticated and navigation only appears for Cafe workspace", () => {
  assert.match(app, /Route path="\/CafeWorkQueue"/);
  assert.match(layout, /item\.page === "CafeWorkQueue"\) return currentWorkspace\.slug === "quick-solution"/);
  assert.match(layout, /name: "Café Work Queue", page: "CafeWorkQueue"/);
});
