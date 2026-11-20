import test from "node:test";
import assert from "node:assert/strict";
import { getCafeQrPresentation } from "../src/features/cafeQr/paymentRequestView.js";

const NOW = Date.parse("2026-11-09T10:00:00Z");
const valid = {
  paymentRequestId: "request-123",
  status: "active",
  checkoutUrl: "https://www.payfast.co.za/eng/process?amount=145.00&signature=server-signed",
  expiresAt: "2026-11-09T10:05:00Z",
  amountCents: 14500,
  currency: "ZAR",
};
const present = (overrides = {}, now = NOW) => getCafeQrPresentation({ ...valid, ...overrides }, now);

test("only a valid server-issued active PayFast HTTPS checkout URL is displayable", () => {
  const result = present();
  assert.equal(result.canShowQr, true);
  assert.equal(result.checkoutUrl, valid.checkoutUrl);
  assert.equal(result.amountCents, 14500);
  assert.equal(present({ checkoutUrl: "https://sandbox.payfast.co.za/eng/process?test=1" }).canShowQr, true);
});

test("missing, settled, revoked, expired and unknown requests never display a QR", () => {
  assert.equal(getCafeQrPresentation(null, NOW).canShowQr, false);
  for (const status of ["settled", "revoked", "expired", "pending", ""]) {
    assert.equal(present({ status }).canShowQr, false, status);
  }
  assert.equal(present({ expiresAt: "2026-11-09T10:00:00Z" }).reason, "expired");
  assert.equal(present({}, NOW + 300001).reason, "expired");
  assert.equal(present({ expiresAt: "not-a-date" }).canShowQr, false);
});

test("invalid amounts, missing server identity and malformed URLs fail closed", () => {
  for (const amountCents of [0, -1, 14.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "14500"]) {
    assert.equal(present({ amountCents }).canShowQr, false);
  }
  assert.equal(present({ currency: "USD" }).canShowQr, false);
  assert.equal(present({ paymentRequestId: "" }).canShowQr, false);
  for (const checkoutUrl of [
    "http://www.payfast.co.za/eng/process",
    "https://evil.example/eng/process",
    "https://www.payfast.co.za.evil.example/eng/process",
    "https://user:pass@www.payfast.co.za/eng/process",
    "https://www.payfast.co.za:8080/eng/process",
    "https://www.payfast.co.za/other",
    "https://www.payfast.co.za/eng/process#fragment",
    "javascript:alert(1)",
    "invalid",
  ]) {
    assert.equal(present({ checkoutUrl }).canShowQr, false, checkoutUrl);
  }
});

test("presentation rules cannot claim settlement or alter browser amount", () => {
  const ready = present();
  assert.deepEqual(Object.keys(ready).sort(), [
    "amountCents", "canShowQr", "checkoutUrl", "expiresAt",
    "paymentRequestId", "reason",
  ]);
  assert.equal(ready.reason, "ready");
});
