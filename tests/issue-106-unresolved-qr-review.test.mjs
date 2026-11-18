import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/staging-only/20261118_opps106_qr_unresolved_checkout_review_queue.sql','utf8');
const ui = readFileSync('src/pages/CafeQrSandbox.jsx','utf8');
const api = readFileSync('src/api/cafeQrReview.js','utf8');

test('unresolved checkout queue remains staff-only and read-only',()=>{
  for(const expected of ['auth.uid()','public.is_opps_staff()',"cafe.operations.manage","r.checkout_started_at is not null","r.status<>'settled'","not exists(","cp.status='completed'"]) {
    assert.ok(sql.includes(expected),expected);
  }
  assert.match(sql,/revoke all on function public.qs_opps106_list_qr_checkout_reviews/);
  assert.match(sql,/grant execute on function public.qs_opps106_list_qr_checkout_reviews/);
  assert.doesNotMatch(sql,/update\s+(qr_payments|commerce|public)\./i);
  assert.doesNotMatch(sql,/delete\s+from\s+/i);
});

test('read-only staging UI explains expired QR cannot authorize another charge',()=>{
  assert.match(api,/qs_opps106_list_qr_checkout_reviews/);
  assert.match(api,/VITE_SUPABASE_URL/);
  assert.match(ui,/Unresolved PayFast checkouts/);
  assert.match(ui,/An expired QR does not prove PayFast never charged a customer/);
  assert.match(ui,/Refresh unresolved checkouts/);
  assert.doesNotMatch(api,/qs_opps106_issue_counter_qr|record_quick_solution_counter_payment/);
});
