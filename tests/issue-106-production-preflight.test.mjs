import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getPayfastGatewayProfile } from '../supabase/functions/_shared/payfastGatewayProfile.js';

const preflight=readFileSync('scripts/opps106-production-readiness.sql','utf8');
const plan=readFileSync('docs/OPPS106_PRODUCTION_PREFLIGHT_20261120.md','utf8');
const notify=readFileSync('supabase/functions/quick-solution-qr-opps106-live-notify/index.ts','utf8');
const scan=readFileSync('supabase/functions/quick-solution-qr-opps106-live-scan/index.ts','utf8');

test('production preflight is read-only, explicit no-go, and detects missing baseline QR tables',()=>{
  assert.match(preflight,/to_regclass\('qr_payments\.payment_requests'\)/);
  assert.match(preflight,/to_regclass\('qr_payments\.issuance_controls'\)/);
  assert.match(preflight,/to_regclass\('qr_payments\.live_gateway_policy'\)/);
  assert.match(preflight,/supabase_migrations\.schema_migrations/);
  assert.match(preflight,/false AS approval_to_enable_payments/);
  assert.doesNotMatch(preflight,/^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|CALL|DO)\b/im);
});

test('release plan explicitly stops new issuance but preserves secure delayed notifications',()=>{
  assert.match(plan,/production QR baseline absent/i);
  assert.match(plan,/Stopping new issuance|Stop \*new\* issuance/i);
  assert.match(plan,/keep a secured callback available/i);
  assert.match(plan,/iMin D4 remains unavailable/);
  assert.match(plan,/Release authorization: NOT GRANTED/);
});

test('callback purpose remains independent of issuing approval',()=>{
  assert.match(notify,/getPayfastGatewayProfile\(Deno\.env\.toObject\(\),'live','callback'\)/);
  assert.match(scan,/getPayfastGatewayProfile\(Deno\.env\.toObject\(\), 'live'\)/);
  const env={
    PAYFAST_SANDBOX:'false',PAYFAST_MERCHANT_ID:'15000100',
    PAYFAST_MERCHANT_KEY:'not-a-live-key',PAYFAST_PASSPHRASE:'not-a-live-passphrase',
    OPPS106_QR_MODE:'live',
    OPPS106_LIVE_MERCHANT_ID:'15000100',OPPS106_SANDBOX_MERCHANT_ID:'10000100',
    OPPS106_LIVE_GATEWAY_APPROVED:'false',OPPS106_LIVE_CALLBACK_ENABLED:'true',
    OPPS106_LIVE_RETURN_BASE:'https://opps.jointx.co',
    OPPS106_LIVE_NOTIFY_URL:'https://opps.jointx.co/functions/v1/quick-solution-qr-opps106-live-notify'
  };
  assert.equal(getPayfastGatewayProfile(env,'live','issuance').ok,false);
  assert.equal(getPayfastGatewayProfile(env,'live','callback').ok,true);
  env.OPPS106_LIVE_CALLBACK_ENABLED='false';
  assert.equal(getPayfastGatewayProfile(env,'live','callback').ok,false);
});
