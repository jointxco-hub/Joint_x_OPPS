import assert from 'node:assert/strict';
import test from 'node:test';
import { getCourierRequirementGap } from '../src/lib/shippingRequirements.js';

test('collection and service_only orders never need courier details', () => {
  assert.equal(getCourierRequirementGap({ fulfillmentType: 'collection', courier: '', courierCode: '' }), null);
  assert.equal(getCourierRequirementGap({ fulfillmentType: 'service_only', courier: '', courierCode: '' }), null);
});

test('courier fulfillment with no courier selected is flagged', () => {
  assert.equal(getCourierRequirementGap({ fulfillmentType: 'courier', courier: '', courierCode: '' }), 'Courier not selected');
  // fulfillmentType omitted defaults to 'courier', matching the migration's column default
  assert.equal(getCourierRequirementGap({ courier: '', courierCode: '' }), 'Courier not selected');
});

test('a selected code-requiring courier with no code is flagged, even though a courier IS selected', () => {
  assert.equal(getCourierRequirementGap({ fulfillmentType: 'courier', courier: 'pep_paxi', courierCode: '' }), 'PAXI code missing');
  assert.equal(getCourierRequirementGap({ fulfillmentType: 'courier', courier: 'the_courier_guy', courierCode: '' }), 'Courier Guy code missing');
});

test('a code-requiring courier WITH a code is not flagged', () => {
  assert.equal(getCourierRequirementGap({ fulfillmentType: 'courier', courier: 'pep_paxi', courierCode: 'PX123' }), null);
  assert.equal(getCourierRequirementGap({ fulfillmentType: 'courier', courier: 'the_courier_guy', courierCode: 'CG456' }), null);
});

test('waybill-based couriers need no code once selected', () => {
  for (const courier of ['aramex', 'dhl', 'fedex', 'fastway', 'sa_post', 'dawn_wing', 'other']) {
    assert.equal(getCourierRequirementGap({ fulfillmentType: 'courier', courier, courierCode: '' }), null, courier);
  }
});
