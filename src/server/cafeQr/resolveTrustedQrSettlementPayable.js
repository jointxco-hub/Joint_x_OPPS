// Issue #106 — trusted, read-only gateway settlement payable resolver.
//
// This module is NOT a PayFast validator or receipt writer. Call it ONLY
// after the PayFast webhook signature, merchant, provider reference, amount,
// and server-issued request identity have been verified. Never expose it to
// an HTTP client as a privileged payable lookup.
//
// It is executed inside pgPaymentRequestStore.withTargetLock, on the SAME
// PostgreSQL connection/transaction, after the request is locked. The
// resolver locks the canonical invoice row BEFORE reading ledger balance.
// Café service-order settlement intentionally fails closed until its
// existing pending intent and receipt writer are correlated to QR request IDs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVOICE_STATES = new Set(["approved", "partially_paid", "overdue"]);

export async function resolveTrustedQrSettlementPayable({ db, type, targetId, tenantId }) {
  if (type !== "opps_invoice") throw new Error("SETTLEMENT_TARGET_NOT_SUPPORTED");
  if (typeof targetId !== "string" || !UUID.test(targetId) ||
      typeof tenantId !== "string" || !UUID.test(tenantId)) {
    throw new Error("INVALID_SETTLEMENT_IDENTITY");
  }

  // Exact tenant and target scoped lookup, not public share token lookup.
  // This lock serializes the decision with other invoice writers that
  // honor the same invoice-row locking convention.
  const { rows } = await db.query(
    `select i.id,i.tenant_id,i.status,i.currency_code,
            t.slug as tenant_slug,t.status as tenant_status,
            i.public_visible,i.share_revoked_at
       from public.opps_invoices i
       join public.tenants t on t.id=i.tenant_id
      where i.id=$1 and i.tenant_id=$2
      for update of i`,
    [targetId, tenantId]
  );
  const invoice = rows[0];
  if (!invoice || invoice.tenant_slug !== "quick-solution" ||
      invoice.tenant_status !== "active") {
    throw new Error("SETTLEMENT_TARGET_UNAVAILABLE");
  }

  // Only use canonical balances after the invoice lock. Do not trust
  // amount_paid/balance_due browser caches, nor a payment amount supplied
  // by a callback caller.
  const { rows: balances } = await db.query(
    `select round(public.invoice_balance_due($1::uuid)*100)::bigint as cents`,
    [targetId]
  );
  const raw = balances[0]?.cents;
  const cents = raw == null ? null : Number(raw);
  const valid = Number.isSafeInteger(cents) && cents > 0;
  const eligible = valid && invoice.currency_code === "ZAR" &&
    INVOICE_STATES.has(invoice.status);

  return {
    tenantId: invoice.tenant_id,
    eligible,
    reviewRequired: !eligible,
    balanceCents: valid ? cents : null,
  };
}
