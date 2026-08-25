import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePlacement, buildComponentPayload, buildSetupFeeCompanionPayload, resolveOrderPrice,
  resolveComponentScope, filterComponentsByScope,
} from '../src/lib/productComposition.js';

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

// ─────────────────────────────────────────────────────────────────────
// Phase 2B Step 3 - explicit component scope model (hardening #1). One
// deliberate { type, id? } shape, never two independently-optional IDs.
// ─────────────────────────────────────────────────────────────────────

test('resolveComponentScope: no scope / family scope both resolve to both columns explicitly null', () => {
  assert.deepEqual(resolveComponentScope(undefined), { garment_variant_id: null, treatment_id: null });
  assert.deepEqual(resolveComponentScope({ type: 'family' }), { garment_variant_id: null, treatment_id: null });
});

test('resolveComponentScope: variant scope sets garment_variant_id and explicitly nulls treatment_id', () => {
  assert.deepEqual(resolveComponentScope({ type: 'variant', id: 'v-1' }), { garment_variant_id: 'v-1', treatment_id: null });
});

test('resolveComponentScope: treatment scope sets treatment_id and explicitly nulls garment_variant_id', () => {
  assert.deepEqual(resolveComponentScope({ type: 'treatment', id: 't-1' }), { garment_variant_id: null, treatment_id: 't-1' });
});

test('resolveComponentScope: variant/treatment scope without an id throws rather than silently falling back to family scope', () => {
  assert.throws(() => resolveComponentScope({ type: 'variant' }));
  assert.throws(() => resolveComponentScope({ type: 'treatment' }));
});

test('resolveComponentScope: an unknown scope type throws rather than silently defaulting', () => {
  assert.throws(() => resolveComponentScope({ type: 'bogus' }));
});

test('buildComponentPayload always writes BOTH scope columns explicitly, regardless of which scope is passed - an edit switching FROM variant scope TO family scope (or vice versa) can never accidentally retain the previous scope, because every call recomputes both columns from scratch rather than only setting the one that changed', () => {
  const familyPayload = buildComponentPayload({ component_type: 'material' }, { clientProductId: 'cp-1', scope: { type: 'family' } });
  assert.equal(familyPayload.garment_variant_id, null);
  assert.equal(familyPayload.treatment_id, null);

  const variantPayload = buildComponentPayload({ component_type: 'material' }, { clientProductId: 'cp-1', scope: { type: 'variant', id: 'v-1' } });
  assert.equal(variantPayload.garment_variant_id, 'v-1');
  assert.equal(variantPayload.treatment_id, null);

  const treatmentPayload = buildComponentPayload({ component_type: 'material' }, { clientProductId: 'cp-1', scope: { type: 'treatment', id: 't-1' } });
  assert.equal(treatmentPayload.garment_variant_id, null);
  assert.equal(treatmentPayload.treatment_id, 't-1');

  // Simulates editing the SAME component (same object shape) but with a
  // different scope on each call - proves the two payloads never share a
  // stale field, since each is built fresh from resolveComponentScope.
  assert.notDeepEqual(variantPayload.garment_variant_id, treatmentPayload.garment_variant_id);
  assert.ok('garment_variant_id' in familyPayload && 'treatment_id' in familyPayload, 'both keys must always be present, never conditionally omitted');
});

test('buildComponentPayload defaults to family scope when no scope is passed at all - every pre-Step-3 call site keeps writing exactly what it always has', () => {
  const payload = buildComponentPayload({ component_type: 'material' }, { clientProductId: 'cp-1' });
  assert.equal(payload.garment_variant_id, null);
  assert.equal(payload.treatment_id, null);
});

test('filterComponentsByScope: family scope returns only components with BOTH scope columns null, never a variant- or treatment-scoped row', () => {
  const components = [
    { id: 'c1', garment_variant_id: null, treatment_id: null },
    { id: 'c2', garment_variant_id: 'v-1', treatment_id: null },
    { id: 'c3', garment_variant_id: null, treatment_id: 't-1' },
  ];
  const result = filterComponentsByScope(components, { type: 'family' });
  assert.deepEqual(result.map((c) => c.id), ['c1']);
});

test('filterComponentsByScope: variant scope returns only that variant\'s components, never family-level or treatment-scoped or another variant\'s', () => {
  const components = [
    { id: 'c1', garment_variant_id: null, treatment_id: null },
    { id: 'c2', garment_variant_id: 'v-1', treatment_id: null },
    { id: 'c3', garment_variant_id: 'v-2', treatment_id: null },
    { id: 'c4', garment_variant_id: null, treatment_id: 't-1' },
  ];
  const result = filterComponentsByScope(components, { type: 'variant', id: 'v-1' });
  assert.deepEqual(result.map((c) => c.id), ['c2']);
});

test('filterComponentsByScope: treatment scope returns only that treatment\'s components, never family-level or variant-scoped or another treatment\'s', () => {
  const components = [
    { id: 'c1', garment_variant_id: null, treatment_id: null },
    { id: 'c2', garment_variant_id: 'v-1', treatment_id: null },
    { id: 'c3', garment_variant_id: null, treatment_id: 't-1' },
    { id: 'c4', garment_variant_id: null, treatment_id: 't-2' },
  ];
  const result = filterComponentsByScope(components, { type: 'treatment', id: 't-1' });
  assert.deepEqual(result.map((c) => c.id), ['c3']);
});
