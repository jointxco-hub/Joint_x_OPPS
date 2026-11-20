import { createHash, timingSafeEqual } from 'node:crypto';
// Issue #106 — standalone QR PayFast ITN verification and correlation.
// NOT DEPLOYED. Does not write receipts or change an existing notifier.
// Only a trusted server should supply the expected merchant and call this.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(['opps_invoice', 'cafe_order']);
const MARKER = 'jointx_qr_v1';
const MAX_ITN_BYTES = 64000;
const cents = value => {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
};
const bad = reason => ({ ok: false, reason });
const phpEncode = value => encodeURIComponent(String(value).trim())
  .replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  .replace(/%20/g, '+');

// Match the reference PayFast ITN signature algorithm. This only validates
// incoming *signed* notifications; it is not a gateway signing endpoint.
export function computeQrItnSignature(rawBody, passphrase) {
  if (typeof rawBody !== 'string' || !passphrase || typeof passphrase !== 'string') return null;
  const params = new URLSearchParams(rawBody);
  const seen = new Set();
  const fields = [];
  let signatureIndex = -1, i = 0;
  for (const [key, value] of params) {
    if (seen.has(key)) return null;
    seen.add(key);
    if (key === 'signature') signatureIndex = i;
    else fields.push(key + '=' + phpEncode(value));
    i++;
  }
  // No ambiguity about fields appended after the signature.
  if (signatureIndex !== -1 && signatureIndex !== i - 1) return null;
  const source = fields.join('&') + '&passphrase=' + phpEncode(passphrase);
  return createHash('md5').update(source,'utf8').digest('hex');
}
const safeMd5Equals = (a,b) => {
  if (typeof a !== 'string' || typeof b !== 'string' ||
      !/^[0-9a-f]{32}$/i.test(a) || !/^[0-9a-f]{32}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a.toLowerCase(),'hex'),Buffer.from(b.toLowerCase(),'hex'));
};


export function qrPayfastRequestFields(request) {
  if (!request || !UUID.test(request.id) || !UUID.test(request.targetId) ||
      !UUID.test(request.tenantId) || !TYPES.has(request.type)) {
    throw new Error('INVALID_QR_REQUEST');
  }
  return Object.freeze({
    m_payment_id: `JXQR-${request.id}`,
    custom_str1: request.targetId,
    custom_str2: MARKER,
    custom_str3: request.id,
    custom_str4: request.type,
    custom_str5: request.tenantId,
  });
}

function parseStrictForm(body) {
  if (typeof body !== 'string' || !body || new TextEncoder().encode(body).length > MAX_ITN_BYTES) return null;
  const params = new URLSearchParams(body);
  const fields = Object.create(null);
  for (const [key, value] of params) {
    // Reject duplicate fields rather than accepting first/last ambiguously.
    if (Object.hasOwn(fields, key)) return null;
    fields[key] = value;
  }
  return fields;
}

// Send the original raw body to PayFast's official validation endpoint.
// This must be invoked inside a trusted server handler, NEVER by browser code.
export async function verifyQrPayfastItn(rawBody, {
  expectedMerchantId, sandbox, passphrase, trustedSourceVerified = false,
  fetchImpl = fetch, timeoutMs = 10000,
} = {}) {
  const fields = parseStrictForm(rawBody);
  if (!fields) return bad('MALFORMED_ITN');
  if (trustedSourceVerified !== true || !passphrase || (sandbox !== true && sandbox !== false)) return bad('SECURITY_GATE_UNAVAILABLE');
  if (fields.custom_str2 !== MARKER) return bad('NOT_QR_NOTIFICATION');
  if (!expectedMerchantId || fields.merchant_id !== expectedMerchantId) return bad('MERCHANT_MISMATCH');
  if (!fields.signature || !fields.pf_payment_id) return bad('IDENTITY_MISSING');
  if (fields.payment_status !== 'COMPLETE') return bad('NOT_COMPLETE');
  if (!UUID.test(fields.custom_str1 || '') || !UUID.test(fields.custom_str3 || '') ||
      !UUID.test(fields.custom_str5 || '') || !TYPES.has(fields.custom_str4) ||
      fields.m_payment_id !== `JXQR-${fields.custom_str3}`) return bad('REQUEST_IDENTITY_MISMATCH');
  const amountCents = cents(fields.amount_gross);
  if (amountCents === null) return bad('AMOUNT_INVALID');
  if (!safeMd5Equals(fields.signature, computeQrItnSignature(rawBody, passphrase))) return bad('SIGNATURE_INVALID');
  if (typeof fetchImpl !== 'function') return bad('VALIDATOR_UNAVAILABLE');
  const endpoint = sandbox === true
    ? 'https://sandbox.payfast.co.za/eng/query/validate'
    : 'https://www.payfast.co.za/eng/query/validate';
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: rawBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return bad('VALIDATION_UNAVAILABLE');
  }
  if (!response || !response.ok) return bad('VALIDATION_UNAVAILABLE');
  let result;
  try { result = (await response.text()).trim(); } catch { return bad('VALIDATION_UNAVAILABLE'); }
  if (result !== 'VALID') return bad(result === 'INVALID' ? 'SIGNATURE_INVALID' : 'VALIDATION_UNAVAILABLE');
  // Do not forward the raw ITN or its signature into the payment ledger.
  return Object.freeze({
    ok: true, requestId: fields.custom_str3, targetId: fields.custom_str1,
    tenantId: fields.custom_str5, type: fields.custom_str4,
    gatewayPaymentId: fields.pf_payment_id, amountCents,
  });
}

// savedRequest MUST come from private backend storage, not the client.
export function correlateQrPayment(verified, savedRequest) {
  if (verified?.ok !== true || !savedRequest ||
      savedRequest.id !== verified.requestId ||
      savedRequest.targetId !== verified.targetId ||
      savedRequest.tenantId !== verified.tenantId ||
      savedRequest.type !== verified.type ||
      savedRequest.amountCents !== verified.amountCents) {
    return bad('CORRELATION_MISMATCH');
  }
  return Object.freeze({
    verified: true, id: verified.gatewayPaymentId,
    amountCents: verified.amountCents, requestId: savedRequest.id,
    tenantId: savedRequest.tenantId, targetId: savedRequest.targetId,
    type: savedRequest.type,
  });
}
