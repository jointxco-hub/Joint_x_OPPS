import assert from 'node:assert/strict';
import test from 'node:test';
import { annotateProductionDataConflicts } from '../src/features/invoices/orderToInvoiceItems.js';

test('a changed line with production data is flagged, a changed line without it is not', () => {
  const diff = {
    updated: [
      { line_id: 'line-1', name: 'T-Shirt', before: { quantity: 2 }, after: { quantity: 4 } },
      { line_id: 'line-2', name: 'Labels', before: { quantity: 1 }, after: { quantity: 3 } },
    ],
    missingFromInvoice: [],
  };
  const result = annotateProductionDataConflicts(diff, ['line-1']);
  assert.equal(result.updated[0].hasProductionData, true, 'line-1 has reservations/snapshots and must warn');
  assert.equal(result.updated[1].hasProductionData, undefined, 'line-2 has none and must not be flagged');
});

test('a removal candidate with production data requires stronger confirmation via the same flag', () => {
  const diff = {
    updated: [],
    missingFromInvoice: [{ line_id: 'line-3', name: 'Banner' }],
  };
  const result = annotateProductionDataConflicts(diff, ['line-3']);
  assert.equal(result.missingFromInvoice[0].hasProductionData, true);
});

test('production data must never be mutated by the annotation itself - purely additive flags', () => {
  const diff = { updated: [{ line_id: 'line-1', name: 'X', before: {}, after: {} }], missingFromInvoice: [] };
  const result = annotateProductionDataConflicts(diff, []);
  assert.deepEqual(result.updated[0], { line_id: 'line-1', name: 'X', before: {}, after: {} });
});
