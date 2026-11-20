// Issue #106 — read-only, server-side Café COUNTER payable resolver.
// Not an exposed endpoint. No database writes or PayFast checkout initiation.
// The adapter invokes this inside its own transaction, after obtaining a
// transaction-scoped lock. This resolver separately locks the canonical order.
// NOTE: existing qs_begin_payfast_payment charges total_amount, NOT an
// outstanding balance. Do not connect this resolver to that checkout until
// its payment intent and callback semantics are updated/tested for partials.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_STAFF_ROLES = ["owner", "admin", "member", "counter_staff"];

export async function resolveCafeCounterPayable({ db, type, targetId, actor }) {
  if (type !== "cafe_order") throw new Error("TARGET_TYPE_NOT_SUPPORTED");
  if (typeof targetId !== "string" || !UUID.test(targetId)) throw new Error("TARGET_INVALID");
  if (!actor || actor.authenticatedByServer !== true ||
      typeof actor.userId !== "string" || !UUID.test(actor.userId)) {
    throw new Error("AUTH_REQUIRED");
  }
  const { rows: orders } = await db.query(
    `select so.id, so.tenant_id, so.status, so.payment_status, so.total_amount,
            so.opps_order_id, so.channel, so.fulfilment_type, so.source_metadata,
            t.slug as tenant_slug, t.status as tenant_status,
            coalesce((t.settings->'qsPayment'->>'payfastMinimumAmount')::numeric,50) as min_payfast
       from commerce.service_orders so
       join public.tenants t on t.id=so.tenant_id
      where so.id=$1
      for update of so`,
    [targetId]);
  const order = orders[0];
  if (!order || order.tenant_slug !== "quick-solution" || order.tenant_status !== "active")
    throw new Error("NOT_FOUND_OR_FORBIDDEN");
  const { rows: permitted } = await db.query(
    `select 1
       from public.tenant_memberships m
      where m.tenant_id=$1 and m.auth_user_id=$2 and m.status='active'
        and m.tenant_role = any($3::text[])
        and exists (
          select 1 from public.tenant_capabilities tc
           where tc.tenant_id=$1 and tc.capability_key='quick_solution'
             and tc.enabled=true)
      limit 1`,
    [order.tenant_id, actor.userId, ALLOWED_STAFF_ROLES]);
  if (!permitted.length) throw new Error("NOT_FOUND_OR_FORBIDDEN");

  // Other channels and OPPS-linked orders need the shared receipt-parity
  // checks of qs_staff_payment_state before QR can be considered payable.
  // Fail closed rather than guessing from the service order total.
  if (order.channel !== "counter" || order.opps_order_id) {
    return { tenantId: order.tenant_id, eligible: false, reviewRequired: true, balanceCents: null };
  }
  // One statement AFTER the canonical row lock: never trust a client paid flag.
  // The existing PayFast initiation path charges total_amount, so partial
  // payments are deliberately blocked until the gateway path is adapted.
  const { rows: totals } = await db.query(
    `select coalesce(sum(amount) filter (where status='completed'),0) as paid,
            count(*) filter (where status='pending')::integer as pending_count
       from commerce.service_order_payments
      where tenant_id=$1 and service_order_id=$2`,
    [order.tenant_id, targetId]);
  const paid = totals[0]?.paid;
  const pending = Number(totals[0]?.pending_count);
  const total = order.total_amount;
  // Check product eligibility using the same default as the live checkout,
  // including requirement for matching service product configurations.
  const { rows: products } = await db.query(
    `select count(*)::integer as total_items,
            count(spc.product_id)::integer as configured_items,
            coalesce(bool_and(
              coalesce((spc.customer_definition->'paymentEligibility'->>'allowPayfast')::boolean,true)
            ),false) as allowed
       from commerce.service_order_items soi
       left join commerce.service_product_configs spc
         on spc.product_id=soi.product_id and spc.tenant_id=soi.tenant_id
      where soi.order_id=$1 and soi.tenant_id=$2`,
    [targetId, order.tenant_id]);
  const prod = products[0] || {};
  const metadata = order.source_metadata || {};
  const feePending = order.fulfilment_type === "delivery" &&
    metadata.deliveryFeeStatus !== "confirmed";
  const moneyValid = [total,paid,order.min_payfast].every(v =>
    v !== null && v !== undefined && Number.isFinite(Number(v)));
  const totalCents = moneyValid ? Math.round(Number(total)*100) : NaN;
  const paidCents = moneyValid ? Math.round(Number(paid)*100) : NaN;
  const minCents = moneyValid ? Math.round(Number(order.min_payfast)*100) : NaN;
  const balanceCents = totalCents - paidCents;
  const ready = moneyValid && Number.isSafeInteger(totalCents) &&
    Number.isSafeInteger(paidCents) && Number.isSafeInteger(minCents) &&
    Number.isSafeInteger(balanceCents) && totalCents > 0 &&
    paidCents === 0 && balanceCents > 0 && minCents >= 0 &&
    balanceCents >= minCents &&
    (order.payment_status === "unpaid" || order.payment_status === "pending") &&
    !["draft","cancelled","completed"].includes(order.status) &&
    metadata.quoteRequired !== true && metadata.paymentProjectionReview?.required !== true &&
    !feePending && pending === 0 &&
    Number.isInteger(Number(prod.total_items)) && Number(prod.total_items) > 0 &&
    Number(prod.total_items) === Number(prod.configured_items) && prod.allowed === true;

  return {
    tenantId: order.tenant_id,
    eligible: ready,
    reviewRequired: !ready,
    balanceCents: ready ? balanceCents : null,
  };
}
