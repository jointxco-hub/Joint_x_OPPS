import test from "node:test";
import assert from "node:assert/strict";
import { createPaymentRequestService } from "../src/server/cafeQr/paymentRequestLifecycle.js";

const TYPE = "cafe_order", ID = "sample-order";
function harness() {
  let timestamp = 100000, serial = 0, queue = Promise.resolve();
  const requests = new Map(), receipts = [], exceptions = [];
  let target = { tenantId: "cafe-tenant", eligible: true, reviewRequired: false, balanceCents: 14500 };
  const store = { withTargetLock: async (_type, _id, action) => {
    const previous = queue;
    let release;
    queue = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      return await action({
        getPayable: async () => ({ ...target }),
        findByKey: async (type, targetId, key) => [...requests.values()].find(r =>
          r.type === type && r.targetId === targetId && r.operationKey === key),
        listActive: async (type, targetId) => [...requests.values()].filter(r =>
          r.type === type && r.targetId === targetId && r.status === "active"),
        getRequest: async id => requests.get(id),
        saveRequest: async r => { requests.set(r.id, { ...r }); },
        recordException: async e => {
          if (!exceptions.some(x => x.requestId === e.requestId &&
            x.gatewayPaymentId === e.gatewayPaymentId && x.reason === e.reason)) exceptions.push(e);
        },
      });
    } finally { release(); }
  } };
  const service = createPaymentRequestService({ store,
    authorize: async actor => { if (!actor?.allowed) throw Error("DENIED"); },
    now: () => timestamp, newId: () => `req-${++serial}`, ttlMs: 60000,
    issueCheckout: async ({ requestId, amountCents }) =>
      `https://sandbox.payfast.co.za/eng/process?m_payment_id=${requestId}&amount=${(amountCents / 100).toFixed(2)}`,
  });
  const create = (key = "key-123456") => service.create({
    actor: { allowed: true }, type: TYPE, targetId: ID, operationKey: key,
  });
  const status = id => service.getStatus({
    actor: { allowed: true }, type: TYPE, targetId: ID, paymentRequestId: id,
  });
  const settlement = (id, gatewayId, amountCents = 14500, verified = true) =>
    service.recordVerifiedSettlement({ type: TYPE, targetId: ID, paymentRequestId: id,
      verifiedPayment: { verified, id: gatewayId, amountCents },
      applyCanonicalReceipt: async ({ verifiedPayment }) => {
        receipts.push(verifiedPayment.id);
        target.balanceCents -= verifiedPayment.amountCents;
      },
    });
  return { create, status, settlement, requests, receipts, exceptions,
    change: props => { target = { ...target, ...props }; },
    advance: ms => { timestamp += ms; },
    service,
  };
}
const code = expected => error => error.code === expected;

test("creates server-priced request and reuses original operation key", async () => {
  const h = harness(), first = await h.create(), again = await h.create();
  assert.equal(first.paymentRequestId, again.paymentRequestId);
  assert.equal(first.amountCents, 14500);
  assert.equal(h.requests.size, 1);
});
test("two concurrent devices get one active payment request", async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.create("key-deviceA"), h.create("key-deviceB")]);
  assert.equal(a.paymentRequestId, b.paymentRequestId);
  assert.equal(h.requests.size, 1);
});
test("expiry rejects reuse of consumed key; new key issues new request", async () => {
  const h = harness(), first = await h.create();
  h.advance(60001);
  await assert.rejects(h.create(), code("OPERATION_KEY_ALREADY_USED"));
  const second = await h.create("key-new123");
  assert.notEqual(first.paymentRequestId, second.paymentRequestId);
  assert.equal(h.requests.get(first.paymentRequestId).status, "expired");
});
test("balance change revokes URL and requires a new operation key", async () => {
  const h = harness(), first = await h.create();
  h.change({ balanceCents: 8000 });
  const state = await h.status(first.paymentRequestId);
  assert.equal(state.status, "revoked");
  assert.equal(state.checkoutUrl, null);
  await assert.rejects(h.create(), code("STALE_OPERATION_KEY"));
  assert.equal((await h.create("key-new234")).amountCents, 8000);
});
test("paid and review-required transactions cannot issue QR", async () => {
  const h = harness();
  h.change({ balanceCents: 0 });
  await assert.rejects(h.create(), code("NOT_PAYABLE"));
  h.change({ balanceCents: 100, reviewRequired: true });
  await assert.rejects(h.create(), code("NOT_PAYABLE"));
});
test("unauthorized user and changed tenant are denied", async () => {
  const h = harness(), request = await h.create();
  await assert.rejects(h.service.create({
    actor: null, type: TYPE, targetId: ID, operationKey: "key-unauth",
  }), /DENIED/);
  h.change({ tenantId: "other-tenant" });
  await assert.rejects(h.status(request.paymentRequestId), code("NOT_FOUND_OR_FORBIDDEN"));
});
test("unverified event is rejected, verified replay records one receipt", async () => {
  const h = harness(), request = await h.create();
  await assert.rejects(h.settlement(request.paymentRequestId, "pf-1", 14500, false), code("UNVERIFIED_PAYMENT"));
  const first = await h.settlement(request.paymentRequestId, "pf-1");
  const again = await h.settlement(request.paymentRequestId, "pf-1");
  assert.equal(first.status, "settled");
  assert.equal(again.replayed, true);
  assert.deepEqual(h.receipts, ["pf-1"]);
  assert.equal(h.requests.get(request.paymentRequestId).checkoutUrl, null);
});
test("amount mismatch, late capture and second capture require reconciliation", async () => {
  const a = harness(), x = await a.create();
  a.change({ balanceCents: 1000 });
  assert.equal((await a.settlement(x.paymentRequestId, "pf-late")).status, "review_required");
  assert.equal(a.receipts.length, 0);
  assert.equal(a.exceptions.length, 1);
  const b = harness(), y = await b.create();
  b.advance(60001);
  assert.equal((await b.settlement(y.paymentRequestId, "pf-expired")).status, "review_required");
  const c = harness(), z = await c.create();
  await c.settlement(z.paymentRequestId, "pf-first");
  assert.equal((await c.settlement(z.paymentRequestId, "pf-second")).status, "review_required");
  assert.deepEqual(c.receipts, ["pf-first"]);
  assert.equal(c.exceptions.length, 1);
});
