// Issue #106: PostgreSQL adapter for the isolated QR lifecycle.
// NOT deployable as-is: requires reviewed private schema, privileged DB role,
// canonical resolver with a locked financial row, and a verified gateway handler.
// Pool is injected (no pg dependency in the browser/Vite bundle).
const mapRow = row => row && ({
  id: row.id, tenantId: row.tenant_id, type: row.target_type,
  targetId: row.target_id, operationKey: row.operation_key,
  amountCents: Number(row.amount_cents), status: row.status,
  expiresAt: new Date(row.expires_at).getTime(),
  createdAt: new Date(row.created_at).getTime(),
  checkoutUrl: row.checkout_url, gatewayPaymentId: row.gateway_payment_id,
});

export function createPgQrPaymentStore({ pool, resolvePayable, resolveSettlementPayable }) {
  if (!pool || typeof pool.connect !== "function" || typeof resolvePayable !== "function" ||
      typeof resolveSettlementPayable !== "function")
    throw new TypeError("A PostgreSQL pool, staff payable resolver and trusted settlement resolver are required.");
  return {
    async withTargetLock(type, targetId, action) {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        // Serialize all requests for one target across instances/workers.
        // The canonical resolver must also lock/read the underlying payment
        // authority row (FOR UPDATE) in this SAME transaction.
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`qr106:${type}:${targetId}`]);
        const tx = {
          getPayable: (t, id, actor) => resolvePayable({ db, type: t, targetId: id, actor }),
          getSettlementPayable: (t, id, tenantId) =>
            resolveSettlementPayable({ db, type: t, targetId: id, tenantId }),
          async findByKey(t, id, key) {
            const { rows } = await db.query(
              `SELECT * FROM qr_payments.payment_requests
               WHERE target_type=$1 AND target_id=$2 AND operation_key=$3 FOR UPDATE`, [t,id,key]);
            return mapRow(rows[0]);
          },
          async listActive(t,id) {
            const { rows } = await db.query(
              `SELECT * FROM qr_payments.payment_requests
               WHERE target_type=$1 AND target_id=$2 AND status='active' FOR UPDATE`, [t,id]);
            return rows.map(mapRow);
          },
          async getRequest(id) {
            const { rows } = await db.query(
              "SELECT * FROM qr_payments.payment_requests WHERE id=$1 FOR UPDATE", [id]);
            return mapRow(rows[0]);
          },
          async saveRequest(r) {
            await db.query(
              `INSERT INTO qr_payments.payment_requests
                (id, tenant_id, target_type, target_id, operation_key, amount_cents,
                 status, checkout_url, gateway_payment_id, created_at, expires_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10::double precision/1000),
                       to_timestamp($11::double precision/1000))
               ON CONFLICT (id) DO UPDATE SET
                 status=EXCLUDED.status, checkout_url=EXCLUDED.checkout_url,
                 gateway_payment_id=EXCLUDED.gateway_payment_id,
                 updated_at=now()`,
              [r.id,r.tenantId,r.type,r.targetId,r.operationKey,r.amountCents,
                r.status,r.checkoutUrl,r.gatewayPaymentId || null,r.createdAt,r.expiresAt]);
          },
          async recordException(e) {
            await db.query(
              `INSERT INTO qr_payments.payment_exceptions
                 (payment_request_id,gateway_payment_id,reason,amount_cents)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (payment_request_id,gateway_payment_id,reason) DO NOTHING`,
              [e.requestId,e.gatewayPaymentId,e.reason,e.amountCents ?? null]);
          },
          // Expose only within trusted server implementation, never to browser.
          db,
        };
        const result = await action(tx);
        await db.query("COMMIT");
        return result;
      } catch (error) {
        try { await db.query("ROLLBACK"); } catch { /* preserve original error */ }
        throw error;
      } finally {
        db.release();
      }
    },
  };
}
