import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_ORDERS_AWAITING_PAYMENT_QUERY_KEY,
  CLIENT_REQUESTS_QUERY_KEY,
  MAX_QUANTITY,
  MAX_UNIT_PRICE,
  buildApprovalPayload,
  computeApprovalTotal,
  computeLineTotal,
  describeApprovalError,
  formatAwaitingPaymentOrder,
  formatLinkedOrder,
  friendlyMissingMessage,
  invalidateAfterApproval,
  isApprovedStatusLocked,
  refreshAllSections,
  resolveApprovalMutationResult,
  roundMoney,
  validateApprovalItems,
} from "../src/features/clientRequests/quoteApprovalCalculations.js";

// ---- roundMoney / line totals / grand totals ----

test("roundMoney fixes classic floating-point residue", () => {
  assert.equal(roundMoney(19.999999999999996), 20);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
});

test("roundMoney treats non-finite input as 0", () => {
  assert.equal(roundMoney(NaN), 0);
  assert.equal(roundMoney(Infinity), 0);
  assert.equal(roundMoney(undefined), 0);
});

test("computeLineTotal multiplies quantity by unit_price and rounds", () => {
  assert.equal(computeLineTotal({ quantity: 3, unit_price: 10.005 }), 30.02);
  assert.equal(computeLineTotal({ quantity: "4", unit_price: "2.5" }), 10);
});

test("computeLineTotal returns 0 for missing/invalid fields instead of NaN", () => {
  assert.equal(computeLineTotal({}), 0);
  assert.equal(computeLineTotal({ quantity: "abc", unit_price: 5 }), 0);
});

test("computeApprovalTotal sums line totals across items", () => {
  const items = [
    { quantity: 2, unit_price: 100 },
    { quantity: 1, unit_price: 49.99 },
  ];
  assert.equal(computeApprovalTotal(items), 249.99);
});

test("computeApprovalTotal of an empty list is 0", () => {
  assert.equal(computeApprovalTotal([]), 0);
});

// ---- validateApprovalItems ----

test("rejects an empty item list", () => {
  const result = validateApprovalItems([]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => /at least one item/i.test(message)));
});

test("rejects a blank product name", () => {
  const result = validateApprovalItems([{ product_name: "   ", quantity: 1, unit_price: 10 }]);
  assert.equal(result.valid, false);
  assert.match(result.itemErrors[0], /name is required/i);
});

test("rejects quantity of zero and negative quantity", () => {
  assert.equal(validateApprovalItems([{ product_name: "Shirt", quantity: 0, unit_price: 10 }]).valid, false);
  assert.equal(validateApprovalItems([{ product_name: "Shirt", quantity: -1, unit_price: 10 }]).valid, false);
});

test("rejects negative unit price but allows zero (free item)", () => {
  const negative = validateApprovalItems([{ product_name: "Shirt", quantity: 1, unit_price: -5 }]);
  assert.equal(negative.valid, false);
  assert.match(negative.itemErrors[0], /cannot be negative/i);

  // total must still be > 0 overall even if one free line item is allowed
  const zeroOnly = validateApprovalItems([{ product_name: "Free sample", quantity: 1, unit_price: 0 }]);
  assert.equal(zeroOnly.valid, false);
  assert.ok(zeroOnly.errors.some((message) => /total must be greater than zero/i.test(message)));
});

test("rejects non-numeric quantity and price, including empty strings", () => {
  const result = validateApprovalItems([{ product_name: "Shirt", quantity: "abc", unit_price: "" }]);
  assert.equal(result.valid, false);
  assert.match(result.itemErrors[0], /quantity must be a number/i);
  assert.match(result.itemErrors[0], /price must be a number/i);
});

test("rejects Infinity as a quantity or price (finite-number check, not just > 0)", () => {
  const result = validateApprovalItems([{ product_name: "Shirt", quantity: Infinity, unit_price: 10 }]);
  assert.equal(result.valid, false);
  assert.match(result.itemErrors[0], /quantity must be a number/i);
});

test("rejects quantities and prices beyond the sanity caps", () => {
  const overQty = validateApprovalItems([{ product_name: "Shirt", quantity: MAX_QUANTITY + 1, unit_price: 10 }]);
  assert.equal(overQty.valid, false);
  assert.match(overQty.itemErrors[0], /cannot exceed/i);

  const overPrice = validateApprovalItems([{ product_name: "Shirt", quantity: 1, unit_price: MAX_UNIT_PRICE + 1 }]);
  assert.equal(overPrice.valid, false);
  assert.match(overPrice.itemErrors[0], /cannot exceed/i);
});

test("accepts a well-formed item list and reports no errors", () => {
  const result = validateApprovalItems([
    { product_name: "T-shirt", quantity: 10, unit_price: 120 },
    { product_name: "Print", quantity: 10, unit_price: 25 },
  ]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.itemErrors, [null, null]);
});

test("multiple invalid rows are each reported independently", () => {
  const result = validateApprovalItems([
    { product_name: "", quantity: 1, unit_price: 10 },
    { product_name: "Fine", quantity: 1, unit_price: 10 },
    { product_name: "Bad qty", quantity: -1, unit_price: 10 },
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.itemErrors[0]);
  assert.equal(result.itemErrors[1], null);
  assert.ok(result.itemErrors[2]);
});

// ---- buildApprovalPayload ----

test("buildApprovalPayload produces a clean, numeric, rounded payload", () => {
  const payload = buildApprovalPayload({
    requestId: "req-1",
    items: [{ product_name: "  T-shirt  ", quantity: "3", unit_price: "33.25" }],
    note: "  Rush this one  ",
  });

  assert.equal(payload.requestId, "req-1");
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].product_name, "T-shirt");
  assert.equal(payload.items[0].quantity, 3);
  assert.equal(payload.items[0].unit_price, 33.25);
  assert.equal(payload.items[0].line_total, 99.75);
  assert.equal(payload.totalAmount, 99.75);
  assert.equal(payload.note, "Rush this one");
});

test("buildApprovalPayload's line_total is derived from the rounded unit_price, not the raw input (no cent drift)", () => {
  // 33.335 rounds to either 33.33 or 33.34 depending on float representation -
  // the point of this test is that whichever way it rounds, line_total must
  // equal quantity * that same rounded value, never quantity * the raw input.
  const payload = buildApprovalPayload({
    requestId: "req-1",
    items: [{ product_name: "Item", quantity: 3, unit_price: 33.335 }],
  });
  const roundedUnitPrice = payload.items[0].unit_price;
  assert.equal(payload.items[0].line_total, roundMoney(3 * roundedUnitPrice));
});

test("buildApprovalPayload's totalAmount always equals the sum of its own line_totals (cannot drift)", () => {
  const payload = buildApprovalPayload({
    requestId: "req-1",
    items: [
      { product_name: "A", quantity: 2, unit_price: 10.1 },
      { product_name: "B", quantity: 3, unit_price: 7.77 },
    ],
  });
  const sumOfLines = roundMoney(payload.items.reduce((sum, item) => sum + item.line_total, 0));
  assert.equal(payload.totalAmount, sumOfLines);
});

test("buildApprovalPayload converts an empty note to null, not an empty string", () => {
  const payload = buildApprovalPayload({
    requestId: "req-1",
    items: [{ product_name: "A", quantity: 1, unit_price: 10 }],
    note: "   ",
  });
  assert.equal(payload.note, null);
});

test("buildApprovalPayload throws a validation error instead of building a payload for invalid items", () => {
  assert.throws(
    () => buildApprovalPayload({ requestId: "req-1", items: [{ product_name: "", quantity: 1, unit_price: 10 }] }),
    (error) => error.code === "QUOTE_APPROVAL_VALIDATION_FAILED" && Array.isArray(error.errors)
  );
});

// ---- describeApprovalError ----

test("describeApprovalError gives actionable guidance for a duplicate approval attempt", () => {
  const friendly = describeApprovalError("This request has already been activated for payment.");
  assert.match(friendly, /already been approved/i);
  assert.match(friendly, /awaiting payment/i);
});

test("describeApprovalError gives actionable guidance when the request no longer exists", () => {
  const friendly = describeApprovalError("Quote request not found.");
  assert.match(friendly, /no longer exists/i);
});

test("describeApprovalError passes unrecognized messages through unchanged", () => {
  assert.equal(describeApprovalError("Total amount must be greater than zero."), "Total amount must be greater than zero.");
  assert.equal(describeApprovalError(""), "");
});

// ---- friendlyMissingMessage (shared with the rest of clientRequests.js) ----

test("friendlyMissingMessage recognizes the two new RPC names as not-yet-applied", () => {
  assert.equal(friendlyMissingMessage("Could not find the function public.approve_client_quote_request"), true);
  assert.equal(friendlyMissingMessage("Could not find the function public.get_client_orders_awaiting_payment"), true);
});

test("friendlyMissingMessage does not misclassify an unrelated real error as missing-function", () => {
  assert.equal(friendlyMissingMessage("Total amount must be greater than zero."), false);
  assert.equal(friendlyMissingMessage("This request has already been activated for payment."), false);
});

// ---- formatAwaitingPaymentOrder ----

test("formatAwaitingPaymentOrder maps a well-formed row", () => {
  const formatted = formatAwaitingPaymentOrder({
    id: "order-1",
    order_number: "XL-2026-000123",
    customer_name: "Jane Doe",
    customer_email: "jane@example.invalid",
    total_amount: 1234.5,
    created_at: "2026-08-05T10:00:00Z",
    source_quote_request_id: "req-1",
  });

  assert.equal(formatted.orderNumber, "XL-2026-000123");
  assert.equal(formatted.customerLabel, "Jane Doe");
  assert.equal(formatted.amount, 1234.5);
  assert.equal(formatted.amountLabel, "R1,234.5");
  assert.ok(formatted.createdAt instanceof Date);
  assert.equal(formatted.sourceQuoteRequestId, "req-1");
});

test("formatAwaitingPaymentOrder falls back to customer_email when customer_name is missing", () => {
  const formatted = formatAwaitingPaymentOrder({ customer_email: "jane@example.invalid" });
  assert.equal(formatted.customerLabel, "jane@example.invalid");
});

test("formatAwaitingPaymentOrder never throws and never renders 'Invalid Date'/'NaN' for malformed input", () => {
  const formatted = formatAwaitingPaymentOrder({
    order_number: null,
    customer_name: null,
    customer_email: null,
    total_amount: "not-a-number",
    created_at: "not-a-date",
  });

  assert.equal(formatted.orderNumber, "Unknown order");
  assert.equal(formatted.customerLabel, "Unknown customer");
  assert.equal(formatted.amount, null);
  assert.equal(formatted.amountLabel, "");
  assert.equal(formatted.createdAt, null);
});

test("formatAwaitingPaymentOrder handles a completely empty row", () => {
  const formatted = formatAwaitingPaymentOrder({});
  assert.equal(formatted.orderNumber, "Unknown order");
  assert.equal(formatted.amountLabel, "");
  assert.equal(formatted.createdAt, null);
});

// ---- resolveApprovalMutationResult (the approval mutation contract fix) ----
// The manual browser test found that approveClientQuoteRequest's
// { data, error } return value was passed straight into react-query's
// onSuccess, so result.order_number was always undefined (it was nested at
// result.data.order_number instead) and onApproved was never called. These
// tests cover the exact success/failure shapes api/clientRequests.js
// produces.

test("resolveApprovalMutationResult returns the unwrapped RPC data object on success", () => {
  const rpcData = { ok: true, order_id: "order-1", order_number: "XL-2026-000123", total_amount: 1500 };
  const result = resolveApprovalMutationResult({ data: rpcData, error: null });
  assert.equal(result, rpcData);
  assert.equal(result.order_number, "XL-2026-000123");
});

test("resolveApprovalMutationResult throws (not resolves) when the API layer reports an error", () => {
  assert.throws(
    () => resolveApprovalMutationResult({ data: null, error: "This request has already been activated for payment." }),
    (error) => error instanceof Error && error.message === "This request has already been activated for payment."
  );
});

test("resolveApprovalMutationResult throws a clear error instead of resolving undefined when there is no error and no data", () => {
  assert.throws(() => resolveApprovalMutationResult(undefined), /no order/i);
  assert.throws(() => resolveApprovalMutationResult({ data: null, error: null }), /no order/i);
  assert.throws(() => resolveApprovalMutationResult({}), /no order/i);
});

// ---- invalidateAfterApproval / refreshAllSections (both-sections refresh) ----
// The Refresh button only ever refetched clientRequests, leaving Awaiting
// Payment stale; onApproved had the same one-sided problem via
// invalidateQueries. Both are exercised here against a minimal fake
// queryClient/refetch pair so the "both keys, every time" contract is
// covered without rendering React.

test("invalidateAfterApproval invalidates both the requests and awaiting-payment query keys", () => {
  const calls = [];
  const fakeQueryClient = { invalidateQueries: (arg) => calls.push(arg.queryKey) };

  invalidateAfterApproval(fakeQueryClient);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], CLIENT_REQUESTS_QUERY_KEY);
  assert.deepEqual(calls[1], CLIENT_ORDERS_AWAITING_PAYMENT_QUERY_KEY);
});

test("refreshAllSections calls both refetchers and reports no error when both succeed", async () => {
  let requestsCalled = false;
  let awaitingPaymentCalled = false;

  const result = await refreshAllSections({
    refetchRequests: async () => { requestsCalled = true; return { isError: false }; },
    refetchAwaitingPayment: async () => { awaitingPaymentCalled = true; return { isError: false }; },
  });

  assert.equal(requestsCalled, true);
  assert.equal(awaitingPaymentCalled, true);
  assert.equal(result.hasError, false);
});

test("refreshAllSections reports an error if either section fails to refresh", async () => {
  const bothCalled = await refreshAllSections({
    refetchRequests: async () => ({ isError: true }),
    refetchAwaitingPayment: async () => ({ isError: false }),
  });
  assert.equal(bothCalled.hasError, true);

  const otherWayRound = await refreshAllSections({
    refetchRequests: async () => ({ isError: false }),
    refetchAwaitingPayment: async () => ({ isError: true }),
  });
  assert.equal(otherWayRound.hasError, true);
});

// ---- formatLinkedOrder (read-only saved-order display) ----
// When an approved request is reopened, staff must still see the price that
// was set at approval time (the original client request payload never had
// one). These tests cover the shape get_client_quote_request_order returns
// and formatLinkedOrder's tolerance of missing/malformed fields, mirroring
// the formatAwaitingPaymentOrder tests above.

test("formatLinkedOrder maps a well-formed order with line items", () => {
  const formatted = formatLinkedOrder({
    order_number: "XL-2026-000123",
    items: [
      { product_name: "Local test t-shirt", quantity: 20, unit_price: 120, line_total: 2400 },
    ],
    total_amount: 2400,
    status: "pending_payment",
    created_at: "2026-08-05T10:00:00Z",
  });

  assert.equal(formatted.orderNumber, "XL-2026-000123");
  assert.equal(formatted.items.length, 1);
  assert.equal(formatted.items[0].productName, "Local test t-shirt");
  assert.equal(formatted.items[0].quantity, 20);
  assert.equal(formatted.items[0].unitPrice, 120);
  assert.equal(formatted.items[0].lineTotal, 2400);
  assert.equal(formatted.totalAmount, 2400);
  assert.equal(formatted.totalAmountLabel, "R2,400");
  assert.equal(formatted.status, "pending_payment");
  assert.ok(formatted.createdAt instanceof Date);
});

test("formatLinkedOrder tolerates missing/malformed fields without throwing", () => {
  const formatted = formatLinkedOrder({
    order_number: null,
    items: null,
    total_amount: "not-a-number",
    status: null,
    created_at: "not-a-date",
  });

  assert.equal(formatted.orderNumber, "Unknown order");
  assert.deepEqual(formatted.items, []);
  assert.equal(formatted.totalAmount, null);
  assert.equal(formatted.totalAmountLabel, "");
  assert.equal(formatted.status, "pending_payment");
  assert.equal(formatted.createdAt, null);
});

test("formatLinkedOrder handles a completely empty row", () => {
  const formatted = formatLinkedOrder({});
  assert.equal(formatted.orderNumber, "Unknown order");
  assert.deepEqual(formatted.items, []);
  assert.equal(formatted.totalAmountLabel, "");
});

test("formatLinkedOrder falls back per-field within a malformed item instead of dropping the whole row", () => {
  const formatted = formatLinkedOrder({
    order_number: "XL-2026-000999",
    items: [{ product_name: null, quantity: "abc", unit_price: 50, line_total: null }],
    total_amount: 50,
  });

  assert.equal(formatted.items[0].productName, "Item");
  assert.equal(formatted.items[0].quantity, null);
  assert.equal(formatted.items[0].unitPrice, 50);
  assert.equal(formatted.items[0].lineTotal, null);
});

// ---- isApprovedStatusLocked (approved quote/reorder requests are fully read-only) ----
// Browser acceptance found the Status selector still rendered (narrowed to
// actioned/closed, but not hidden) for an already-approved request. The
// requirement is stronger: once linked to a payable order, the request must
// be fully read-only in the UI - no selector at all. The DB-level guard in
// 202608060003_quote_approval_regression_guard_and_order_lookup.sql stays
// as defence in depth regardless of what the UI offers.

test("quote_request + actioned is locked", () => {
  assert.equal(isApprovedStatusLocked("quote_request", "actioned"), true);
});

test("quote_request + closed is locked", () => {
  assert.equal(isApprovedStatusLocked("quote_request", "closed"), true);
});

test("reorder_request + actioned is locked", () => {
  assert.equal(isApprovedStatusLocked("reorder_request", "actioned"), true);
});

test("reorder_request + closed is locked", () => {
  assert.equal(isApprovedStatusLocked("reorder_request", "closed"), true);
});

test("quote_request + reviewing is not locked", () => {
  assert.equal(isApprovedStatusLocked("quote_request", "reviewing"), false);
});

test("message + actioned is not locked (only quote_request/reorder_request are regression-protected)", () => {
  assert.equal(isApprovedStatusLocked("message", "actioned"), false);
});
