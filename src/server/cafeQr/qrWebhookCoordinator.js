// Issue #106: QR-only webhook coordination, NOT deployed.
// This is deliberately separate from legacy invoice, Café and X LAB ITNs.
// Verification uses PayFast /eng/query/validate before any DB lookup.
// All dependencies are trusted server adapters; never expose as a client RPC.
import { correlateQrPayment, verifyQrPayfastItn } from "./qrPayfastCorrelation.js";
import { applyQrInvoiceReceipt } from "./applyQrInvoiceReceipt.js";

const reply = (status, reason) => ({ httpStatus: status, reason });
const retry = (reason) => reply(503, reason);
const ack = (reason) => reply(200, reason);
const permanentInvalid = new Set([
  "MALFORMED_ITN", "NOT_QR_NOTIFICATION", "MERCHANT_MISMATCH",
  "IDENTITY_MISSING", "NOT_COMPLETE", "REQUEST_IDENTITY_MISMATCH",
  "AMOUNT_INVALID", "SIGNATURE_INVALID"
]);

export function createQrWebhookCoordinator({
  verify = verifyQrPayfastItn, loadSavedRequest, paymentService,
  quarantineVerifiedCapture, expectedMerchantId, sandbox,
  fetchImpl,
}) {
  if (typeof verify !== "function" || typeof loadSavedRequest !== "function" ||
      typeof paymentService?.recordVerifiedSettlement !== "function" ||
      typeof quarantineVerifiedCapture !== "function") {
    throw new Error("QR_WEBHOOK_DEPENDENCIES_REQUIRED");
  }
  return async function handleQrWebhook(rawBody) {
    let verified;
    try {
      verified = await verify(rawBody, { expectedMerchantId, sandbox, fetchImpl });
    } catch {
      return retry("VALIDATOR_ERROR");
    }
    if (!verified?.ok) {
      return permanentInvalid.has(verified?.reason) ? ack(verified.reason) :
        retry(verified?.reason || "VALIDATION_UNAVAILABLE");
    }

    // A VALID PayFast COMPLETE means money may have moved. Never answer 200
    // unless receipt reconciliation or an auditable quarantine is persisted.
    const quarantine = async (reason) => {
      try {
        const result = await quarantineVerifiedCapture({
          requestId: verified.requestId, tenantId: verified.tenantId,
          targetId: verified.targetId, type: verified.type,
          gatewayPaymentId: verified.gatewayPaymentId,
          amountCents: verified.amountCents, reason,
        });
        return result?.persisted === true ? ack("DURABLY_QUARANTINED") :
          retry("QUARANTINE_NOT_PERSISTED");
      } catch {
        return retry("QUARANTINE_FAILED");
      }
    };

    let request;
    try {
      request = await loadSavedRequest(verified.requestId);
    } catch {
      return retry("REQUEST_LOOKUP_FAILED");
    }
    if (!request || correlateQrPayment(verified, request).ok === false) {
      return quarantine("CORRELATION_MISMATCH");
    }
    // Café PayFast uses a different service-order ledger and full-total
    // intent. Until a request-scoped canonical adapter exists, never
    // book a verified Café capture against an OPPS invoice.
    if (request.type !== "opps_invoice") {
      return quarantine("CAFE_RECEIPT_ADAPTER_NOT_READY");
    }
    const payment = correlateQrPayment(verified, request);
    try {
      const result = await paymentService.recordVerifiedSettlement({
        type: request.type, targetId: request.targetId,
        paymentRequestId: request.id, verifiedPayment: payment,
        applyCanonicalReceipt: applyQrInvoiceReceipt,
      });
      if (result?.status === "settled") return ack(result.replayed ? "REPLAYED" : "SETTLED");
      if (result?.status === "review_required") return ack("DURABLY_QUARANTINED");
      return retry("SETTLEMENT_NOT_CONFIRMED");
    } catch {
      // Could be a receipt conflict or temporary DB error. Do not falsely
      // acknowledge PayFast and lose its retry without durable evidence.
      return retry("SETTLEMENT_FAILED");
    }
  };
}
