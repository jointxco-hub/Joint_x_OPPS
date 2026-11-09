import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationPushDispatcher} from '../src/server/notifications/notificationPushDispatcher.js';
const job={id:'11111111-1111-4111-8111-111111111111',
 claim_token:'22222222-2222-4222-8222-222222222222',
 event_id:'33333333-3333-4333-8333-333333333333',
 tenant_id:'44444444-4444-4444-8444-444444444444',
 recipient_auth_user_id:'55555555-5555-4555-8555-555555555555'};
function setup({jobOverride={},eventType='INVOICE_PAID',devices=[{endpoint:'https://push.example/device',keys:{auth:'x',p256dh:'y'}}],throwSend=false,missingEvent=false,hasClaim=true}={}) {
 const calls={sent:[],completed:[],failed:[],cancelled:[],queries:[],recipients:[]};
 const lease={
  claimNext:async()=>hasClaim?{...job,...jobOverride}:null,
  complete:async x=>{calls.completed.push(x);return true},
  fail:async x=>{calls.failed.push(x);return true},
  cancel:async x=>{calls.cancelled.push(x);return true},
 };
 const targets={listRecipientDevices:async x=>{calls.recipients.push(x);return devices}};
 const pool={connect:async()=>({
  query:async(sql,params)=>{calls.queries.push({sql,params});return{rows:missingEvent?[]:[{
   id:job.event_id,tenant_id:job.tenant_id,source_id:job.id,event_type:eventType,
  }]}},
  release:()=>{},
 })};
 const worker=createNotificationPushDispatcher({
  lease,targets,pool,
  sendWebPush:async(device,payload)=>{if(throwSend)throw Error('temporary network failure');calls.sent.push({device,payload})},
 });
 return {worker,calls};
}
test('idle worker claims nothing and sends no notification',async()=>{
 const h=setup({hasClaim:false});
 assert.equal((await h.worker.deliverOne()).status,'idle');
 assert.equal(h.calls.sent.length,0);
});
test('verified recipient receives generic invoice push and same event tag',async()=>{
 const h=setup(),result=await h.worker.deliverOne();
 assert.equal(result.status,'sent');
 assert.equal(result.deviceCount,1);
 assert.deepEqual(h.calls.recipients[0],{tenantId:job.tenant_id,recipientAuthUserId:job.recipient_auth_user_id});
 assert.match(h.calls.sent[0].payload.tag,/^opps-/);
 assert.equal(h.calls.sent[0].payload.event_type,'INVOICE_PAID');
 assert.equal(h.calls.sent[0].payload.url,'/Invoices');
 assert.doesNotMatch(JSON.stringify(h.calls.sent[0].payload),/customer|amount|signature|token/i);
 assert.equal(h.calls.completed.length,1);
});
test('no subscribed devices cancels only the leased row',async()=>{
 const h=setup({devices:[]}),result=await h.worker.deliverOne();
 assert.equal(result.status,'cancelled');
 assert.equal(h.calls.cancelled[0].reasonCode,'NO_SUBSCRIBED_DEVICE');
 assert.equal(h.calls.completed.length,0);
});
test('web push failure does not acknowledge delivery',async()=>{
 const h=setup({throwSend:true}),result=await h.worker.deliverOne();
 assert.equal(result.status,'retry');
 assert.equal(h.calls.failed[0].errorCode,'PUSH_RETRYABLE');
 assert.equal(h.calls.completed.length,0);
});
test('mismatched or unavailable event never sends',async()=>{
 for(const h of [setup({eventType:'UNKNOWN'}),setup({missingEvent:true})]){
  const result=await h.worker.deliverOne();
  assert.equal(result.status,'retry');
  assert.equal(h.calls.sent.length,0);
  assert.equal(h.calls.failed[0].errorCode,'EVENT_NOT_AVAILABLE');
 }
});
test('invalid device or claim fails closed',async()=>{
 const h=setup({devices:[{endpoint:'invalid'}]});
 assert.equal((await h.worker.deliverOne()).status,'retry');
 assert.equal(h.calls.sent.length,0);
 const g=setup({jobOverride:{tenant_id:'wrong'}});
 assert.equal((await g.worker.deliverOne()).status,'retry');
 assert.equal(g.calls.sent.length,0);
});
