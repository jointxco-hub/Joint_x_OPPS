// Read-only, fail-closed QR presentation rules for Issue #106.
// This module cannot initiate, authorize, update or confirm a payment.
// A server-issued payment request is the sole source of the URL and balance.
const PAYFAST_HOSTS = new Set(["www.payfast.co.za", "sandbox.payfast.co.za"]);
const VALID_STATUSES = new Set(["active", "settled", "expired", "revoked"]); 
// Explicitly opt in only when a developer has verified STAGING Supabase host.
// Production never trusts an arbitrary scan URL or a caller-supplied hostname.
const STAGING_SCAN_ORIGIN = "https://tijiamrfnxrbitafiflj.supabase.co";
const STAGING_SCAN_PATH = "/functions/v1/quick-solution-qr-opps106-scan";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


export function getCafeQrPresentation(request, now = Date.now(), { allowStagingScan = false } = {}) {
  const blocked = (reason) => ({ canShowQr: false, reason, checkoutUrl: null });
  if (!request || typeof request !== "object" || Array.isArray(request)) return blocked("unavailable");
  if (!VALID_STATUSES.has(request.status)) return blocked("unavailable");
  if (request.status !== "active") return blocked(request.status);
  if (request.currency !== "ZAR" || !Number.isSafeInteger(request.amountCents) || request.amountCents <= 0) {
    return blocked("invalid_amount");
  }
  if (typeof request.paymentRequestId !== "string" || request.paymentRequestId.trim().length === 0) {
    return blocked("unavailable");
  }
  const expiry = Date.parse(request.expiresAt);
  if (!Number.isFinite(expiry) || !Number.isFinite(now) || expiry <= now) return blocked("expired");
  if (typeof request.checkoutUrl !== "string" || !request.checkoutUrl) return blocked("invalid_url");
  let parsed;
  try {
    parsed = new URL(request.checkoutUrl);
  } catch {
    return blocked("invalid_url");
  }
  const payfast = parsed.protocol === "https:" && PAYFAST_HOSTS.has(parsed.hostname.toLowerCase())
    && !parsed.username && !parsed.password && !parsed.port
    && parsed.pathname === "/eng/process" && !parsed.hash;
  const scan = allowStagingScan === true && parsed.origin === STAGING_SCAN_ORIGIN
    && parsed.pathname === STAGING_SCAN_PATH && !parsed.hash
    && !parsed.username && !parsed.password && !parsed.port
    && [...parsed.searchParams.keys()].length === 1
    && UUID.test(parsed.searchParams.get("rid") || "");
  if (!payfast && !scan) return blocked("invalid_url");
  // Return the exact server-issued URL; never synthesize amount or signatures in the browser.
  return {
    canShowQr: true,
    reason: "ready",
    checkoutUrl: request.checkoutUrl,
    paymentRequestId: request.paymentRequestId,
    amountCents: request.amountCents,
    expiresAt: request.expiresAt,
  };
}
