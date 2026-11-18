// OPPS-106: pure, fail-closed contract for a FUTURE verified gateway adapter.
// Never call with browser fields: serverConfig is trusted deployment config,
// intent is persisted server-issued checkout identity, callback is the output
// of a signature + merchant + source-IP + remote PayFast VALID verifier.
// No payments, database updates, or QR enablement happen in this module.

const MODES = new Set(['sandbox', 'live']);
const CODES = Object.freeze({
  INVALID_CONTEXT: 'INVALID_CONTEXT',
  CONFIGURATION_MISSING: 'CONFIGURATION_MISSING',
  INTENT_PROVENANCE_MISSING: 'INTENT_PROVENANCE_MISSING',
  CALLBACK_NOT_VERIFIED: 'CALLBACK_NOT_VERIFIED',
  ENVIRONMENT_MISMATCH: 'ENVIRONMENT_MISMATCH',
  MERCHANT_MISMATCH: 'MERCHANT_MISMATCH',
  REQUEST_MISMATCH: 'REQUEST_MISMATCH',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
});

const plainString = v => typeof v === 'string' && v.trim().length > 0 && v === v.trim();
const reject = code => ({ ok: false, reason: code });

export function resolveVerifiedPayfastEnvironment({ serverConfig, intent, verifiedCallback } = {}) {
  if (!serverConfig || !intent || !verifiedCallback) return reject(CODES.INVALID_CONTEXT);

  // merchant IDs and environment MUST originate from gateway config and
  // a server-issued persisted checkout intent, not an m_payment_id prefix.
  const mode = serverConfig.environment;
  const configuredMerchant = serverConfig.merchantId;
  if (!MODES.has(mode) || !plainString(configuredMerchant)) return reject(CODES.CONFIGURATION_MISSING);

  if (!MODES.has(intent.environment) || !plainString(intent.merchantId)
    || !plainString(intent.requestId) || !plainString(intent.orderId)
    || !plainString(intent.tenantId) || !plainString(intent.gatewayReference)
    || !Number.isSafeInteger(intent.amountCents) || intent.amountCents <= 0) {
    return reject(CODES.INTENT_PROVENANCE_MISSING);
  }

  // The caller must independently verify *all* of these with actual
  // PayFast ITN and provider VALID response before invoking this function.
  if (verifiedCallback.signatureValid !== true
    || verifiedCallback.trustedSource !== true
    || verifiedCallback.remoteValidated !== true
    || verifiedCallback.status !== 'COMPLETE') {
    return reject(CODES.CALLBACK_NOT_VERIFIED);
  }

  if (intent.environment !== mode || verifiedCallback.environment !== mode) {
    return reject(CODES.ENVIRONMENT_MISMATCH);
  }
  if (intent.merchantId !== configuredMerchant || verifiedCallback.merchantId !== configuredMerchant) {
    return reject(CODES.MERCHANT_MISMATCH);
  }
  if (verifiedCallback.requestId !== intent.requestId
    || verifiedCallback.orderId !== intent.orderId
    || verifiedCallback.tenantId !== intent.tenantId
    || verifiedCallback.gatewayReference !== intent.gatewayReference
    || !plainString(verifiedCallback.gatewayPaymentId)) {
    return reject(CODES.REQUEST_MISMATCH);
  }
  if (!Number.isSafeInteger(verifiedCallback.amountCents)
    || verifiedCallback.amountCents !== intent.amountCents) {
    return reject(CODES.AMOUNT_MISMATCH);
  }

  return {
    ok: true,
    environment: mode,
    evidence: mode === 'sandbox'
      ? 'payfast_itn_validated_sandbox'
      : 'payfast_itn_validated_live',
    gatewayPaymentId: verifiedCallback.gatewayPaymentId,
    reporting: mode === 'sandbox'
      ? { forceTest: true, forceExclude: true }
      : { forceTest: false, forceExclude: false },
  };
}
