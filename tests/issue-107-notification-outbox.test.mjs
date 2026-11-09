import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationOutbox } from '../src/server/notifications/notificationOutbox.js';

const tenantId='11111111-1111-4111-8111-111111111111';
const sourceId='22222222-2222-4222-8222-222222222222';
const event={tenantId,sourceId,eventType:'INVOICE_APPROVED',
 eventKey:`${tenantId}:invoice:${sourceId}:33333333-3333-4333-8333-333333333333`};

function harness({inactive=false,conflict=false,fail=false}={}) {
  const queries=[]; let released=false;
  const db={query:async(sql,params=[])=>{
    queries.push({sql,params});
    if(fail && sql.includes('insert into opps_private.notification_deliveries'))throw Error('write failed');
    if(sql.includes('from public.tenants'))return {rows:inactive?[]:[{id:tenantId}]};
    if(sql.includes('insert into opps_private.notification_events'))return {rows:conflict?[]:[{id:'event-1'}]};
    return {rows:[]};
  },release:()=>{released=true}};
  return {outbox:createNotificationOutbox({pool:{connect:async()=>db}}),queries,isReleased:()=>released};
}
test('transaction verifies active tenant and server-selected staff recipients',async()=>{
 const h=harness(),out=await h.outbox.enqueueCommittedEvent(event);
 assert.equal(out.eventId,'event-1');
 assert.equal(h.queries[0].sql,'BEGIN');
 assert.equal(h.queries.at(-1).sql,'COMMIT');
 const recipients=h.queries.find(q=>q.sql.includes('notification_deliveries'));
 assert.deepEqual(recipients.params[2],['owner','admin']);
 assert.match(recipients.sql,/tenant_memberships/);
 assert.match(recipients.sql,/auth_user_id/);
 assert.equal(h.isReleased(),true);
});
test('same event and recipient are idempotent',async()=>{
 const h=harness();await h.outbox.enqueueCommittedEvent(event);
 assert.match(h.queries.find(q=>q.sql.includes('notification_events')).sql,/on conflict \(tenant_id,event_key\)/);
 assert.match(h.queries.find(q=>q.sql.includes('notification_deliveries')).sql,/on conflict \(event_id,recipient_auth_user_id\) do nothing/);
});
test('inactive tenant and altered replay payload roll back',async()=>{
 for(const options of [{inactive:true},{conflict:true}]){
   const h=harness(options);await assert.rejects(h.outbox.enqueueCommittedEvent(event));
   assert.equal(h.queries.at(-1).sql,'ROLLBACK');assert.equal(h.isReleased(),true);
 }
});
test('delivery insertion failure rolls back event',async()=>{
 const h=harness({fail:true});
 await assert.rejects(h.outbox.enqueueCommittedEvent(event),/write failed/);
 assert.equal(h.queries.at(-1).sql,'ROLLBACK');
});
test('malformed, unsupported and cross-tenant event claims are rejected before SQL',async()=>{
 const h=harness();
 for(const changed of [
   {tenantId:'wrong'}, {eventType:'UNKNOWN'}, {eventKey:'wrong:invoice:event'},
 ]){
   await assert.rejects(h.outbox.enqueueCommittedEvent({...event,...changed}),/NOTIFICATION_EVENT_INVALID/);
 }
 assert.equal(h.queries.length,0);
});
test('inventory alert includes counter operator roles',async()=>{
 const h=harness();
 await h.outbox.enqueueCommittedEvent({...event,eventType:'INVENTORY_LOW'});
 assert.deepEqual(h.queries.find(q=>q.sql.includes('notification_deliveries')).params[2],
   ['owner','admin','member','counter_staff']);
});
