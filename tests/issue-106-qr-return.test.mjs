import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const scanner=readFileSync('supabase/functions/quick-solution-qr-opps106-scan/index.ts','utf8');
const page=readFileSync('public/opps106-qr-return.html','utf8');
const cancel=readFileSync('public/opps106-qr-cancel.html','utf8');

test('signed PayFast checkout returns with the opaque QR request ID only',()=>{
 assert.match(scanner,/stagingReturnBase = 'https:\/\/joint-x-opps-git-feature-106-cafe-visibility-qr-joint-x\.vercel\.app'/);
 assert.match(scanner,/return_url:stagingReturnBase \+ '\/opps106-qr-return\.html\?rid=' \+ encodeURIComponent\(rid\)/);
 assert.match(scanner,/cancel_url:stagingReturnBase \+ '\/opps106-qr-cancel\.html\?rid=' \+ encodeURIComponent\(rid\)/);
 assert.doesNotMatch(scanner,/return_url:returnBase/);
});

test('the public return status check is read only and cannot create another checkout or settle an order',()=>{
 const index=scanner.indexOf("if (params.has('status'))");
 const end=scanner.indexOf("if (params.has('return')",index);
 const lookup=scanner.slice(index,end);
 assert.ok(index>0 && end>index);
 assert.match(lookup,/params\.size !== 2/);
 assert.match(lookup,/qs_opps106_scan_counter_qr_status/);
 assert.match(lookup,/data === 'settled' \? 'paid'/);
 assert.doesNotMatch(lookup,/qs_opps106_start_counter_qr_checkout|qs_opps106_settle_counter_qr|payfastUrl/);
 assert.match(scanner,/access-control-allow-origin/);
 assert.match(scanner,/origin === RETURN_ORIGIN/);
 assert.match(scanner,/'cache-control':'no-store, max-age=0'/);
});

test('customer page only confirms after paid status from the server, with safe fallback',()=>{
 assert.match(page,/fetch\(endpoint/);
 assert.match(page,/body && body\.state==='paid'/);
 assert.match(page,/if\(checks>=30\)/);
 assert.match(page,/Do not pay again/);
 assert.match(page,/only|browser redirect alone cannot confirm an order is paid/i);
 assert.match(page,/noindex,nofollow/);
 assert.match(page,/connect-src 'self'/);
 assert.match(page,/const base='\/api\/opps106-qr-status'/);
 assert.match(page,/mode:'same-origin'/);
 assert.doesNotMatch(page,/service.role|SUPABASE_SERVICE_ROLE_KEY|markPaid|settleCounterQr/i);
});
test('cancel page remains conservative and cannot claim successful payment',()=>{
 assert.match(cancel,/Do not pay again yet/);
 assert.doesNotMatch(cancel,/Payment successful|Order paid|Payment confirmed/);
});

test('transient lookup failures retry without claiming a failed or paid payment',()=>{
 assert.match(page,/let lastFailure=''/);
 assert.match(page,/checks\+=1/);
 assert.match(page,/if\(checks>=30\)/);
 assert.match(page,/window\.setTimeout\(check,3000\)/);
 assert.match(page,/Retry '\+checks\+' of 30/);
 assert.match(page,/if\(body && body\.state==='paid'\)\{update\('paid'\);return;\}/);
 assert.doesNotMatch(page,/catch\s*\{\s*update\('unavailable'\);return;/);
});

test('preview-added query parameters cannot invalidate a unique payment reference',()=>{
 const rid='f50bd2bf-7ee5-4389-b9d6-9867e04d8e66';
 const good=new URLSearchParams('rid='+rid+'&_vercel_share=preview');
 const duplicate=new URLSearchParams('rid='+rid+'&rid='+rid);
 const check=params=>params.getAll('rid').length===1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.get('rid')||'');
 assert.equal(check(good),true);
 assert.equal(check(duplicate),false);
 assert.equal(check(new URLSearchParams('_vercel_share=preview')),false);
 assert.match(page,/args\.getAll\('rid'\)\.length!==1/);
 assert.match(page,/encodeURIComponent\(rid\)/);
 assert.doesNotMatch(page,/args\.size!==1/);
});
