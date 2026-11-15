import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const scanner=readFileSync('supabase/functions/quick-solution-qr-opps106-scan/index.ts','utf8');
test('QR scan uses isolated HTTPS staging static return and cancel URLs',()=>{
  assert.match(scanner,/stagingReturnBase = 'https:\/\/joint-x-opps-git-feature-106-cafe-visibility-qr-joint-x\.vercel\.app'/);
  assert.match(scanner,/return_url:stagingReturnBase \+ '\/opps106-qr-return\.html'/);
  assert.match(scanner,/cancel_url:stagingReturnBase \+ '\/opps106-qr-cancel\.html'/);
  assert.doesNotMatch(scanner,/return_url:returnBase/);
});
test('return pages do not claim payment and instruct users not to pay twice',()=>{
  for(const kind of ['return','cancel']){
    const page=readFileSync('public/opps106-qr-'+kind+'.html','utf8');
    assert.match(page,/Do not pay again yet/);
    assert.match(page,/verified PayFast notification|verified payment notification/);
    assert.doesNotMatch(page,/Payment successful|Order paid|Payment confirmed/);
    assert.match(page,/noindex,nofollow/);
  }
});
