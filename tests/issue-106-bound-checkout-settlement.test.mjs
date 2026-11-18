import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scan=readFileSync('supabase/functions/quick-solution-qr-opps106-scan/index.ts','utf8');
const notify=readFileSync('supabase/functions/quick-solution-qr-opps106-notify/index.ts','utf8');
const sql=readFileSync('supabase/staging-only/20261118_opps106_bound_checkout_identity.sql','utf8');
const quarantine=readFileSync('supabase/staging-only/20261118_opps106_verified_capture_quarantine.sql','utf8');
const contract=readFileSync('supabase/functions/_shared/qrGatewayEnvironmentContract.js','utf8');

test('scanner binds merchant and sandbox mode from private edge env before redirect',()=>{
 assert.match(scan,/Deno\.env\.get\('PAYFAST_SANDBOX'\) !== 'true'/);
 assert.match(scan,/const merchantId = Deno\.env\.get\('PAYFAST_MERCHANT_ID'\)/);
 assert.match(scan,/qs_opps106_start_counter_qr_checkout_verified/);
 assert.match(scan,/p_checkout_environment:'sandbox',p_merchant_id:merchantId/);
 assert.doesNotMatch(scan,/'qs_opps106_start_counter_qr_checkout',/);
});

test('start RPC stores merchant, environment and exact PayFast reference under the order lock',()=>{
 assert.match(sql,/qs_opps106_start_counter_qr_checkout_verified\(p_request_id uuid, p_checkout_environment text, p_merchant_id text\)/);
 assert.match(sql,/for update;/i);
 assert.match(sql,/checkout_environment=p_checkout_environment/);
 assert.match(sql,/checkout_merchant_id=p_merchant_id/);
 assert.match(sql,/checkout_gateway_reference='JXQR-'\|\|v_request\.id::text/);
 assert.match(sql,/checkout_contract_version='jointx_qr_v2'/);
 assert.match(sql,/SERVER_PROVENANCE_REQUIRED/);
 assert.match(sql,/PROVENANCE_REVIEW_REQUIRED/);
});

test('ITN checks server-bound context AFTER signature, trusted IP, merchant, remote VALID and amount',()=>{
 const source=notify;
 const verifySig=source.indexOf('same(verified.signature, verified.expected)');
 const remote=source.indexOf("const confirm = await fetch(validateUrl");
 const amount=source.indexOf('const amountCents = Math.round(gross * 100)');
 const context=source.indexOf("qs_opps106_get_counter_qr_checkout_identity");
 const approve=source.indexOf("resolveVerifiedPayfastEnvironment({");
 const complete=source.indexOf("supabase.rpc('qs_opps106_settle_counter_qr'");
 assert.ok(verifySig > 0 && remote > verifySig && amount > remote && context > amount && approve > context && complete > approve);
 assert.match(source,/import \{ resolveVerifiedPayfastEnvironment \} from '\.\.\/_shared\/qrGatewayEnvironmentContract\.js'/);
 assert.match(source,/if \(!sandbox\) return response\(503\)/);
 assert.match(source,/bound\.environment === 'sandbox'/);
 assert.match(source,/bound\.merchantId === merchantId/);
 assert.match(source,/bound\.gatewayReference === p\.m_payment_id/);
 assert.match(source,/Number\(bound\.amountCents\) === amountCents/);
});

test('verified mismatches quarantine BEFORE noncomplete or complete settlement',()=>{
 const ctx=notify.indexOf('if (!approved) {');
 const quarantineCall=notify.indexOf('qs_opps106_quarantine_verified_qr_capture');
 const noncomplete=notify.indexOf("if (p.payment_status !== 'COMPLETE')");
 const settle=notify.indexOf("supabase.rpc('qs_opps106_settle_counter_qr'");
 assert.ok(ctx > 0 && quarantineCall > ctx && noncomplete > quarantineCall && settle > noncomplete);
 assert.match(notify,/return response\(503\)/);
 assert.match(notify,/return response\(200\)/);
 assert.match(sql,/QR_CHECKOUT_PROVENANCE_REVIEW/);
 assert.match(sql,/v_request\.checkout_merchant_id is distinct from p_raw_itn->>'merchant_id'/);
 assert.match(sql,/v_request\.checkout_contract_version is distinct from 'jointx_qr_v2'/);
});

test('quarantine cannot settle or release and is service-role-only',()=>{
 assert.match(quarantine,/QR_CHECKOUT_PROVENANCE_REVIEW/);
 assert.match(quarantine,/GATEWAY_PROVENANCE_MISMATCH/);
 assert.match(quarantine,/insert into qr_payments\.payment_exceptions/);
 assert.match(quarantine,/on conflict\(payment_request_id,gateway_payment_id,reason\) do nothing/);
 assert.match(quarantine,/revoke all on function public\.qs_opps106_quarantine_verified_qr_capture/);
 assert.doesNotMatch(quarantine,/update commerce\.service_order_payments|set payment_status='paid'/);
});

test('same shared contract is used for both tests and actual edge callback',()=>{
 assert.match(contract,/export function resolveVerifiedPayfastEnvironment/);
 const forwarding=readFileSync('src/server/cafeQr/gatewayEnvironmentContract.js','utf8');
 assert.match(forwarding,/supabase\/functions\/_shared\/qrGatewayEnvironmentContract\.js/);
});
