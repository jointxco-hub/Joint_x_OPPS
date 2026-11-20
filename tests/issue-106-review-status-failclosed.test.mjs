import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync('supabase/staging-only/20261118_opps106_qr_review_status_failclosed.sql','utf8');
const api=readFileSync('src/api/cafeQrReview.js','utf8');
const ui=readFileSync('src/pages/CafeQrSandbox.jsx','utf8');

test('review history cannot be updated or deleted even through direct owner-issued DML',()=>{
 assert.match(sql,/before update or delete on qr_payments\.checkout_review_events/);
 assert.match(sql,/raise exception using errcode='42501'/);
 assert.match(sql,/review history is append-only/);
});
test('review status requires authenticated OPPS staff with Café operations authority',()=>{
 assert.match(sql,/auth\.uid\(\) is null or not public\.is_opps_staff\(\)/);
 assert.match(sql,/public\.has_tenant_capability\(v_tenant,'cafe\.operations\.manage'\)/);
 assert.match(sql,/revoke all on function public\.qs_opps106_get_qr_checkout_review_status/);
 assert.match(sql,/grant execute on function public\.qs_opps106_get_qr_checkout_review_status/);
});
test('second review requires different reviewers and same case reference, never releases funds',()=>{
 assert.match(sql,/e\.provider_reference=v_report\.provider_reference/);
 assert.match(sql,/e\.actor_user_id<>v_report\.actor_user_id/);
 assert.match(sql,/gatewayNoCaptureAttested',false/);
 assert.match(sql,/cashCardHoldReleased',false/);
 assert.match(sql,/TWO_STAFF_REPORTS_RECORDED_PROVIDER_VERIFICATION_STILL_REQUIRED/);
 assert.match(sql,/CAPTURE_REPORTED_ESCALATE/);
 assert.doesNotMatch(sql,/update\s+(commerce|qr_payments|public)\./i);
});
test('UI presents the hold even when independent staff reviews are complete',()=>{
 assert.match(api,/qs_opps106_get_qr_checkout_review_status/);
 assert.match(api,/data\.cashCardHoldReleased !== false/);
 assert.match(ui,/Cash\/Card hold: remains in force/);
 assert.match(ui,/Staff review does not constitute verified provider no-capture evidence/);
 assert.match(ui,/getCafeQrCheckoutReviewStatus/);
});
