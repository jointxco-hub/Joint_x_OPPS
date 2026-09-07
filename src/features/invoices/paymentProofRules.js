// Shared proof-of-payment file rules. Must match the payment_attachments
// CHECK constraints in 20260907130000. This is a LEAF module (no imports)
// so both the payment modal (a UI component) and the api layer depend on
// something small and stable rather than pulling constants through the
// large src/api/invoices.js module graph.

export const PAYMENT_PROOF_ACCEPT = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
export const PAYMENT_PROOF_MAX_BYTES = 15 * 1024 * 1024;

// null when the file is acceptable, otherwise a human-readable reason.
export function paymentProofFileProblem(file) {
  const type = String(file?.type || "").toLowerCase();
  if (!PAYMENT_PROOF_ACCEPT.includes(type)) return "Only JPG, PNG or PDF files can be attached as proof of payment.";
  if (Number(file?.size || 0) > PAYMENT_PROOF_MAX_BYTES) return "Proof-of-payment files must be 15 MB or smaller.";
  return null;
}
