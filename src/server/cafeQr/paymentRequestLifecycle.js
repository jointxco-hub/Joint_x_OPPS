// Issue #106 server-only lifecycle. NOT wired to any payment endpoint.
// Store.withTargetLock must be a durable transaction, not a process mutex.
// PayFast callbacks must be independently validated before calling settle().
export class PaymentRequestError extends Error {
  constructor(code) { super(code); this.code = code; this.name = "PaymentRequestError"; }
}
const types = new Set(["cafe_order", "opps_invoice"]);
const requireTrue = (value, code) => { if (!value) throw new PaymentRequestError(code); };
const money = n => Number.isSafeInteger(n) && n > 0;
const identityMatches = (r, p) => r.type === p.type && r.targetId === p.targetId && r.tenantId === p.tenantId;
const present = r => ({
  paymentRequestId: r.id, status: r.status, amountCents: r.amountCents,
  currency: "ZAR", expiresAt: new Date(r.expiresAt).toISOString(),
  checkoutUrl: r.status === "active" ? r.checkoutUrl : null,
});

export function createPaymentRequestService({ store, authorize, issueCheckout, newId, now = Date.now, ttlMs = 60000 }) {
  requireTrue(typeof store?.withTargetLock === "function" && typeof authorize === "function" &&
    typeof issueCheckout === "function" && typeof newId === "function", "DEPENDENCY_REQUIRED");
  requireTrue(Number.isSafeInteger(ttlMs) && ttlMs >= 1000 && ttlMs <= 900000, "TTL_INVALID");
  const validate = (type, targetId) => requireTrue(types.has(type) && typeof targetId === "string" && targetId.length > 0, "TARGET_INVALID");

  async function create({ actor, type, targetId, operationKey }) {
    validate(type, targetId);
    requireTrue(typeof operationKey === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(operationKey), "OPERATION_KEY_INVALID");
    await authorize(actor, "create", { type, targetId });
    return store.withTargetLock(type, targetId, async tx => {
      const payable = await tx.getPayable(type, targetId, actor);
      requireTrue(payable && typeof payable.tenantId === "string", "NOT_FOUND_OR_FORBIDDEN");
      requireTrue(payable.eligible === true && !payable.reviewRequired && money(payable.balanceCents), "NOT_PAYABLE");
      const stamp = now();
      requireTrue(Number.isFinite(stamp), "CLOCK_INVALID");
      const original = await tx.findByKey(type, targetId, operationKey);
      if (original) {
        requireTrue(identityMatches(original, { type, targetId, tenantId: payable.tenantId }), "OPERATION_KEY_CONFLICT");
        requireTrue(original.amountCents === payable.balanceCents, "STALE_OPERATION_KEY");
        if (original.status === "active" && original.expiresAt > stamp) return present(original);
        throw new PaymentRequestError("OPERATION_KEY_ALREADY_USED");
      }
      for (const active of await tx.listActive(type, targetId)) {
        if (active.status !== "active") continue;
        if (active.expiresAt > stamp && active.amountCents === payable.balanceCents &&
          active.tenantId === payable.tenantId) return present(active);
        await tx.saveRequest({ ...active, status: active.expiresAt <= stamp ? "expired" : "revoked", checkoutUrl: null });
      }
      const id = newId();
      requireTrue(typeof id === "string" && id.length > 0, "REQUEST_ID_INVALID");
      const r = { id, type, targetId, tenantId: payable.tenantId, operationKey, amountCents: payable.balanceCents,
        status: "active", createdAt: stamp, expiresAt: stamp + ttlMs, checkoutUrl: null };
      // Trusted adapter MUST bind checkout to request id and canonical server amount.
      r.checkoutUrl = await issueCheckout({ requestId: id, type, targetId, tenantId: r.tenantId,
        amountCents: r.amountCents, expiresAt: r.expiresAt });
      requireTrue(typeof r.checkoutUrl === "string" && r.checkoutUrl.length > 0, "CHECKOUT_UNAVAILABLE");
      await tx.saveRequest(r);
      return present(r);
    });
  }

  async function getStatus({ actor, type, targetId, paymentRequestId }) {
    validate(type, targetId);
    await authorize(actor, "read", { type, targetId });
    return store.withTargetLock(type, targetId, async tx => {
      const payable = await tx.getPayable(type, targetId, actor);
      requireTrue(payable && typeof payable.tenantId === "string", "NOT_FOUND_OR_FORBIDDEN");
      const r = await tx.getRequest(paymentRequestId);
      requireTrue(r && identityMatches(r, { type, targetId, tenantId: payable.tenantId }), "NOT_FOUND_OR_FORBIDDEN");
      if (r.status === "active") {
        const stale = r.expiresAt <= now() ? "expired"
          : !payable.eligible || payable.reviewRequired || !money(payable.balanceCents) ||
            payable.balanceCents !== r.amountCents ? "revoked" : null;
        if (stale) await tx.saveRequest(Object.assign(r, { status: stale, checkoutUrl: null }));
      }
      return present(r);
    });
  }

  // ONLY trusted, verified gateway notifications may reach this method.
  // applyCanonicalReceipt must run in the SAME transaction and be idempotent
  // on the verified PayFast payment id. Captured exceptions require finance review.
  async function recordVerifiedSettlement({ type, targetId, paymentRequestId, verifiedPayment, applyCanonicalReceipt }) {
    validate(type, targetId);
    requireTrue(typeof applyCanonicalReceipt === "function", "RECEIPT_ADAPTER_REQUIRED");
    requireTrue(verifiedPayment?.verified === true && typeof verifiedPayment.id === "string" &&
      verifiedPayment.id.length > 0 && money(verifiedPayment.amountCents), "UNVERIFIED_PAYMENT");
    return store.withTargetLock(type, targetId, async tx => {
      const r = await tx.getRequest(paymentRequestId);
      requireTrue(r && r.type === type && r.targetId === targetId, "NOT_FOUND_OR_FORBIDDEN");
      // Must be populated by the verified gateway adapter from the signed
      // notification correlation, never accepted as a client claim.
      requireTrue(
        verifiedPayment.requestId === r.id &&
        verifiedPayment.tenantId === r.tenantId &&
        verifiedPayment.type === r.type &&
        verifiedPayment.targetId === r.targetId,
        "PAYMENT_IDENTITY_MISMATCH"
      );
      if (r.status === "settled") {
        if (r.gatewayPaymentId === verifiedPayment.id) return { status: "settled", replayed: true };
        await tx.recordException({ requestId: r.id, gatewayPaymentId: verifiedPayment.id, reason: "ADDITIONAL_CAPTURE" });
        return { status: "review_required", replayed: false };
      }
      // Gateway settlement uses a separate, trusted canonical resolver.
      // Never bypass staff authorization by passing null to a staff resolver.
      requireTrue(typeof tx.getSettlementPayable === "function", "SETTLEMENT_AUTHORITY_UNAVAILABLE");
      const payable = await tx.getSettlementPayable(type, targetId, r.tenantId);
      if (r.status !== "active" || r.expiresAt <= now() || !payable || payable.tenantId !== r.tenantId ||
        !payable.eligible || payable.reviewRequired || !money(payable.balanceCents) ||
        payable.balanceCents !== verifiedPayment.amountCents || r.amountCents !== verifiedPayment.amountCents) {
        await tx.recordException({ requestId: r.id, gatewayPaymentId: verifiedPayment.id,
          amountCents: verifiedPayment.amountCents, reason: "CAPTURE_REQUIRES_RECONCILIATION" });
        if (r.status === "active") await tx.saveRequest({ ...r, status: "revoked", checkoutUrl: null });
        return { status: "review_required", replayed: false };
      }
      await applyCanonicalReceipt({ tx, request: r, verifiedPayment });
      await tx.saveRequest({ ...r, status: "settled", checkoutUrl: null, gatewayPaymentId: verifiedPayment.id });
      return { status: "settled", replayed: false };
    });
  }
  return { create, getStatus, recordVerifiedSettlement };
}
