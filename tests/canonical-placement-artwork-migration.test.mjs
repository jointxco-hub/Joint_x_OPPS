import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MIG = '20260909120000_canonical_placement_artwork_matching.sql';
const ORIG = '202608220006_client_product_artwork_asset_linking.sql';

async function read(rel) {
  return (await readFile(new URL(`../supabase/migrations/${rel}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
}

test('migration adds an IMMUTABLE canonical_placement helper granted to authenticated only', async () => {
  const m = await read(MIG);
  assert.ok(/create or replace function public\.canonical_placement\(p_placement text\)/.test(m));
  assert.ok(/\n\s*immutable\n/.test(m), 'must be IMMUTABLE so it can be indexed');
  assert.ok(m.includes('grant execute on function public.canonical_placement(text) to authenticated'));
  assert.ok(m.includes('revoke all on function public.canonical_placement(text) from public, anon'));
});

test('find_or_create replacement keeps the EXACT existing signature + grants', async () => {
  const m = await read(MIG);
  assert.ok(m.includes('create or replace function public.find_or_create_client_product_artwork_from_asset(\n  p_tenant_id uuid,\n  p_client_product_id uuid,\n  p_client_asset_id uuid,\n  p_placement text\n)'));
  assert.ok(m.includes('returns public.client_product_artwork'));
  assert.ok(m.includes('language plpgsql'));
  assert.ok(m.includes('security definer'));
  assert.ok(m.includes("set search_path to 'pg_catalog', 'public'"));
  assert.ok(m.includes('revoke all on function public.find_or_create_client_product_artwork_from_asset(uuid, uuid, uuid, text) from public, anon'));
  assert.ok(m.includes('grant execute on function public.find_or_create_client_product_artwork_from_asset(uuid, uuid, uuid, text) to authenticated'));
});

test('the ONLY behavioural change is canonical placement comparison in the 4 match spots; storage stays verbatim', async () => {
  const m = await read(MIG);
  // executable SQL only (drop -- comment lines)
  const code = m.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.ok(!code.includes('placement = v_clean_placement'), 'every exact-match placement comparison in executable SQL must be replaced');
  // exactly the canonical form is used for matching
  const canonMatches = m.match(/public\.canonical_placement\(placement\) = public\.canonical_placement\(v_clean_placement\)/g) || [];
  assert.equal(canonMatches.length, 4, 'dedup select + max(revision) + supersede update + unique_violation reuse select');
  // the INSERT still stores the raw cleaned placement
  assert.ok(m.includes('p_client_product_id, v_next_revision, v_clean_placement,'), 'row is inserted with the placement string as passed');
});

test('preserves every existing guard from the original migration', async () => {
  const m = await read(MIG);
  for (const guard of [
    "if not public.is_opps_staff() then",
    "ARTWORK_FORBIDDEN: staff access required",
    "not public.can_access_tenant(p_tenant_id)",
    "ARTWORK_INVALID_PLACEMENT: placement is required",
    "ARTWORK_CLIENT_PRODUCT_NOT_FOUND",
    "ARTWORK_ASSET_NOT_FOUND",
    "ARTWORK_ASSET_CLIENT_MISMATCH",
    "exception when unique_violation then",
  ]) {
    assert.ok(m.includes(guard), `missing guard: ${guard}`);
  }
});

test('adds a NON-UNIQUE canonical lookup index and no uniqueness constraint', async () => {
  const m = await read(MIG);
  assert.ok(m.includes('create index if not exists client_product_artwork_current_canonical_idx'));
  assert.ok(m.includes('(client_product_id, public.canonical_placement(placement))'));
  assert.ok(m.includes('where is_current'));
  assert.ok(!/create unique index[^;]*canonical/i.test(m), 'no UNIQUE canonical index in this migration');
});

test('does not rewrite historical rows and ships read-only collision reports for staging + production', async () => {
  const m = await read(MIG);
  assert.ok(!/\bupdate public\.client_product_artwork\b(?![^;]*is_current = false\n\s*where client_product_id = p_client_product_id)/.test(m),
    'the only UPDATE is the in-function supersede - no bulk historical rewrite');
  assert.ok(m.toLowerCase().includes('read-only collision reports'));
  assert.ok(m.includes('having count(*) > 1'), 'includes the collision-detection query');
  assert.ok(m.toLowerCase().includes('staging') && m.toLowerCase().includes('production'));
  assert.ok(m.toLowerCase().includes('rollback'), 'documents rollback');
});

test('the canonical match logic is unchanged vs the original for all non-placement lines', async () => {
  // Guard against accidental drift: the two bodies should differ ONLY by
  // the canonical_placement wrapper and the migration-specific comments.
  const orig = await read(ORIG);
  const mig = await read(MIG);
  const normalize = (s) => s
    .replace(/public\.canonical_placement\(placement\) = public\.canonical_placement\(v_clean_placement\)/g, 'placement = v_clean_placement')
    .replace(/\s+-- canonical:/g, '');
  const fnBody = (s) => {
    const from = s.indexOf('create or replace function public.find_or_create_client_product_artwork_from_asset');
    return s.slice(from, s.indexOf('$$;', from) + 3);
  };
  assert.equal(normalize(fnBody(mig)).replace(/\s+/g, ' ').trim(), fnBody(orig).replace(/\s+/g, ' ').trim(),
    'de-canonicalised, the new function body must be byte-equivalent to the original');
});
