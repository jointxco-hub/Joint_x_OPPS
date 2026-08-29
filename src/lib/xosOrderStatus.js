// Client-safe order status presentation for XOS.
//
// get_xos_orders_for_host() returns two raw fields per order:
//   - status: orders.status (5 real values observed in production:
//     confirmed, in_production, ready, shipped, delivered)
//   - stage: coalesce(orders.production_detail_stage, orders.pipeline_stage,
//     orders.status, 'confirmed') - this can surface much more granular
//     internal vocabulary (print_setup, artwork_check, queued_pressing,
//     customer_complaint, materials_delayed, rework, qa, ...), observed
//     directly from production data.
//
// Every value below was taken from an actual `group by status` /
// `group by production_detail_stage, pipeline_stage` query against the
// live orders table - nothing here is invented. Unmapped/future values
// fall back to a safe generic label rather than leaking the raw internal
// string to a client.

const STAGE_LABELS = {
  // pipeline_stage values
  received: 'Order received',
  payment_pending: 'Awaiting payment',
  paid: 'Payment confirmed',
  design_pending_approval: 'Design pending your approval',
  design_approved: 'Design approved',
  production: 'In production',
  packing: 'Packing',
  qa: 'Quality check',
  rework: 'On hold',
  customer_complaint: 'On hold',
  materials_delayed: 'On hold',
  // production_detail_stage values
  artwork_setup: 'Preparing artwork',
  artwork_check: 'Reviewing artwork',
  print_setup: 'Preparing for production',
  materials_check: 'Checking materials',
  queued_pressing: 'Queued for production',
  pressing: 'In production',
  quality_check: 'Quality check',
  custom: 'In progress',
  // status values also reach `stage` as the final coalesce fallback
  confirmed: 'Confirmed',
  in_production: 'In production',
  ready: 'Ready',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

// Stage values that should always read as "on hold" regardless of the
// order's primary status - these represent something needing attention,
// not normal forward progress.
const HOLD_STAGES = new Set(['rework', 'customer_complaint', 'materials_delayed']);

// Stages that represent pre-production work (design/artwork/materials
// prep) rather than the item physically being made yet.
const PREPARING_STAGES = new Set([
  'artwork_setup',
  'artwork_check',
  'print_setup',
  'materials_check',
  'design_pending_approval',
  'design_approved',
  'payment_pending',
]);

const QUALITY_CHECK_STAGES = new Set(['quality_check', 'qa']);

const PRIMARY_LABELS = {
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  in_production: 'In Production',
  quality_check: 'Quality Check',
  ready: 'Ready',
  shipped: 'Shipped',
  completed: 'Completed',
  on_hold: 'On Hold',
};

const PRIMARY_TONE = {
  confirmed: 'info',
  preparing: 'info',
  in_production: 'warning',
  quality_check: 'warning',
  ready: 'success',
  shipped: 'success',
  completed: 'success',
  on_hold: 'destructive',
};

// Fulfillment-aware wording for the "ready" key only - every other label
// is untouched. Falls back to the plain "Ready" label whenever
// fulfillment_type is missing or not one of these two real values
// (orders.fulfillment_type: 'collection' | 'courier', confirmed live) -
// never guessed, never left blank.
const READY_LABEL_BY_FULFILLMENT = {
  collection: 'Ready for collection',
  courier: 'Ready for dispatch',
};

// The single client-safe badge shown on the order list/detail. Combines
// status (the reliable, low-cardinality field) with stage (more granular,
// used only to refine within a status or detect a hold condition).
export function getClientSafeOrderStatus(order) {
  const status = order?.status ?? '';
  const stage = order?.stage ?? '';

  let key = 'confirmed';

  if (HOLD_STAGES.has(stage)) {
    key = 'on_hold';
  } else if (status === 'delivered') {
    key = 'completed';
  } else if (status === 'shipped') {
    key = 'shipped';
  } else if (status === 'ready') {
    key = QUALITY_CHECK_STAGES.has(stage) ? 'quality_check' : 'ready';
  } else if (status === 'in_production') {
    key = PREPARING_STAGES.has(stage) ? 'preparing' : 'in_production';
  } else if (status === 'confirmed') {
    key = 'confirmed';
  }

  const label = key === 'ready'
    ? READY_LABEL_BY_FULFILLMENT[order?.fulfillment_type] ?? PRIMARY_LABELS.ready
    : PRIMARY_LABELS[key];

  return { key, label, tone: PRIMARY_TONE[key] };
}

// Payment presentation is deliberately independent of order/production
// progress above - a parallel concept, never merged into the primary
// status key or label. Real live values only: 'paid', 'pending' (both
// XOS RPCs now coalesce a missing payment_status to 'pending' before it
// ever reaches here). Returns null for anything else so callers can
// choose to render nothing rather than a guessed label.
const PAYMENT_STATUS_LABELS = {
  paid: 'Paid',
  pending: 'Awaiting payment',
};

const PAYMENT_STATUS_TONE = {
  paid: 'success',
  pending: 'warning',
};

export function getClientPaymentStatus(order) {
  const paymentStatus = order?.payment_status ?? '';
  if (!PAYMENT_STATUS_LABELS[paymentStatus]) return null;
  return {
    key: paymentStatus,
    label: PAYMENT_STATUS_LABELS[paymentStatus],
    tone: PAYMENT_STATUS_TONE[paymentStatus],
  };
}

// A secondary, more specific line ("what's happening right now"). Falls
// back to the primary label rather than ever showing a raw internal string.
export function getOrderStageDetail(order) {
  const stage = order?.stage ?? '';
  if (STAGE_LABELS[stage]) return STAGE_LABELS[stage];
  return getClientSafeOrderStatus(order).label;
}

export const ORDER_STATUS_BADGE_CLASSES = {
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  destructive: 'bg-red-50 text-red-700 border-red-200',
};
