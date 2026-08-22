import assert from 'node:assert/strict';
import test from 'node:test';
import { computeStockDryRun } from '../src/lib/stockDryRun.js';

test('fully reserved current order does not show a false shortage, even with negative raw availability', () => {
  // The exact reported bug: required 2, on hand 0 (unverified), and the
  // ONLY active reservation for the variant is this order's own 2 units
  // - naive math (on_hand - total_reserved) would claim "Short 4".
  const result = computeStockDryRun({
    required: 2,
    onHandQty: 0,
    totalActiveReserved: 2,
    thisOrderReserved: 2,
    verified: false,
  });
  assert.equal(result.reservedElsewhere, 0);
  assert.equal(result.unreservedRequired, 0);
  assert.equal(result.short, 0);
  assert.equal(result.fullyReservedForThisOrder, true);
  assert.equal(result.status, 'Fully reserved · Stock balance unverified');
});

test('partially reserved order calculates remaining shortage correctly', () => {
  // This order needs 5, has already reserved 2 of them, on hand is
  // verified at 1, nothing reserved elsewhere.
  const result = computeStockDryRun({
    required: 5,
    onHandQty: 1,
    totalActiveReserved: 2,
    thisOrderReserved: 2,
    verified: true,
  });
  assert.equal(result.unreservedRequired, 3, 'still needs 3 more beyond what it already reserved');
  assert.equal(result.reservedElsewhere, 0);
  assert.equal(result.availableToThisOrder, 1);
  assert.equal(result.short, 2, '3 still needed minus the 1 physically available');
  assert.equal(result.status, 'Short 2');
});

test('stock reserved by other orders reduces available quantity', () => {
  // On hand 5 (verified), total active reservations 3 (this order has 2,
  // someone else has 1) - reserved elsewhere must isolate that 1.
  const result = computeStockDryRun({
    required: 2,
    onHandQty: 5,
    totalActiveReserved: 3,
    thisOrderReserved: 2,
    verified: true,
  });
  assert.equal(result.reservedElsewhere, 1);
  assert.equal(result.availableToThisOrder, 4);
  assert.equal(result.unreservedRequired, 0, 'already fully reserved for this order');
  assert.equal(result.short, 0);
});

test('other-order reservations can still produce a real shortage for an unreserved requirement', () => {
  // This order has reserved nothing yet, needs 3, on hand is verified at
  // 1, and another order has already claimed the only unit reserved.
  const result = computeStockDryRun({
    required: 3,
    onHandQty: 1,
    totalActiveReserved: 1,
    thisOrderReserved: 0,
    verified: true,
  });
  assert.equal(result.reservedElsewhere, 1);
  assert.equal(result.availableToThisOrder, 0);
  assert.equal(result.unreservedRequired, 3);
  assert.equal(result.short, 3);
  assert.equal(result.status, 'Short 3');
});

test('unverified wording is used whenever balance_verified_at is absent, independent of shortage', () => {
  const result = computeStockDryRun({
    required: 4,
    onHandQty: 0,
    totalActiveReserved: 0,
    thisOrderReserved: 0,
    verified: false,
  });
  assert.equal(result.fullyReservedForThisOrder, false);
  assert.match(result.status, /Stock balance unverified/);
  assert.match(result.status, /Needs 4 more reserved/);
});

test('verified stock with zero shortage reports as sufficient, not as a false short claim', () => {
  const result = computeStockDryRun({
    required: 2,
    onHandQty: 10,
    totalActiveReserved: 2,
    thisOrderReserved: 2,
    verified: true,
  });
  assert.equal(result.short, 0);
  assert.equal(result.status, 'Sufficient stock');
});

test('missing/non-finite inputs are treated as zero, never NaN or negative', () => {
  const result = computeStockDryRun({
    required: undefined,
    onHandQty: null,
    totalActiveReserved: 'not a number',
    thisOrderReserved: -5,
    verified: false,
  });
  assert.equal(result.required, 0);
  assert.equal(result.onHandQty, 0);
  assert.equal(result.totalActiveReserved, 0);
  assert.equal(result.thisOrderReserved, 0);
  assert.ok(Number.isFinite(result.short));
  assert.equal(result.short, 0);
});
