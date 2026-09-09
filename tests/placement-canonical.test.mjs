import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalPlacement } from '../src/features/orders/placement.js';

test('folds case', () => {
  assert.equal(canonicalPlacement('Front'), 'front');
  assert.equal(canonicalPlacement('BACK'), 'back');
  assert.equal(canonicalPlacement('Left Chest'), 'left chest');
});

test('trims and collapses internal whitespace', () => {
  assert.equal(canonicalPlacement('  Front  '), 'front');
  assert.equal(canonicalPlacement('Left   Chest'), 'left chest');
  assert.equal(canonicalPlacement('Left\tChest'), 'left chest');
  assert.equal(canonicalPlacement('Left \n Chest'), 'left chest');
});

test('empty / null / undefined -> empty string', () => {
  assert.equal(canonicalPlacement(''), '');
  assert.equal(canonicalPlacement('   '), '');
  assert.equal(canonicalPlacement(null), '');
  assert.equal(canonicalPlacement(undefined), '');
});

test('tolerates non-strings', () => {
  assert.equal(canonicalPlacement(0), '0');
  assert.equal(canonicalPlacement(12), '12');
});

test('idempotent', () => {
  for (const p of ['Front', '  Left  Chest ', 'BACK', 'sleeve']) {
    assert.equal(canonicalPlacement(canonicalPlacement(p)), canonicalPlacement(p));
  }
});

test('never merges genuinely distinct placements', () => {
  const seen = new Set(['Front', 'Back', 'Left Chest', 'Right Chest', 'Left Sleeve', 'Right Sleeve', 'Inside Neck', 'Neck Tag'].map(canonicalPlacement));
  assert.equal(seen.size, 8, 'the 8 PLACEMENT_PRESETS stay 8 distinct canonical keys');
});

test('SQL canonical_placement mirror is documented in the migration', async () => {
  const { readFile } = await import('node:fs/promises');
  const mig = await readFile(new URL('../supabase/migrations/20260909120000_canonical_placement_artwork_matching.sql', import.meta.url), 'utf8');
  // lower(btrim(regexp_replace(coalesce(...), '\s+', ' ', 'g'))) === JS trim+collapse+lower
  assert.ok(mig.includes("lower(btrim(regexp_replace(coalesce(p_placement, ''), '\\s+', ' ', 'g')))"),
    'the SQL helper must fold case + whitespace the same way as the JS helper');
});
