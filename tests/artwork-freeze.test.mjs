import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// artworkFreeze.js now imports canonicalPlacement from
// @/features/orders/placement (the @/ alias does not resolve under
// node --test). Load the source, swap the aliased import for the real
// inline equivalent, and import the shim - same convention as
// tests/orders-client-product-picker.test.mjs. A separate source-string
// test asserts the real import is present so this can't mask a divergence.
async function loadArtworkFreeze() {
  const src = (await readFile(new URL('../src/lib/artworkFreeze.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const shimmed = src.replace(
    'import { canonicalPlacement } from "@/features/orders/placement";',
    'const canonicalPlacement = (raw) => String(raw ?? "").trim().replace(/\\s+/g, " ").toLowerCase();',
  );
  return import(`data:text/javascript;base64,${Buffer.from(shimmed).toString('base64')}`);
}
const { buildArtworkByPlacement, lookupArtworkByPlacement, resolveArtworkRevisionIds } = await loadArtworkFreeze();

test('artworkFreeze imports canonicalPlacement from the shared placement module', async () => {
  const src = (await readFile(new URL('../src/lib/artworkFreeze.js', import.meta.url), 'utf8'));
  assert.ok(src.includes('from "@/features/orders/placement"'), 'must reuse the shared helper, not a private copy');
});

test('buildArtworkByPlacement keys current revisions by CANONICAL placement', () => {
  const rows = [
    { id: 'art-front', placement: 'Front', is_current: true },
    { id: 'art-back', placement: 'Back', is_current: true },
  ];
  const map = buildArtworkByPlacement(rows);
  assert.equal(map.get('front').id, 'art-front');
  assert.equal(map.get('back').id, 'art-back');
  assert.equal(map.get('sleeve'), undefined, 'no revision exists for a placement not in the rows');
});

test('lookupArtworkByPlacement: Title-Case component placement resolves lowercase artwork (the bug this fixes)', () => {
  const map = buildArtworkByPlacement([
    { id: 'rev-front', placement: 'front', is_current: true, file_name: 'front.png' },
    { id: 'rev-back', placement: 'back', is_current: true },
  ]);
  assert.deepEqual(lookupArtworkByPlacement(map, 'Front'), { artwork: map.get('front'), ambiguous: false });
  assert.equal(lookupArtworkByPlacement(map, 'Front').artwork.id, 'rev-front');
  assert.equal(lookupArtworkByPlacement(map, 'BACK').artwork.id, 'rev-back');
});

test('lookupArtworkByPlacement: whitespace/case variants of the same placement resolve to one row', () => {
  const map = buildArtworkByPlacement([{ id: 'rev-lc', placement: 'Left Chest', is_current: true }]);
  assert.equal(lookupArtworkByPlacement(map, 'left  chest').artwork.id, 'rev-lc');
  assert.equal(lookupArtworkByPlacement(map, '  LEFT CHEST ').artwork.id, 'rev-lc');
});

test('distinct placements are never merged', () => {
  const map = buildArtworkByPlacement([
    { id: 'f', placement: 'Front', is_current: true },
    { id: 'b', placement: 'Back', is_current: true },
  ]);
  assert.equal(lookupArtworkByPlacement(map, 'front').artwork.id, 'f');
  assert.equal(lookupArtworkByPlacement(map, 'back').artwork.id, 'b');
});

test('AMBIGUOUS: two distinct current rows folding to one canonical placement -> no row is chosen, ambiguous flagged', () => {
  const map = buildArtworkByPlacement([
    { id: 'rev-lower', placement: 'front', is_current: true },
    { id: 'rev-title', placement: 'Front', is_current: true },
  ]);
  const entry = map.get('front');
  assert.equal(entry.ambiguous, true);
  assert.equal(entry.rows.length, 2);
  const resolved = lookupArtworkByPlacement(map, 'FRONT');
  assert.deepEqual(resolved, { artwork: null, ambiguous: true }, 'must never silently pick one of the split revisions');
  assert.deepEqual(resolveArtworkRevisionIds(resolved), [], 'ambiguous freezes to nothing, never a guessed id');
});

test('the SAME row appearing twice is not treated as a conflict', () => {
  const row = { id: 'same', placement: 'Front', is_current: true };
  const map = buildArtworkByPlacement([row, { ...row }]);
  assert.equal(map.get('front').ambiguous, undefined);
  assert.equal(lookupArtworkByPlacement(map, 'front').artwork.id, 'same');
});

test('buildArtworkByPlacement ignores rows with no placement and handles empty/missing input', () => {
  assert.equal(buildArtworkByPlacement(undefined).size, 0);
  assert.equal(buildArtworkByPlacement([]).size, 0);
  const map = buildArtworkByPlacement([{ id: 'a', placement: null }, { id: 'b' }, { id: 'c', placement: '   ' }]);
  assert.equal(map.size, 0);
});

test('lookupArtworkByPlacement handles a non-Map / empty placement safely', () => {
  assert.deepEqual(lookupArtworkByPlacement(null, 'Front'), { artwork: null, ambiguous: false });
  assert.deepEqual(lookupArtworkByPlacement(new Map(), ''), { artwork: null, ambiguous: false });
});

test('exact artwork revision ID is frozen into the snapshot payload shape', () => {
  const artwork = { id: 'revision-uuid-123', placement: 'Front', file_name: 'SFR Main Logo.png' };
  assert.deepEqual(resolveArtworkRevisionIds(artwork), ['revision-uuid-123']);
});

test('resolveArtworkRevisionIds also accepts the { artwork } shape from lookupArtworkByPlacement', () => {
  assert.deepEqual(resolveArtworkRevisionIds({ artwork: { id: 'r9' }, ambiguous: false }), ['r9']);
  assert.deepEqual(resolveArtworkRevisionIds({ artwork: null, ambiguous: true }), []);
});

test('a component with no linked artwork freezes to an empty array, never null or a guess', () => {
  assert.deepEqual(resolveArtworkRevisionIds(null), []);
  assert.deepEqual(resolveArtworkRevisionIds(undefined), []);
  assert.deepEqual(resolveArtworkRevisionIds({ placement: 'Front' }), [], 'no id on the row means nothing to freeze');
});

test('later revisions for the same placement do not retroactively change what was already frozen', () => {
  const firstRevision = { id: 'revision-1', placement: 'Front' };
  const frozen = resolveArtworkRevisionIds(firstRevision);
  const secondRevision = { id: 'revision-2', placement: 'Front' };
  const laterCall = resolveArtworkRevisionIds(secondRevision);
  assert.deepEqual(frozen, ['revision-1']);
  assert.deepEqual(laterCall, ['revision-2']);
  assert.notEqual(frozen, laterCall, 'each call returns its own array, no shared mutable reference');
});

// ── ProductsEditor wiring: an ambiguous placement blocks the attach ──

test('beginAttach records artworkAmbiguous from lookupArtworkByPlacement, and attachIsBlocked acts on it', async () => {
  const src = (await readFile(new URL('../src/components/orders/drawer/ProductsEditor.jsx', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  // beginAttach uses the canonical lookup and stores the ambiguity flag on the resolution
  assert.ok(src.includes('lookupArtworkByPlacement(artworkByPlacement, component.placement)'), 'beginAttach resolves artwork via canonical lookup');
  assert.ok(src.includes('artworkAmbiguous: artworkMatch.ambiguous'), 'the ambiguity flag is carried on the resolution');
  // confirm is blocked when any resolution is ambiguous
  assert.ok(/attachIsBlocked[\s\S]{0,220}\|\|\s*r\.artworkAmbiguous/.test(src), 'attachIsBlocked is true when a resolution has artworkAmbiguous');
  // addPrintOptionMutation refuses rather than freezing a guess
  assert.ok(src.includes('if (artworkMatch.ambiguous) {'), 'addPrintOptionMutation guards on ambiguity');
  assert.ok(src.includes('resolve them in Catalog Management before adding this print option'), 'and explains why');
  // the review row shows the ambiguity, never a chosen file
  assert.ok(src.includes('multiple current revisions match placement'), 'the review row surfaces the ambiguity');
});

test('reproduction: the attachIsBlocked predicate blocks an otherwise-resolved line when artwork is ambiguous', () => {
  const ambiguousMap = buildArtworkByPlacement([
    { id: 'rev-lower', placement: 'front', is_current: true },
    { id: 'rev-title', placement: 'Front', is_current: true },
  ]);
  const match = lookupArtworkByPlacement(ambiguousMap, 'FRONT');
  const resolution = { status: 'resolved', staffPickedVariantId: '', artwork: match.artwork, artworkAmbiguous: match.ambiguous };
  // mirror ProductsEditor.jsx attachIsBlocked, exactly
  const attachIsBlocked = [resolution].some(
    (r) => (r.status === 'unresolved_multiple' && !r.staffPickedVariantId) || r.artworkAmbiguous,
  );
  assert.equal(attachIsBlocked, true, 'a resolved variant does not unblock an ambiguous-artwork line');
  assert.deepEqual(resolveArtworkRevisionIds(resolution.artwork), [], 'and nothing is frozen');
});
