import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const notify = readFileSync('supabase/functions/quick-solution-qr-opps106-notify/index.ts','utf8');
const sql = readFileSync('supabase/staging-only/20261118_opps106_gateway_environment_provenance.sql','utf8');
const contract = readFileSync('docs/OPPS106_LIVE_PAYMENT_RELEASE_CONTRACT_20261118.md','utf8');

test('sandbox-only callback rejects live mode before trusting ITN or applying a receipt',()=>{
  const modeGate = notify.indexOf('if (!sandbox) return response(503)');
  const sourceCheck = notify.indexOf('trustedSource(req, sandbox)');
  const settle = notify.indexOf("supabase.rpc('qs_opps106_settle_counter_qr'");
  assert.ok(modeGate > 0 && sourceCheck > modeGate && settle > sourceCheck,
    'sandbox-only rejection must run before merchant ITN settlement');
  assert.match(notify,/PAYFAST_SANDBOX/);
  assert.match(notify,/sandbox\.payfast\.co\.za\/eng\/query\/validate/);
  assert.match(notify,/same\(verified\.signature, verified\.expected\)/);
  assert.match(notify,/confirm\.text\(\)\)\.trim\(\) !== 'VALID'/);
});

test('staging QR settlement does not imply support for live environment',()=>{
  assert.match(sql,/STAGING CANARY ONLY/);
  assert.match(sql,/gateway_environment='sandbox'/);
  assert.match(sql,/gateway_environment_evidence='sandbox_only_verified_itn'/);
  assert.doesNotMatch(sql,/gateway_environment='live'/);
});

test('live payment release contract prohibits default live classification and timer-based release',()=>{
  assert.match(contract,/callback environment and merchant identity equal the persisted checkout-intent environment/);
  assert.match(contract,/missing\/mismatched provenance must fail closed/i);
  assert.match(contract,/repeat COMPLETE\/ITN returns/);
  assert.match(contract,/no automatic clearing based solely on QR expiry/);
  assert.match(contract,/iMin D4 thermal receipt printing is not yet tested/);
});
