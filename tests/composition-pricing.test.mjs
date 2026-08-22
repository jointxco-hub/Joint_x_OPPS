import assert from 'node:assert/strict';
import test from 'node:test';
import { computeCompositionPricing } from '../src/lib/compositionPricing.js';

test('default billing mode (per_unit, implied when omitted) is multiplied by quantity', () => {
  const result = computeCompositionPricing([{ sell_price: 120 }], 10);
  assert.equal(result.perUnitSubtotal, 120);
  assert.equal(result.lineSubtotal, 1200);
  assert.equal(result.onceOffTotal, 0);
  assert.equal(result.lineTotal, 1200);
});

test('once_per_order components are never multiplied by quantity', () => {
  const result = computeCompositionPricing([
    { billing_mode: 'per_unit', sell_price: 120 },
    { billing_mode: 'once_per_order', sell_price: 149 },
  ], 10);
  assert.equal(result.onceOff.length, 1);
  assert.equal(result.onceOffTotal, 149);
  assert.equal(result.lineSubtotal, 1200);
  assert.equal(result.lineTotal, 1349, 'setup fee must be added once, not multiplied by quantity');
});

test('qty 10 does not multiply the setup fee - exact SFR worked example', () => {
  // Garment R120, Front DTF R95, Back DTF R80, all per_unit; DTF setup
  // R149 once_per_order; quantity 10 - matches the exact example from
  // the implementation request: unit total 295, line 2950, +149 = 3099.
  const result = computeCompositionPricing([
    { billing_mode: 'per_unit', sell_price: 120, label: 'Garment' },
    { billing_mode: 'per_unit', sell_price: 95, label: 'Front DTF' },
    { billing_mode: 'per_unit', sell_price: 80, label: 'Back DTF' },
    { billing_mode: 'once_per_order', sell_price: 149, label: 'DTF setup' },
  ], 10);
  assert.equal(result.perUnitSubtotal, 295);
  assert.equal(result.lineSubtotal, 2950);
  assert.equal(result.onceOffTotal, 149);
  assert.equal(result.lineTotal, 3099);
});

test('setup fee can be omitted entirely with no effect on per-unit math', () => {
  const withSetup = computeCompositionPricing([
    { billing_mode: 'per_unit', sell_price: 120 },
    { billing_mode: 'once_per_order', sell_price: 149 },
  ], 5);
  const withoutSetup = computeCompositionPricing([
    { billing_mode: 'per_unit', sell_price: 120 },
  ], 5);
  assert.equal(withSetup.perUnitSubtotal, withoutSetup.perUnitSubtotal);
  assert.equal(withSetup.lineSubtotal, withoutSetup.lineSubtotal);
  assert.equal(withoutSetup.onceOffTotal, 0);
  assert.equal(withoutSetup.lineTotal, withoutSetup.lineSubtotal);
});

test('multiple once_per_order components each count once, never per unit', () => {
  const result = computeCompositionPricing([
    { billing_mode: 'once_per_order', sell_price: 149 },
    { billing_mode: 'once_per_order', sell_price: 350 },
  ], 20);
  assert.equal(result.onceOffTotal, 499);
  assert.equal(result.lineSubtotal, 0);
  assert.equal(result.lineTotal, 499);
});

test('non-finite or missing sell_price values are treated as zero, never NaN', () => {
  const result = computeCompositionPricing([
    { billing_mode: 'per_unit', sell_price: null },
    { billing_mode: 'per_unit', sell_price: undefined },
    { billing_mode: 'per_unit', sell_price: 'not a number' },
    { billing_mode: 'per_unit', sell_price: 50 },
  ], 3);
  assert.equal(result.perUnitSubtotal, 50);
  assert.equal(result.lineSubtotal, 150);
  assert.ok(Number.isFinite(result.lineTotal));
});

test('a non-positive or non-finite quantity falls back to 1 rather than zeroing/breaking the total', () => {
  const zero = computeCompositionPricing([{ sell_price: 100 }], 0);
  const negative = computeCompositionPricing([{ sell_price: 100 }], -5);
  const missing = computeCompositionPricing([{ sell_price: 100 }], undefined);
  assert.equal(zero.lineSubtotal, 100);
  assert.equal(negative.lineSubtotal, 100);
  assert.equal(missing.lineSubtotal, 100);
});
