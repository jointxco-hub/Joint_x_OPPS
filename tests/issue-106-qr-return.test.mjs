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
