// Issue #106: private, transaction-bound QR invoice receipt adapter.
// Runs only after a verified, server-correlated PayFast COMPLETE notification.
// IMPORTANT: tx.db must be the SAME PostgreSQL transaction and connection used
// to lock the QR request and canonical invoice. No extra Supabase RPC request.
export async function applyQrInvoiceReceipt({ tx, request, verifiedPayment }) {
  if (!tx?.db || typeof tx.db.query !== "function") throw new Error("TRANSACTION_REQUIRED");
  if (request?.type !== "opps_invoice" || !request?.id || !request?.targetId ||
      !request?.tenantId || !verifiedPayment?.verified ||
      request.id !== verifiedPayment.requestId ||
      request.targetId !== verifiedPayment.targetId ||
      request.tenantId !== verifiedPayment.tenantId ||
      verifiedPayment.type !== "opps_invoice" ||
      !Number.isSafeInteger(verifiedPayment.amountCents) ||
      verifiedPayment.amountCents <= 0 ||
      verifiedPayment.amountCents !== request.amountCents ||
      typeof verifiedPayment.id !== "string" || !verifiedPayment.id.trim()) {
    throw new Error("RECEIPT_CORRELATION_INVALID");
  }
  // The existing RPC is evaluated within the caller's BEGIN/COMMIT, not a
  // separate network call. It locks the invoice and inserts its canonical
  // payment ledger + activity rows with provider-ref idempotency.
  // Store minimal metadata; never persist raw PayFast signatures.
  const { rows } = await tx.db.query(
    `select public.apply_invoice_payfast_payment(
      $1::uuid, ($2::bigint::numeric / 100), $3::text, '{}'::jsonb
    ) as result`,
    [request.targetId, verifiedPayment.amountCents, verifiedPayment.id]
  );
  const result = rows?.[0]?.result;
  if (!result?.ok || result.ignored === true ||
      (!result.payment_id && !result.paymentId)) {
    // Rollback the transaction; a trusted outer webhook must durably
    // quarantine captured money and retry if storage is temporarily down.
    throw new Error("INVOICE_RECEIPT_REQUIRES_RECONCILIATION");
  }
  return { paymentId: result.payment_id ?? result.paymentId, replayed: Boolean(result.replayed) };
}
