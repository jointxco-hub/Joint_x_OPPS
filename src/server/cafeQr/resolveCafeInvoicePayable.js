// Issue #106 / server-only canonical resolver for CAFÉ-TENANT OPPS invoices.
// Not wired to an endpoint. The caller MUST authenticate its staff JWT,
// pass the resulting user ID (never a browser-supplied user ID), and use a
// database connection in the same transaction as pgPaymentRequestStore.
// This module deliberately rejects cafe_order until its own canonical
// service-order/payment projection has been verified.
const VALID_STATES = new Set(["approved", "partially_paid", "overdue"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveCafeInvoicePayable({ db, type, targetId, actor }) {
  if (type !== "opps_invoice") throw new Error("TARGET_TYPE_NOT_SUPPORTED");
  if (typeof targetId !== "string" || !UUID.test(targetId)) throw new Error("TARGET_INVALID");
  if (!actor || typeof actor.userId !== "string" || !UUID.test(actor.userId)
    || actor.authenticatedByServer !== true) throw new Error("AUTH_REQUIRED");

  // Lock the actual invoice row. All writers must take this lock for
  // balance/ledger decisions; the request table lock alone is insufficient.
  const { rows: invoices } = await db.query(
    `select i.id, i.tenant_id, i.status, i.currency_code,
            t.slug as tenant_slug, t.status as tenant_status,
            exists (
              select 1 from commerce.service_orders so
              where so.tenant_id=i.tenant_id and so.opps_order_id=i.source_order_id
            ) as cafe_service_order_linked
       from public.opps_invoices i
       join public.tenants t on t.id = i.tenant_id
      where i.id = $1
      for update of i`, [targetId]);
  const invoice = invoices[0];
  if (!invoice || invoice.tenant_slug !== "quick-solution" ||
      invoice.tenant_status !== "active") throw new Error("NOT_FOUND_OR_FORBIDDEN");

  // Staff membership and explicit Café capability are checked again within
  // the transaction; never trust an unsafely supplied tenant ID or UI role.
  const { rows: permitted } = await db.query(
    `select 1
       from public.tenant_memberships m
      where m.tenant_id=$1 and m.auth_user_id=$2
        and m.status='active'
        and m.tenant_role in ('owner','admin','member','counter_staff')
        and exists (
          select 1 from public.tenant_capabilities tc
           where tc.tenant_id=$1 and tc.capability_key='quick_solution'
             and tc.enabled=true
        )
      limit 1`,
    [invoice.tenant_id, actor.userId]);
  if (!permitted.length) throw new Error("NOT_FOUND_OR_FORBIDDEN");

  // Separate statement after FOR UPDATE ensures a post-lock ledger read.
  const { rows: balances } = await db.query(
    `select round(public.invoice_balance_due($1::uuid) * 100)::bigint as cents`,
    [targetId]);
  const rawCents = balances[0]?.cents;
  const balanceCents = rawCents == null ? null : Number(rawCents);
  const validBalance = Number.isSafeInteger(balanceCents) && balanceCents > 0;
  const reviewRequired = invoice.cafe_service_order_linked !== false || !validBalance || invoice.currency_code !== "ZAR" ||
    !VALID_STATES.has(invoice.status);

  return {
    tenantId: invoice.tenant_id,
    eligible: !reviewRequired,
    reviewRequired,
    balanceCents: validBalance ? balanceCents : null,
  };
}
