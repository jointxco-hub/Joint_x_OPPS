import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getPayfastGatewayProfile} from '../supabase/functions/_shared/payfastGatewayProfile.js';

const scan=readFileSync('supabase/functions/quick-solution-qr-opps106-live-scan/index.ts','utf8');
const notify=readFileSync('supabase/functions/quick-solution-qr-opps106-live-notify/index.ts','utf8');
const sql=readFileSync('supabase/production-candidate/opps106_live_gateway_rpcs_REVIEW_ONLY.sql','utf8');
const sandboxScan=readFileSync('supabase/functions/quick-solution-qr-opps106-scan/index.ts','utf8');
const sandboxNotify=readFileSync('supabase/functions/quick-solution-qr-opps106-notify/index.ts','utf8');

test('live scanner has isolated private gateway and live issuance RPC',()=>{
 assert.match(scan,/getPayfastGatewayProfile\(Deno\.env\.toObject\(\), 'live'\)/);
 assert.match(scan,/qs_opps106_start_counter_qr_checkout_live_candidate/);
 assert.match(scan,/p_checkout_environment:profile\.environment/);
 assert.match(scan,/notify_url:profile\.notifyUrl/);
 assert.match(scan,/payfastUrl\(fields,passphrase,profile\.processUrl\)/);
 assert.doesNotMatch(scan,/'qs_opps106_start_counter_qr_checkout_verified'/);
 assert.doesNotMatch(scan,/return 'https:\/\/sandbox\.payfast\.co\.za/);
});

test('live notify uses live VALID endpoint and verifies merchant+bound intent before its distinct live RPC',()=>{
 assert.match(notify,/getPayfastGatewayProfile\(Deno\.env\.toObject\(\),'live','callback'\)/);
 assert.match(notify,/const validateUrl = profile\.validationUrl/);
 assert.match(notify,/trustedSource\(req, sandbox\)/);
 assert.match(notify,/same\(verified\.signature, verified\.expected\)/);
 assert.match(notify,/\(await confirm\.text\(\)\)\.trim\(\) !== 'VALID'/);
 assert.match(notify,/qs_opps106_get_counter_qr_checkout_identity/);
 assert.match(notify,/matchGatewayCheckoutProfile\(profile,/);
 assert.match(notify,/bound\.environment === 'live'/);
 assert.match(notify,/proof\.environment === 'live'/);
 assert.match(notify,/proof\.evidence === 'payfast_itn_validated_live'/);
 assert.match(notify,/qs_opps106_quarantine_verified_qr_capture/);
 assert.match(notify,/qs_opps106_settle_counter_qr_live_candidate/);
 assert.match(notify,/qs_opps106_record_counter_qr_noncomplete_live_candidate/);
 assert.doesNotMatch(notify,/'qs_opps106_settle_counter_qr',/);
});

test('live policy begins disabled and requires approved merchant plus canonical QR control',()=>{
 assert.match(sql,/PRODUCTION CANDIDATE\. REVIEW-ONLY/);
 assert.match(sql,/enabled boolean not null default false/);
 assert.match(sql,/values\('cafe_order',false\)/);
 assert.match(sql,/live_gateway_policy cfg/);
 assert.match(sql,/cfg\.enabled is true/);
 assert.match(sql,/cfg\.merchant_id=p_merchant_id/);
 assert.match(sql,/allowed_order_id=v_order\.id and active_until>clock_timestamp\(\)/);
 assert.match(sql,/checkout_environment is distinct from 'live'/);
 assert.match(sql,/gateway_environment='live'/);
 assert.match(sql,/gateway_environment_evidence='payfast_itn_validated_live'/);
 assert.match(sql,/gateway_environment='sandbox' and gateway_environment_evidence='sandbox_only_verified_itn'/);
 assert.doesNotMatch(sql,/update qr_payments\.live_gateway_policy set enabled=true/i);
});

test('live SQL uses distinct protected RPCs and receipt identity lock',()=>{
 for(const [name,signature] of [
  ['qs_opps106_start_counter_qr_checkout_live_candidate','uuid,text,text'],
  ['qs_opps106_settle_counter_qr_live_candidate','uuid,uuid,uuid,bigint,text,jsonb'],
  ['qs_opps106_record_counter_qr_noncomplete_live_candidate','uuid,uuid,uuid,bigint,text,text']
 ]){
  assert.match(sql,new RegExp('public\\.'+name+'\\('));
  assert.ok(sql.includes('revoke all on function public.'+name+'('+signature+')'));
  assert.ok(sql.includes('grant execute on function public.'+name+'('+signature+') to service_role'));
 }
 assert.match(sql,/where id=p_order_id for update/);
 assert.match(sql,/v_request\.checkout_merchant_id is distinct from p_raw_itn->>'merchant_id'/);
 assert.match(sql,/GATEWAY_PROVENANCE_MISMATCH/);
 assert.match(sql,/on conflict\(payment_request_id,gateway_payment_id,reason\) do nothing/);
 assert.match(sql,/v_result := commerce\.qs_apply_payfast_payment/);
 assert.match(sql,/gateway_payment_id=btrim\(p_pf_payment_id\)/);
});

test('current sandbox scanner and notifier remain sandbox-only and separate',()=>{
 assert.match(sandboxScan,/PAYFAST_SANDBOX'\) !== 'true'/);
 assert.match(sandboxNotify,/if \(!sandbox\) return response\(503\)/);
 assert.match(sandboxNotify,/qs_opps106_settle_counter_qr'/);
 assert.doesNotMatch(sandboxScan,/qs_opps106_start_counter_qr_checkout_live_candidate/);
 assert.doesNotMatch(sandboxNotify,/qs_opps106_settle_counter_qr_live_candidate/);
});

test('no live mode accepted without explicit private approvals',()=>{
 const env={PAYFAST_SANDBOX:'false',PAYFAST_MERCHANT_ID:'15000100',
  PAYFAST_MERCHANT_KEY:'k',PAYFAST_PASSPHRASE:'p',OPPS106_QR_MODE:'live',
  OPPS106_LIVE_RETURN_BASE:'https://opps.jointx.co',
  OPPS106_LIVE_NOTIFY_URL:'https://opps.jointx.co/notify'};
 assert.equal(getPayfastGatewayProfile(env,'live').reason,'LIVE_CALLBACK_NOT_APPROVED');
});
