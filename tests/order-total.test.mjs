import assert from 'node:assert/strict';
import test from 'node:test';
import { computeChargedShipping, computeOrderTotal, defaultApplyShippingFeeForFulfillment } from '../src/lib/orderTotal.js';

test('shipping ON adds the fee exactly once', () => {
  const result = computeOrderTotal({ itemsSubtotal: 95, applyShippingFee: true, shippingFee: 120 });
  assert.equal(result.itemsSubtotal, 95);
  assert.equal(result.chargedShipping, 120);
  assert.equal(result.total, 215);
});

test('shipping OFF bills zero regardless of a stored shipping_fee value', () => {
  const result = computeOrderTotal({ itemsSubtotal: 95, applyShippingFee: false, shippingFee: 120 });
  assert.equal(result.chargedShipping, 0);
  assert.equal(result.total, 95, 'never double count or silently bill a waived fee');
});

test('missing/null shipping_fee with the toggle ON treats it as zero, not NaN', () => {
  const result = computeOrderTotal({ itemsSubtotal: 95, applyShippingFee: true, shippingFee: null });
  assert.equal(result.chargedShipping, 0);
  assert.equal(result.total, 95);
});

test('computeChargedShipping matches computeOrderTotal\'s own shipping component', () => {
  assert.equal(computeChargedShipping({ applyShippingFee: true, shippingFee: 120 }), 120);
  assert.equal(computeChargedShipping({ applyShippingFee: false, shippingFee: 120 }), 0);
});

test('courier fulfillment defaults apply_shipping_fee to true', () => {
  assert.equal(defaultApplyShippingFeeForFulfillment('courier'), true);
});

test('collection and service_only fulfillment default apply_shipping_fee to false', () => {
  assert.equal(defaultApplyShippingFeeForFulfillment('collection'), false);
  assert.equal(defaultApplyShippingFeeForFulfillment('service_only'), false);
});

test('unknown/missing fulfillment_type falls back to the courier default (true)', () => {
  assert.equal(defaultApplyShippingFeeForFulfillment(undefined), true);
  assert.equal(defaultApplyShippingFeeForFulfillment(''), true);
});
