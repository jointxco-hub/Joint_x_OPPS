// Issue #106: private PostgreSQL storage for verified webhook lookups
// and audited captures not safely accepted into the receipt ledger.
// NEVER expose these functions as browser endpoints. The supplied pool
// must use an explicitly reviewed, privileged role able to access private
// FORCE-RLS tables. This module does not validate PayFast by itself.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createPgQrWebhookStorage({ pool }) {
  if (!pool?.connect || typeof pool.connect !== "function") throw new TypeError("POSTGRES_POOL_REQUIRED");
  return {
    async loadSavedRequest(id) {
      if (!UUID.test(id || "")) return null;
      const db = await pool.connect();
      try {
        const { rows } = await db.query(
          `select id,tenant_id,target_type,target_id,amount_cents,status,expires_at
             from qr_payments.payment_requests where id=$1`, [id]
        );
        const r = rows?.[0];
        return r && {
          id: r.id, tenantId: r.tenant_id, type: r.target_type,
          targetId: r.target_id, amountCents: Number(r.amount_cents),
          status: r.status, expiresAt: new Date(r.expires_at).getTime(),
        };
      } finally { db.release(); }
    },
    async quarantineVerifiedCapture(capture) {
      if (!UUID.test(capture?.requestId || "") ||
          typeof capture.gatewayPaymentId !== "string" ||
          !capture.gatewayPaymentId.trim() ||
          !Number.isSafeInteger(capture.amountCents) || capture.amountCents <= 0 ||
          typeof capture.reason !== "string" || !capture.reason) {
        return { persisted: false };
      }
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const { rows } = await db.query(
          `select id,tenant_id,target_id,target_type
             from qr_payments.payment_requests where id=$1 for update`,
          [capture.requestId]
        );
        const existing = rows?.[0];
        // Never insert an exception into someone else's request record if
        // a validated PayFast claim and a stored request disagree.
        const linked = existing &&
          existing.tenant_id === capture.tenantId &&
          existing.target_id === capture.targetId &&
          existing.target_type === capture.type;
        if (linked) {
          await db.query(
            `insert into qr_payments.payment_exceptions
               (payment_request_id,gateway_payment_id,reason,amount_cents)
             values ($1,$2,'CAPTURE_REQUIRES_RECONCILIATION',$3)
             on conflict (payment_request_id,gateway_payment_id,reason) do nothing`,
            [capture.requestId,capture.gatewayPaymentId,capture.amountCents]
          );
        } else {
          await db.query(
            `insert into qr_payments.unmatched_captures
               (gateway_payment_id,claimed_request_id,claimed_tenant_id,
                claimed_target_id,claimed_type,amount_cents,reason)
             values ($1,$2,$3,$4,$5,$6,$7)
             on conflict (gateway_payment_id) do nothing`,
            [capture.gatewayPaymentId,capture.requestId,capture.tenantId,
              capture.targetId,capture.type,capture.amountCents,capture.reason]
          );
        }
        await db.query("COMMIT");
        return { persisted: true };
      } catch (error) {
        try { await db.query("ROLLBACK"); } catch { /* keep original error */ }
        throw error;
      } finally {
        db.release();
      }
    },
  };
}
