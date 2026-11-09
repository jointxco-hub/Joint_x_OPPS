import test from "node:test";
import assert from "node:assert/strict";
import { resolveCafeInvoicePayable } from "../src/server/cafeQr/resolveCafeInvoicePayable.js";

const invoiceId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
function setup({ status = "approved", currency = "ZAR", cents = "14500",
  role = true, tenantSlug = "quick-solution", exists = true, tenantStatus = "active" } = {}) {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("from public.opps_invoices"))
      return { rows: exists ? [{ tenant_id: tenantId, status, currency_code: currency,
        tenant_slug: tenantSlug, tenant_status: tenantStatus }] : [] };
    if (sql.includes("from public.tenant_memberships"))
      return { rows: role ? [{ allowed: 1 }] : [] };
    if (sql.includes("invoice_balance_due"))
      return { rows: [{ cents }] };
    throw Error("Unexpected SQL");
  } };
  const resolve = (actor = { userId, authenticatedByServer: true }, type = "opps_invoice") =>
    resolveCafeInvoicePayable({ db, type, targetId: invoiceId, actor });
  return { resolve, calls };
}
test("locks a real Café invoice and derives integer cents after authorization", async () => {
  const { resolve, calls } = setup();
  const result = await resolve();
  assert.deepEqual(result, {
    tenantId, eligible: true, reviewRequired: false, balanceCents: 14500,
  });
  assert.match(calls[0].sql, /for update of i/);
  assert.match(calls[1].sql, /tenant_memberships/);
  assert.match(calls[1].sql, /tenant_capabilities/);
  assert.match(calls[2].sql, /invoice_balance_due/);
  assert.deepEqual(calls[2].params, [invoiceId]);
});
test("rejects unauthenticated clients and unsupported counter-order target", async () => {
  const { resolve, calls } = setup();
  await assert.rejects(resolve(null), /AUTH_REQUIRED/);
  await assert.rejects(resolve({ userId, authenticatedByServer: false }), /AUTH_REQUIRED/);
  await assert.rejects(resolve({ userId, authenticatedByServer: true }, "cafe_order"), /TARGET_TYPE_NOT_SUPPORTED/);
  assert.equal(calls.length, 0);
});
test("rejects records from other/inactive tenants and unauthorized Café staff", async () => {
  for (const options of [
    { exists: false }, { role: false }, { tenantSlug: "joint-x" },
    { tenantStatus: "suspended" },
  ]) await assert.rejects(setup(options).resolve(), /NOT_FOUND_OR_FORBIDDEN/);
});
test("disables QR for paid, draft, void, foreign-currency and malformed balances", async () => {
  for (const options of [
    { status: "paid" }, { status: "draft" }, { status: "void" },
    { currency: "USD" }, { cents: "0" }, { cents: "-5" },
    { cents: null }, { cents: "999999999999999999999" },
  ]) {
    const result = await setup(options).resolve();
    assert.equal(result.eligible, false, JSON.stringify(options));
    assert.equal(result.reviewRequired, true, JSON.stringify(options));
  }
});
