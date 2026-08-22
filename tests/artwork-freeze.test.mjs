import assert from 'node:assert/strict';
import test from 'node:test';
import { buildArtworkByPlacement, resolveArtworkRevisionIds } from '../src/lib/artworkFreeze.js';

test('buildArtworkByPlacement keys current revisions by placement', () => {
  const rows = [
    { id: 'art-front', placement: 'Front', is_current: true },
    { id: 'art-back', placement: 'Back', is_current: true },
  ];
  const map = buildArtworkByPlacement(rows);
  assert.equal(map.get('Front').id, 'art-front');
  assert.equal(map.get('Back').id, 'art-back');
  assert.equal(map.get('Sleeve'), undefined, 'no revision exists for a placement not in the rows');
});

test('buildArtworkByPlacement ignores rows with no placement and handles empty/missing input', () => {
  assert.equal(buildArtworkByPlacement(undefined).size, 0);
  assert.equal(buildArtworkByPlacement([]).size, 0);
  const map = buildArtworkByPlacement([{ id: 'a', placement: null }, { id: 'b' }]);
  assert.equal(map.size, 0);
});

test('exact artwork revision ID is frozen into the snapshot payload shape', () => {
  const artwork = { id: 'revision-uuid-123', placement: 'Front', file_name: 'SFR Main Logo.png' };
  assert.deepEqual(resolveArtworkRevisionIds(artwork), ['revision-uuid-123']);
});

test('a component with no linked artwork freezes to an empty array, never null or a guess', () => {
  assert.deepEqual(resolveArtworkRevisionIds(null), []);
  assert.deepEqual(resolveArtworkRevisionIds(undefined), []);
  assert.deepEqual(resolveArtworkRevisionIds({ placement: 'Front' }), [], 'no id on the row means nothing to freeze');
});

test('later revisions for the same placement do not retroactively change what was already frozen', () => {
  // beginAttach resolves and freezes against whatever was current AT
  // THAT MOMENT; a later re-fetch reflecting a new current revision must
  // not be re-applied to the already-created snapshot's own recorded
  // array - this is enforced by confirmAttach only ever running once per
  // attach, not by this helper, but the helper's job is to prove it
  // returns a plain new array each call, not a live reference that could
  // be mutated by a later artworkByPlacement rebuild.
  const firstRevision = { id: 'revision-1', placement: 'Front' };
  const frozen = resolveArtworkRevisionIds(firstRevision);
  const secondRevision = { id: 'revision-2', placement: 'Front' };
  const laterCall = resolveArtworkRevisionIds(secondRevision);
  assert.deepEqual(frozen, ['revision-1']);
  assert.deepEqual(laterCall, ['revision-2']);
  assert.notEqual(frozen, laterCall, 'each call returns its own array, no shared mutable reference');
});
