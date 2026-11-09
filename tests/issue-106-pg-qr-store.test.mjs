import test from "node:test";
import assert from "node:assert/strict";
import { createPgQrPaymentStore } from "../src/server/cafeQr/pgPaymentRequestStore.js";

function mockPool({ failAt = null } = {}) {
  const calls = [];
  let released = 0;
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (failAt && sql.includes(failAt)) throw Error("mock query failed");
      return { rows: [] };
    },
    release() { released++; },
  };
  return { pool: { async connect() { return db; } }, calls, get released() { return released; } };
}

test("Postgres store begins transaction, advisory-locks target and commits", async () => {
  const m = mockPool();
  const store = createPgQrPaymentStore({
    pool: m.pool, resolveSettlementPayable: async () => null, resolvePayable: async ({ db, type, targetId }) => {
      assert.ok(db); assert.equal(type, "cafe_order"); assert.equal(targetId, "order-1");
      return { eligible: true, balanceCents: 100, tenantId: "tenant-1" };
    },
  });
  const result = await store.withTargetLock("cafe_order", "order-1", async tx => {
    const payable = await tx.getPayable("cafe_order", "order-1", { allowed: true });
    assert.equal(payable.balanceCents, 100);
    assert.deepEqual(await tx.listActive("cafe_order", "order-1"), []);
    await tx.recordException({
      requestId: "req-1", gatewayPaymentId: "pf-1", reason: "CAPTURE_REQUIRES_RECONCILIATION",
    });
    return "finished";
  });
  assert.equal(result, "finished");
  assert.equal(m.calls[0].sql, "BEGIN");
  assert.match(m.calls[1].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(m.calls[1].params, ["qr106:cafe_order:order-1"]);
  assert.equal(m.calls.at(-1).sql, "COMMIT");
  assert.equal(m.released, 1);
  assert.ok(m.calls.some(c => c.sql.includes("ON CONFLICT (payment_request_id,gateway_payment_id,reason) DO NOTHING")));
});

test("Postgres store rolls back on callback failure and releases client", async () => {
  const m = mockPool();
  const store = createPgQrPaymentStore({ pool: m.pool, resolvePayable: async () => null, resolveSettlementPayable: async () => null });
  await assert.rejects(store.withTargetLock("opps_invoice", "invoice-1", async () => {
    throw Error("receipt adapter rejected");
  }), /receipt adapter rejected/);
  assert.equal(m.calls.at(-1).sql, "ROLLBACK");
  assert.equal(m.released, 1);
  assert.ok(!m.calls.some(c => c.sql === "COMMIT"));
});

test("Postgres persistence uses bound parameters for all request identities and amounts", async () => {
  const m = mockPool();
  const store = createPgQrPaymentStore({ pool: m.pool, resolvePayable: async () => null, resolveSettlementPayable: async () => null });
  await store.withTargetLock("cafe_order", "order-1", tx => tx.saveRequest({
    id: "uuid-1", tenantId: "tenant-1", type: "cafe_order", targetId: "order-1",
    operationKey: "key-123456", amountCents: 14500, status: "active",
    checkoutUrl: "https://sandbox.payfast.co.za/eng/process?amount=145.00",
    createdAt: 100000, expiresAt: 160000,
  }));
  const insert = m.calls.find(c => c.sql.includes("INSERT INTO qr_payments.payment_requests"));
  assert.ok(insert);
  assert.equal(insert.params[5], 14500);
  assert.equal(insert.params[4], "key-123456");
  assert.ok(!insert.sql.includes("key-123456"));
  assert.match(insert.sql, /ON CONFLICT \(id\) DO UPDATE/);
  assert.equal(m.calls.at(-1).sql, "COMMIT");
});

test("SQL client error rolls back rather than acknowledging a payment", async () => {
  const m = mockPool({ failAt: "INSERT INTO qr_payments.payment_requests" });
  const store = createPgQrPaymentStore({ pool: m.pool, resolvePayable: async () => null, resolveSettlementPayable: async () => null });
  await assert.rejects(store.withTargetLock("cafe_order", "order-1", tx => tx.saveRequest({
    id: "uuid-1", tenantId: "tenant-1", type: "cafe_order", targetId: "order-1",
    operationKey: "key-123456", amountCents: 1, status: "active",
    checkoutUrl: "https://sandbox.payfast.co.za/eng/process",
    createdAt: 100000, expiresAt: 160000,
  })), /mock query failed/);
  assert.equal(m.calls.at(-1).sql, "ROLLBACK");
  assert.equal(m.released, 1);
});
