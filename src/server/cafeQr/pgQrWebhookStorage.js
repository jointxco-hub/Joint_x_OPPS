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
        // Serialize ALL quarantine attempts for one gateway reference.
        // A PayFast reference must never silently mutate its original
        // claimed request/tenant/amount on duplicate delivery.
        await db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`qr106:gateway:${capture.gatewayPaymentId}`]);
        const { rows: requestRows } = await db.query(
          `select id,tenant_id,target_id,target_type
             from qr_payments.payment_requests where id=$1 for update`,
          [capture.requestId]
        );
        const existing = requestRows?.[0];
        const linked = existing &&
          existing.tenant_id === capture.tenantId &&
          existing.target_id === capture.targetId &&
          existing.target_type === capture.type;

        // Check cross-table uses of the provider reference, not just the
        // unique constraint within a single exception table.
        const { rows: conflicts } = await db.query(
          `select
             exists(
               select 1 from qr_payments.payment_requests r
               where r.gateway_payment_id=$1
                 and (r.id::text is distinct from $2 or r.tenant_id::text is distinct from $3
                      or r.target_id::text is distinct from $4 or r.target_type is distinct from $5
                      or r.amount_cents is distinct from $6::bigint)
             ) or exists(
               select 1 from qr_payments.unmatched_captures u
               where u.gateway_payment_id=$1
                 and (u.claimed_request_id is distinct from $2
                   or u.claimed_tenant_id is distinct from $3
                   or u.claimed_target_id is distinct from $4
                   or u.claimed_type is distinct from $5
                   or u.amount_cents is distinct from $6::bigint)
             ) or exists(
               select 1 from qr_payments.payment_exceptions e
               join qr_payments.payment_requests r on r.id=e.payment_request_id
               where e.gateway_payment_id=$1
                 and (r.id::text is distinct from $2 or r.tenant_id::text is distinct from $3
                      or r.target_id::text is distinct from $4 or r.target_type is distinct from $5
                      or e.amount_cents is distinct from $6::bigint)
             ) as reference_conflict`,
          [capture.gatewayPaymentId,capture.requestId,capture.tenantId,
            capture.targetId,capture.type,capture.amountCents]
        );
        if (conflicts?.[0]?.reference_conflict !== false) {
          // Fail closed on a collision or an unexpected database result.
          await db.query("ROLLBACK");
          return { persisted: false, reason: "GATEWAY_REFERENCE_CONFLICT" };
        }
        let result;
        if (linked) {
          result = await db.query(
            `insert into qr_payments.payment_exceptions
               (payment_request_id,gateway_payment_id,reason,amount_cents)
             values ($1,$2,'CAPTURE_REQUIRES_RECONCILIATION',$3)
             on conflict (payment_request_id,gateway_payment_id,reason)
             do update set amount_cents = qr_payments.payment_exceptions.amount_cents
               where qr_payments.payment_exceptions.amount_cents
                     is not distinct from excluded.amount_cents
             returning id`,
            [capture.requestId,capture.gatewayPaymentId,capture.amountCents]
          );
        } else {
          result = await db.query(
            `insert into qr_payments.unmatched_captures
               (gateway_payment_id,claimed_request_id,claimed_tenant_id,
                claimed_target_id,claimed_type,amount_cents,reason)
             values ($1,$2,$3,$4,$5,$6,$7)
             on conflict (gateway_payment_id) do update
               set reason=qr_payments.unmatched_captures.reason
             where qr_payments.unmatched_captures.claimed_request_id is not distinct from excluded.claimed_request_id
               and qr_payments.unmatched_captures.claimed_tenant_id is not distinct from excluded.claimed_tenant_id
               and qr_payments.unmatched_captures.claimed_target_id is not distinct from excluded.claimed_target_id
               and qr_payments.unmatched_captures.claimed_type is not distinct from excluded.claimed_type
               and qr_payments.unmatched_captures.amount_cents is not distinct from excluded.amount_cents
             returning id`,
            [capture.gatewayPaymentId,capture.requestId,capture.tenantId,
              capture.targetId,capture.type,capture.amountCents,capture.reason]
          );
        }
        if (!result?.rows?.[0]?.id) {
          await db.query("ROLLBACK");
          return { persisted: false, reason: "GATEWAY_REFERENCE_CONFLICT" };
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
