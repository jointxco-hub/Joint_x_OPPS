import assert from "node:assert/strict";
import test from "node:test";
import {
  getClientPaymentStatus,
  getClientSafeOrderStatus,
  getOrderStageDetail,
} from "../src/lib/xosOrderStatus.js";

// ─────────────────────────────────────────────────────────────────────
// XOS 2.7B - client-facing status polish.
//
// Extends the existing xosOrderStatus.js (not a new/competing mapper).
// Payment presentation is a deliberately independent, parallel concept -
// tested separately from production/order progress throughout.
// ─────────────────────────────────────────────────────────────────────

test("existing primary status behavior is unchanged for every real status value, with no fulfillment_type present", () => {
  assert.equal(getClientSafeOrderStatus({ status: "confirmed", stage: "confirmed" }).label, "Confirmed");
  assert.equal(getClientSafeOrderStatus({ status: "in_production", stage: "in_production" }).label, "In Production");
  assert.equal(getClientSafeOrderStatus({ status: "in_production", stage: "artwork_check" }).label, "Preparing");
  assert.equal(getClientSafeOrderStatus({ status: "shipped", stage: "shipped" }).label, "Shipped");
  assert.equal(getClientSafeOrderStatus({ status: "delivered", stage: "delivered" }).label, "Completed");
});

test("HOLD_STAGES behavior is preserved regardless of status", () => {
  for (const stage of ["rework", "customer_complaint", "materials_delayed"]) {
    const result = getClientSafeOrderStatus({ status: "in_production", stage });
    assert.equal(result.key, "on_hold");
    assert.equal(result.label, "On Hold");
    assert.equal(result.tone, "destructive");
  }
});

test("quality_check stage detection under status=ready is preserved", () => {
  for (const stage of ["quality_check", "qa"]) {
    const result = getClientSafeOrderStatus({ status: "ready", stage });
    assert.equal(result.key, "quality_check");
    assert.equal(result.label, "Quality Check");
  }
});

test("ready + fulfillment_type=collection -> Ready for collection", () => {
  const result = getClientSafeOrderStatus({ status: "ready", stage: "ready", fulfillment_type: "collection" });
  assert.equal(result.key, "ready");
  assert.equal(result.label, "Ready for collection");
  assert.equal(result.tone, "success");
});

test("ready + fulfillment_type=courier -> Ready for dispatch", () => {
  const result = getClientSafeOrderStatus({ status: "ready", stage: "ready", fulfillment_type: "courier" });
  assert.equal(result.key, "ready");
  assert.equal(result.label, "Ready for dispatch");
});

test("ready + missing/unknown fulfillment_type -> plain Ready, never a raw or guessed value", () => {
  assert.equal(getClientSafeOrderStatus({ status: "ready", stage: "ready" }).label, "Ready");
  assert.equal(getClientSafeOrderStatus({ status: "ready", stage: "ready", fulfillment_type: null }).label, "Ready");
  assert.equal(getClientSafeOrderStatus({ status: "ready", stage: "ready", fulfillment_type: "some_future_value" }).label, "Ready");
});

test("fulfillment_type has no effect on any status other than ready - it must never leak into other labels", () => {
  const withCollection = getClientSafeOrderStatus({ status: "in_production", stage: "in_production", fulfillment_type: "collection" });
  const without = getClientSafeOrderStatus({ status: "in_production", stage: "in_production" });
  assert.deepEqual(withCollection, without);

  const deliveredWithCourier = getClientSafeOrderStatus({ status: "delivered", stage: "delivered", fulfillment_type: "courier" });
  assert.equal(deliveredWithCourier.label, "Completed", "delivered must stay Completed regardless of fulfillment_type");
});

test("payment_status=paid -> Paid, positive tone", () => {
  const result = getClientPaymentStatus({ payment_status: "paid" });
  assert.deepEqual(result, { key: "paid", label: "Paid", tone: "success" });
});

test("payment_status=pending -> Awaiting payment, warning tone", () => {
  const result = getClientPaymentStatus({ payment_status: "pending" });
  assert.deepEqual(result, { key: "pending", label: "Awaiting payment", tone: "warning" });
});

test("unknown/missing payment_status returns null, not a guessed label", () => {
  assert.equal(getClientPaymentStatus({}), null);
  assert.equal(getClientPaymentStatus({ payment_status: null }), null);
  assert.equal(getClientPaymentStatus({ payment_status: "refunded" }), null, "only the two real observed values are mapped - anything else is null, never fabricated");
  assert.equal(getClientPaymentStatus(null), null);
  assert.equal(getClientPaymentStatus(undefined), null);
});

test("payment status never overrides or is merged into production/order progress - the two are independent return values from independent functions", () => {
  const order = { status: "in_production", stage: "in_production", payment_status: "pending" };
  const progress = getClientSafeOrderStatus(order);
  const payment = getClientPaymentStatus(order);
  assert.equal(progress.label, "In Production", "production progress must be unaffected by payment_status");
  assert.equal(payment.label, "Awaiting payment");
  assert.notEqual(progress.key, payment.key);
});

test("a paid, delivered order shows Completed + Paid - not one flag overwriting the other", () => {
  const order = { status: "delivered", stage: "delivered", payment_status: "paid" };
  assert.equal(getClientSafeOrderStatus(order).label, "Completed");
  assert.equal(getClientPaymentStatus(order).label, "Paid");
});

test("getOrderStageDetail is unaffected by this change - still falls back safely, still never leaks a raw stage string", async () => {
  assert.equal(getOrderStageDetail({ stage: "print_setup" }), "Preparing for production");
  assert.equal(getOrderStageDetail({ stage: "some_totally_new_future_stage" }), getClientSafeOrderStatus({ stage: "some_totally_new_future_stage" }).label);
});

test("no raw internal field name (pipeline_stage, production_detail_stage) appears anywhere in this module's code - only the already-coalesced `stage` input is read", async () => {
  const raw = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/lib/xosOrderStatus.js", import.meta.url), "utf8"));
  const code = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/pipeline_stage|production_detail_stage/.test(code));
});
