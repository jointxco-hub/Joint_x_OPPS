import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync('supabase/staging-only/20261118_opps106_qr_reconciliation_packet.sql','utf8');
const api=readFileSync('src/api/cafeQrReview.js','utf8');
const ui=readFileSync('src/pages/CafeQrSandbox.jsx','utf8');

test('merchant reconciliation packet is staff-only and cannot write payments',()=>{
  assert.match(sql,/auth\.uid\(\) is null or not public\.is_opps_staff\(\)/);
  assert.match(sql,/public\.has_tenant_capability\(v_tenant,'cafe\.operations\.manage'\)/);
  assert.match(sql,/revoke all on function public\.qs_opps106_get_qr_reconciliation_packet/);
  assert.match(sql,/grant execute on function public\.qs_opps106_get_qr_reconciliation_packet/);
  assert.doesNotMatch(sql,/\bupdate\s+(commerce|qr_payments|public)\./i);
  assert.doesNotMatch(sql,/\binsert\s+into\s+(commerce|qr_payments|public)\./i);
  assert.doesNotMatch(sql,/\bdelete\s+from\s+(commerce|qr_payments|public)\./i);
});
test('merchant packet is scoped to exact tenant, order, QR and safe summary',()=>{
  assert.match(sql,/id=p_request_id and tenant_id=v_tenant and target_type='cafe_order'/);
  assert.match(sql,/id=v_request\.target_id and tenant_id=v_tenant/);
  assert.match(sql,/where tenant_id=v_tenant and service_order_id=v_order\.id/);
  assert.match(sql,/'gatewayReference',coalesce\(v_request\.checkout_gateway_reference/);
  assert.match(sql,/'gatewayReferenceProvenance'/);
  assert.match(sql,/'legacy_derived'/);
  assert.match(sql,/'pendingPayfastIntents'/);
  assert.match(sql,/'exceptionEvents'/);
  assert.doesNotMatch(sql,/'raw_itn'|'checkout_url'|'customerEmail'|'passphrase'/i);
});
test('reconciliation packet must never assert no capture or release based on absence of ITN',()=>{
  assert.match(sql,/'providerOutcomeVerified',false/);
  assert.match(sql,/'noCaptureVerified',false/);
  assert.match(sql,/'cashCardHoldReleased',false/);
  assert.match(api,/qs_opps106_get_qr_reconciliation_packet/);
  assert.match(api,/data\.noCaptureVerified !== false/);
  assert.match(ui,/Gateway no-capture verification: not established/);
  assert.match(ui,/Cash\/Card payment remains blocked/);
});
test('staff UI shows exact reference plus amount and explicitly labels legacy data',()=>{
  assert.match(ui,/PayFast reconciliation packet \(read-only\)/);
  assert.match(ui,/qrEvidencePacket\.gatewayReference/);
  assert.match(ui,/qrEvidencePacket\.gatewayReferenceProvenance === "server_bound"/);
  assert.match(ui,/qrEvidencePacket\.pendingPayfastIntents/);
});
