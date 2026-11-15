import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync('src/pages/CafeQrSandbox.jsx','utf8');
const api = readFileSync('src/api/cafeQrHandoff.js','utf8');

test('handoff preview is separate from QR issuance and requires actual staff RPC',()=>{
 assert.match(ui,/previewCafeHandoff\(orderId\)/);
 assert.match(api,/admin_preview_quick_solution_opps_handoff/);
 assert.match(api,/supabase\.auth\.getSession\(\)/);
 assert.match(api,/supabase\.rpc\(name/);
 assert.doesNotMatch(api,/service_role|SERVICE_ROLE_KEY/);
});
test('handoff send is a deliberate confirmed action gated by preview readiness',()=>{
 assert.match(ui,/if\(!confirmSend \|\| handoff\?\.ready !== true \|\| !enabled\) return/);
 assert.match(ui,/handoff\.ready===true/);
 assert.match(ui,/Confirm Send to OPPS/);
 assert.match(ui,/setConfirmSend\(false\)/);
 assert.match(api,/admin_send_quick_solution_order_to_opps/);
});
test('staff preview surfaces canonical paid-state, deposit, blockers and warnings',()=>{
 for(const str of ['proposedOppsOrder?.payment_status','proposedOppsOrder?.deposit_paid','handoff.warnings','handoff.blockers','handoffStatus']) {
  assert.ok(ui.includes(str),str);
 }
});
