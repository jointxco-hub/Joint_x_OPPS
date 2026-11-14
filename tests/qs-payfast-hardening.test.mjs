import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transformSync } from 'esbuild';

const checkout = readFileSync('supabase/functions/quick-solution-payfast/index.ts','utf8');
const notify = readFileSync('supabase/functions/quick-solution-payfast-notify/index.ts','utf8');
const intentSQL = readFileSync('supabase/migrations/20261114224000_opps106_payfast_intent_binding.sql','utf8');

// Exercise the REAL deployed-module helper source without executing Deno.serve,
// making this a deterministic local test with no gateway or payment side effects.
const helpers = 'const encode =' + notify.split('const encode =')[1]?.split('function trustedSource')[0];
assert.ok(helpers.length > 100,'signature helpers must exist');
const helperScript = transformSync(
  helpers,
  {loader:'ts',format:'cjs',target:'es2022'}
).code;
const {signedPayload,same,encode,inSourceRange} = new Function('md5','URLSearchParams',
  helperScript + '\nreturn {signedPayload,same,encode,inSourceRange};'
)(
  (s) => createHash('md5').update(s).digest('hex'), URLSearchParams
);

test('correct signed notification validates with passphrase and field ordering',()=>{
  const raw='merchant_id=10000100&custom_str1=abc&amount_gross=350.00&payment_status=COMPLETE';
  const source=raw+'&passphrase='+encode('test secret');
  const sig=createHash('md5').update(source).digest('hex');
  const parsed=signedPayload(raw+'&signature='+sig,'test secret');
  assert.ok(parsed);
  assert.equal(parsed.expected,sig);
  assert.ok(same(parsed.signature,parsed.expected));
  assert.ok(!same(parsed.signature,'0'.repeat(32)));
});

test('tampering, wrong passphrase or duplicate keys are denied',()=>{
  const raw='merchant_id=10000100&amount_gross=350.00';
  const sig=createHash('md5').update(raw+'&passphrase='+encode('secret')).digest('hex');
  const tampered=signedPayload(raw.replace('350.00','450.00')+'&signature='+sig,'secret');
  assert.equal(same(tampered.signature,tampered.expected),false);
  const wrong=signedPayload(raw+'&signature='+sig,'wrong secret');
  assert.equal(same(wrong.signature,wrong.expected),false);
  assert.equal(signedPayload(raw+'&merchant_id=999&signature='+sig,'secret'),null);
  assert.equal(signedPayload(raw+'&signature=not-md5','secret'),null);
});

test('checkout uses configured origin only and embeds immutable checkout-intent ID',()=>{
  assert.match(checkout,/Deno\.env\.get\('QUICK_SOLUTION_RETURN_ORIGIN'\)/);
  assert.doesNotMatch(checkout,/req\.headers\.get\('origin'\)/i);
  assert.match(checkout,/custom_str3:\s*String\(intent\.paymentIntentId/);
  assert.match(checkout,/!merchantId \|\| !merchantKey \|\| !passphrase/);
  assert.match(checkout,/mode !== 'true' && mode !== 'false'/);
});

test('ITN is fail-closed until trusted gateway and source IP are configured',()=>{
  assert.match(notify,/PAYFAST_SOURCE_IP_GATEWAY_VERIFIED/);
  assert.match(notify,/PAYFAST_TRUSTED_CLIENT_IP_HEADER/);
  assert.match(notify,/PAYFAST_SANDBOX_SOURCE_IPS/);
  assert.match(notify,/PAYFAST_LIVE_SOURCE_IPS/);
  assert.match(notify,/!trustedSource\(req, sandbox\)/);
  assert.match(notify,/p\.merchant_id !== merchantId/);
  assert.match(notify,/!same\(verified\.signature, verified\.expected\)/);
  assert.match(notify,/\.rpc\(\s*'qs_verify_payfast_notification_intent'/);
  assert.match(notify,/\/eng\/query\/validate/);
  assert.match(notify,/p\.pf_payment_id/);
  assert.match(notify,/response\(503\)/);
});

test('private checkout binding is service-role-only and checks order plus intent',()=>{
  assert.match(intentSQL,/revoke all on function public\.qs_verify_payfast_notification_intent/);
  assert.match(intentSQL,/grant execute on function public\.qs_verify_payfast_notification_intent[\s\S]*to service_role/);
  assert.match(intentSQL,/intent\.id = p_intent_id/);
  assert.match(intentSQL,/intent\.tenant_id = o\.tenant_id/);
  assert.match(intentSQL,/round\(intent\.amount,2\) = round\(p_amount,2\)/);
  assert.match(intentSQL,/round\(o\.total_amount,2\) = round\(p_amount,2\)/);
});

test('PayFast source IP matching supports exact IPs and official CIDR ranges',()=>{
  assert.equal(inSourceRange('197.97.145.150','197.97.145.144/28'),true);
  assert.equal(inSourceRange('197.97.145.160','197.97.145.144/28'),false);
  assert.equal(inSourceRange('144.126.193.139','144.126.193.139'),true);
  assert.equal(inSourceRange('144.126.193.140','144.126.193.139'),false);
  assert.equal(inSourceRange('1.1.1.1','1.1.1.1/33'),false);
});

test('PayFast notification includes gateway payment ID in restricted intent check',()=>{
  assert.match(notify,/p_pf_payment_id:\s*p\.pf_payment_id/);
  const replaySql=readFileSync('supabase/migrations/20261114225000_opps106_payfast_intent_replay.sql','utf8');
  assert.match(replaySql,/receipt\.pf_payment_id\s*=\s*btrim\(p_pf_payment_id\)/);
  assert.match(replaySql,/intent\.status\s+in\s*\('cancelled','completed'\)/);
  assert.match(replaySql,/receipt\.status='completed'/);
});
