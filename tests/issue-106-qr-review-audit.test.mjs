import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql=readFileSync('supabase/staging-only/20261118_opps106_checkout_review_audit.sql','utf8');
const ui=readFileSync('src/pages/CafeQrSandbox.jsx','utf8');
const api=readFileSync('src/api/cafeQrReview.js','utf8');

test('review events are append-only with staff identity, evidence and idempotency',()=>{
 assert.match(sql,/create table qr_payments\.checkout_review_events/);
 assert.match(sql,/actor_user_id uuid not null/);
 assert.match(sql,/provider_reference text/);
 assert.match(sql,/unique\(payment_request_id,actor_user_id,operation_key\)/);
 assert.match(sql,/alter table qr_payments\.checkout_review_events enable row level security/);
 assert.match(sql,/revoke all on qr_payments\.checkout_review_events from public,anon,authenticated/);
 assert.doesNotMatch(sql,/delete from qr_payments\.checkout_review_events/i);
 assert.doesNotMatch(sql,/update qr_payments\.checkout_review_events/i);
});

test('only real authorized staff can append evidence to a pending checkout',()=>{
 assert.match(sql,/auth\.uid\(\)/);
 assert.match(sql,/public\.is_opps_staff\(\)/);
 assert.match(sql,/public\.has_tenant_capability\(v_tenant,'cafe\.operations\.manage'\)/);
 assert.match(sql,/checkout_started_at is null or v_request\.status='settled'/);
 assert.match(sql,/p\.status='completed'/);
 assert.match(sql,/revoke all on function public\.qs_opps106_log_qr_checkout_review/);
 assert.match(sql,/grant execute on function public\.qs_opps106_log_qr_checkout_review/);
});

test('second reviewer must be a different person referencing the same first provider check',()=>{
 assert.match(sql,/p_event_type='second_review_confirmed' and not exists/);
 assert.match(sql,/e\.event_type='provider_no_capture_reported'/);
 assert.match(sql,/e\.provider_reference=v_ref/);
 assert.match(sql,/e\.actor_user_id<>v_actor/);
 assert.match(sql,/INDEPENDENT_FIRST_REVIEW_REQUIRED/);
});

test('review functions never mark a payment paid or release the checkout hold',()=>{
 assert.match(sql,/'paymentReleased',false/);
 assert.doesNotMatch(sql,/update commerce\.service_orders/i);
 assert.doesNotMatch(sql,/update commerce\.service_order_payments/i);
 assert.doesNotMatch(sql,/update qr_payments\.payment_requests/i);
 assert.doesNotMatch(sql,/perform commerce\.qs_apply_payfast_payment/i);
});

test('UI and API expose a review log but no release/charge action',()=>{
 assert.match(ui,/View \/ record review/);
 assert.match(ui,/Provider reports no capture/);
 assert.match(ui,/Independent second review/);
 assert.match(ui,/Record finding \(no payment release\)/);
 assert.match(ui,/Payment remains on hold/);
 assert.match(api,/qs_opps106_log_qr_checkout_review/);
 assert.match(api,/qs_opps106_list_qr_checkout_review_events/);
 assert.doesNotMatch(api,/qs_opps106_settle_counter_qr|record_quick_solution_counter_payment/);
});
