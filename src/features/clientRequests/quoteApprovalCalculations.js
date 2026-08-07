// Pure calculation/validation helpers for the "approve quote request into a
// payable order" workflow (ClientRequests.jsx + api/clientRequests.js).
// Kept dependency-free and framework-free so they're directly unit-testable.
//
// Context: approve_client_quote_request / _activate_client_quote_request_order
// (X LAB migrations) accept p_items and p_total_amount as independent values -
// the database does not recompute or verify the total against the item lines
// itself. That check has to happen here, on the only caller that builds this
// payload, or a mismatched total could silently reach the database.

// True when a Supabase/PostgREST error message indicates the RPC itself
// isn't deployed yet (vs. a real business-logic error the RPC raised on
// purpose) - shared by every function in api/clientRequests.js so a missing
// migration degrades to an empty/disabled state instead of a scary error.
export function friendlyMissingMessage(message = "") {
  const lower = String(message || "").toLowerCase();
  return (
    lower.includes("get_internal_client_requests") ||
    lower.includes("update_internal_client_request_status") ||
    lower.includes("get_internal_client_file_library") ||
    lower.includes("upsert_internal_client_file_folder") ||
    lower.includes("upsert_internal_client_file_link") ||
    lower.includes("copy_internal_client_file_link") ||
    lower.includes("delete_internal_client_file_link") ||
    lower.includes("add_internal_client_message_reply") ||
    lower.includes("approve_client_quote_request") ||
    lower.includes("get_client_orders_awaiting_payment") ||
    lower.includes("could not find the function") ||
    lower.includes("does not exist")
  );
}

export const MAX_QUANTITY = 100000;
export const MAX_UNIT_PRICE = 10_000_000;
export const MAX_ITEMS = 100;

// Rounds to 2 decimal places using integer cents to avoid classic
// floating-point residue (e.g. 19.999999999999996).
export function roundMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

// Number("") is 0 and Number(null) is 0 in JS - both would otherwise pass a
// bare Number.isFinite check, silently turning "nothing entered" into "zero"
// which is a meaningfully different (and here, wrongly permissive) value.
function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function isFiniteNumber(value) {
  if (isBlank(value)) return false;
  return Number.isFinite(Number(value));
}

export function computeLineTotal(item) {
  const quantity = Number(item?.quantity);
  const unitPrice = Number(item?.unit_price);
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return 0;
  return roundMoney(quantity * unitPrice);
}

export function computeApprovalTotal(items = []) {
  return roundMoney(items.reduce((sum, item) => sum + computeLineTotal(item), 0));
}

// Returns { valid, errors, itemErrors } where itemErrors[i] is a string or
// null, so the UI can point at the specific offending row.
export function validateApprovalItems(items = []) {
  const errors = [];
  const itemErrors = items.map(() => null);

  if (!Array.isArray(items) || items.length === 0) {
    errors.push("Add at least one item.");
    return { valid: false, errors, itemErrors };
  }

  if (items.length > MAX_ITEMS) {
    errors.push(`No more than ${MAX_ITEMS} items are allowed on one approval.`);
  }

  items.forEach((item, index) => {
    const rowErrors = [];
    const name = String(item?.product_name ?? "").trim();
    const quantity = Number(item?.quantity);
    const unitPrice = Number(item?.unit_price);

    if (!name) rowErrors.push("Item name is required.");

    if (!isFiniteNumber(item?.quantity)) rowErrors.push("Quantity must be a number.");
    else if (quantity <= 0) rowErrors.push("Quantity must be greater than zero.");
    else if (quantity > MAX_QUANTITY) rowErrors.push(`Quantity cannot exceed ${MAX_QUANTITY.toLocaleString()}.`);

    if (!isFiniteNumber(item?.unit_price)) rowErrors.push("Price must be a number.");
    else if (unitPrice < 0) rowErrors.push("Price cannot be negative.");
    else if (unitPrice > MAX_UNIT_PRICE) rowErrors.push(`Price cannot exceed ${MAX_UNIT_PRICE.toLocaleString()}.`);

    if (rowErrors.length) {
      itemErrors[index] = rowErrors.join(" ");
      errors.push(`Item ${index + 1}: ${rowErrors.join(" ")}`);
    }
  });

  const total = computeApprovalTotal(items);
  if (errors.length === 0 && total <= 0) {
    errors.push("Total must be greater than zero.");
  }

  return { valid: errors.length === 0, errors, itemErrors };
}

// Builds the exact payload approveClientQuoteRequest/approve_client_quote_request
// expects: cleaned item rows (rounded, numeric) plus a total independently
// recomputed here (never trusts a caller-supplied total) so the two can never
// drift apart. Throws if the items don't pass validateApprovalItems - callers
// should validate first and only call this once the form is submittable.
export function buildApprovalPayload({ requestId, items = [], note = "" }) {
  const validation = validateApprovalItems(items);
  if (!validation.valid) {
    throw Object.assign(new Error(validation.errors[0] || "Invalid quote approval items."), {
      code: "QUOTE_APPROVAL_VALIDATION_FAILED",
      errors: validation.errors,
    });
  }

  // line_total is derived from the same rounded unit_price stored on the
  // item, not from the raw unrounded input - otherwise the displayed
  // unit_price * quantity could disagree with the stored line_total by a
  // cent, which is exactly the drift this function exists to prevent.
  const cleanedItems = items.map((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = roundMoney(item.unit_price);
    return {
      product_name: String(item.product_name).trim(),
      quantity,
      unit_price: unitPrice,
      line_total: roundMoney(quantity * unitPrice),
    };
  });

  return {
    requestId,
    items: cleanedItems,
    totalAmount: computeApprovalTotal(cleanedItems),
    note: String(note || "").trim() || null,
  };
}

// Maps a raw get_client_orders_awaiting_payment row into display-ready
// fields, tolerating missing/malformed values (e.g. an unparsable
// created_at) without throwing or rendering "Invalid Date"/"NaN".
export function formatAwaitingPaymentOrder(order = {}) {
  const amount = order.total_amount != null && Number.isFinite(Number(order.total_amount))
    ? Number(order.total_amount)
    : null;
  const parsedDate = order.created_at ? new Date(order.created_at) : null;
  const createdAt = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

  return {
    id: order.id ?? null,
    orderNumber: order.order_number || "Unknown order",
    customerLabel: order.customer_name || order.customer_email || "Unknown customer",
    amount,
    amountLabel: amount != null ? `R${amount.toLocaleString()}` : "",
    createdAt,
    sourceQuoteRequestId: order.source_quote_request_id ?? null,
  };
}

// Maps a raw Postgres/PostgREST error message from approve_client_quote_request
// to a clearer, more actionable one. Anything not specifically recognized is
// passed through unchanged - the underlying RPC's messages are already
// hand-written English, not error codes, so most cases need no translation.
export function describeApprovalError(rawMessage = "") {
  const message = String(rawMessage || "");
  if (/already been activated for payment/i.test(message)) {
    return "This request has already been approved and turned into an order. Refresh to see it under Awaiting Payment.";
  }
  if (/quote request not found/i.test(message)) {
    return "This request no longer exists. Refresh the list and try again.";
  }
  return message;
}

// Turns api/clientRequests.js's { data, error } convention into the
// react-query mutationFn contract QuoteApprovalSection's approve mutation
// needs: resolve with the unwrapped RPC data object on success (so
// onSuccess/onApproved see order_number/order_id/total_amount directly,
// not nested under .data), or throw so onError actually runs. Without this,
// { data: null, error: "..." } was treated as a "successful" mutation with
// an undefined order_number, and onApproved was never called - the bug the
// manual browser test found. Extracted as a pure function (no supabase/
// react-query import) so the contract itself is directly unit-testable.
export function resolveApprovalMutationResult({ data, error } = {}) {
  if (error) {
    throw new Error(error);
  }
  return data;
}

// Query keys shared between QuoteApprovalSection's approve mutation and the
// page-level Refresh button (ClientRequests.jsx), so both always target the
// exact same two sections instead of drifting apart.
export const CLIENT_REQUESTS_QUERY_KEY = ["clientRequests"];
export const CLIENT_ORDERS_AWAITING_PAYMENT_QUERY_KEY = ["clientOrdersAwaitingPayment"];

// Called from the approve mutation's onSuccess. Takes a minimal
// { invalidateQueries } duck-typed client (react-query's QueryClient
// satisfies this) so it's testable without rendering React.
export function invalidateAfterApproval(queryClient) {
  queryClient.invalidateQueries({ queryKey: CLIENT_REQUESTS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: CLIENT_ORDERS_AWAITING_PAYMENT_QUERY_KEY });
}

// Called from the page-level Refresh button. Refreshes both sections in
// parallel and reports whether either failed, so the caller can surface one
// combined error instead of the button silently refreshing only the first
// section (the bug: the old Refresh button only ever called the
// clientRequests query's refetch()).
export async function refreshAllSections({ refetchRequests, refetchAwaitingPayment }) {
  const [requestsResult, awaitingPaymentResult] = await Promise.all([
    refetchRequests(),
    refetchAwaitingPayment(),
  ]);
  return {
    requestsResult,
    awaitingPaymentResult,
    hasError: Boolean(requestsResult?.isError || awaitingPaymentResult?.isError),
  };
}

// Number(null)/Number(undefined) are 0 in JS, which would otherwise make a
// genuinely missing field render as "R0" (a real, misleadingly-free price)
// instead of "-" (unknown) - same isBlank guard validateApprovalItems uses.
function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Maps a raw get_client_quote_request_order row into the read-only display
// shape QuoteApprovalSection shows once a request is already approved -
// order number, saved line items (with per-line quantity/unit price/line
// total), and the grand total, tolerating missing/malformed values the same
// way formatAwaitingPaymentOrder does.
export function formatLinkedOrder(order = {}) {
  const rawItems = Array.isArray(order?.items) ? order.items : [];
  const items = rawItems.map((item) => {
    return {
      productName: item?.product_name ? String(item.product_name) : "Item",
      quantity: numberOrNull(item?.quantity),
      unitPrice: numberOrNull(item?.unit_price),
      lineTotal: numberOrNull(item?.line_total),
    };
  });

  const totalAmount = order.total_amount != null && Number.isFinite(Number(order.total_amount))
    ? Number(order.total_amount)
    : null;
  const parsedDate = order.created_at ? new Date(order.created_at) : null;
  const createdAt = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

  return {
    orderNumber: order.order_number || "Unknown order",
    items,
    totalAmount,
    totalAmountLabel: totalAmount != null ? `R${totalAmount.toLocaleString()}` : "",
    status: order.status || "pending_payment",
    createdAt,
  };
}
