import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePlacement, buildComponentPayload, buildSetupFeeCompanionPayload, resolveOrderPrice } from '../src/lib/productComposition.js';

test('resolvePlacement falls through custom/none/preset correctly', () => {
  assert.equal(resolvePlacement({ placement: '__custom', placementCustom: '  Left cuff  ' }), 'Left cuff');
  assert.equal(resolvePlacement({ placement: '__custom', placementCustom: '   ' }), null);
  assert.equal(resolvePlacement({ placement: '__none' }), null);
  assert.equal(resolvePlacement({ placement: '' }), null);
  assert.equal(resolvePlacement({ placement: 'Front' }), 'Front');
});

test('buildComponentPayload never carries an order-specific price field', () => {
  const payload = buildComponentPayload({
    component_type: 'print_service',
    production_method: 'dtf',
    placement: 'Front',
    label: 'Front DTF',
    quantity_per_unit: 1,
    default_sell_price: '120',
    billing_mode: 'per_unit',
  }, { clientProductId: 'cp-1', sortOrder: 2 });

  assert.equal(payload.client_product_id, 'cp-1');
  assert.equal(payload.sort_order, 2);
  assert.equal(payload.default_sell_price, 120);
  assert.equal(payload.placement, 'Front');
  assert.ok(!('order_price' in payload), 'the reusable component payload has no order-specific concept at all');
});

test('buildComponentPayload nulls placement/method for non-print component types', () => {
  const payload = buildComponentPayload({
    component_type: 'blank_garment',
    inventory_product_id: 'inv-1',
    production_method: 'dtf',
    placement: 'Front',
    quantity_per_unit: 1,
    default_sell_price: '',
    billing_mode: 'per_unit',
  }, { clientProductId: 'cp-1' });

  assert.equal(payload.placement, null);
  assert.equal(payload.production_method, null);
  assert.equal(payload.inventory_product_id, 'inv-1');
  assert.equal(payload.default_sell_price, null);
});

test('buildSetupFeeCompanionPayload is always once_per_order and prefers the staff override over the production default', () => {
  const payload = buildSetupFeeCompanionPayload(
    { production_method: 'dtf', setupFee: '175' },
    { clientProductId: 'cp-1', sortOrder: 3, methodLabel: 'DTF', productionDefault: { default_setup_fee: 149 } }
  );
  assert.equal(payload.billing_mode, 'once_per_order');
  assert.equal(payload.default_sell_price, 175, 'staff override (175) wins over the production default (149)');
  assert.equal(payload.label, 'DTF setup');
  assert.equal(payload.quantity_per_unit, 1);
});

test('buildSetupFeeCompanionPayload falls back to the production default when staff leaves the override blank', () => {
  const payload = buildSetupFeeCompanionPayload(
    { production_method: 'embroidery', setupFee: '' },
    { clientProductId: 'cp-1', sortOrder: 1, methodLabel: 'Embroidery', productionDefault: { default_setup_fee: 350 } }
  );
  assert.equal(payload.default_sell_price, 350);
});

test('buildSetupFeeCompanionPayload never guesses a price when neither override nor default exists', () => {
  const payload = buildSetupFeeCompanionPayload(
    { production_method: 'screen', setupFee: '' },
    { clientProductId: 'cp-1', sortOrder: 1, methodLabel: 'Screen print', productionDefault: undefined }
  );
  assert.equal(payload.default_sell_price, null);
});

test('resolveOrderPrice: an order override is used when present and finite', () => {
  assert.equal(resolveOrderPrice('95', 120), 95, 'staff override wins over the reusable default');
});

test('resolveOrderPrice: falls back to the reusable component default without mutating it', () => {
  assert.equal(resolveOrderPrice('', 120), 120);
  assert.equal(resolveOrderPrice(null, 120), 120);
  assert.equal(resolveOrderPrice(undefined, 120), 120);
});

test('resolveOrderPrice: no default and no override resolves to null, not zero or NaN', () => {
  assert.equal(resolveOrderPrice('', null), null);
  assert.equal(resolveOrderPrice('not a number', 120), 120, 'a non-finite override input falls back to the default');
});
