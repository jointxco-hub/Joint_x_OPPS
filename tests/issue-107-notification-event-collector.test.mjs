import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationEventCollector} from '../src/server/notifications/notificationEventCollector.js';
const tenantId='11111111-1111-4111-8111-111111111111';
const invoiceId='22222222-2222-4222-8222-222222222222';
const eventId='33333333-3333-4333-8333-333333333333';
function setup(rows=[],failAt=-1) {
 const sql=[],sent=[];let release=0;
 const pool={connect:async()=>({
  query:async(text,params)=>{sql.push({text,params});return{rows}},
  release:()=>release++,
 })};
 const outbox={enqueueCommittedEvent:async event=>{
  if(sent.length===failAt)throw Error('temporary queue failure');
  sent.push(event);
 }};
 return {collector:createNotificationEventCollector({pool,outbox}),sql,sent,releases:()=>release};
}
const row=(id=eventId,kind='invoice',event_type='INVOICE_APPROVED')=>({
 created_at:'2026-11-09T08:00:00.000Z',id,tenant_id:tenantId,
 document_id:invoiceId,kind,event_type,
});
test('collects committed invoice activity with stable audit UUID',async()=>{
 const h=setup([row()]);
 const result=await h.collector.collect();
 assert.equal(result.processed,1);
 assert.equal(result.cursor.id,eventId);
 assert.deepEqual(h.sent[0],{
  tenantId,sourceId:invoiceId,eventType:'INVOICE_APPROVED',
  eventKey:`${tenantId}:invoice:${invoiceId}:${eventId}`
 });
 assert.match(h.sql[0].text,/opps_invoice_activity/);
 assert.match(h.sql[0].text,/opps_quote_events/);
 assert.match(h.sql[0].text,/a.to_status='paid'/);
 assert.equal(h.releases(),1);
});
test('quote accepted has a distinct durable key',async()=>{
 const h=setup([row(eventId,'quote','QUOTE_ACCEPTED')]);
 await h.collector.collect();
 assert.equal(h.sent[0].eventType,'QUOTE_ACCEPTED');
 assert.match(h.sent[0].eventKey,/:quote:/);
});
test('cursor uses timestamp and UUID ordering and bounded batch',async()=>{
 const h=setup([row()]);
 await h.collector.collect({cursor:{createdAt:'2026-11-08T09:00:00Z',id:eventId},limit:1});
 assert.equal(h.sql[0].params[1],eventId);
 assert.equal(h.sql[0].params[2],1);
 assert.match(h.sql[0].text,/\(created_at,id\)>\(\$1::timestamptz,\$2::uuid\)/);
});
test('no events keeps the existing cursor',async()=>{
 const cursor={createdAt:'2026-11-08T09:00:00Z',id:eventId};
 const h=setup([]),out=await h.collector.collect({cursor});
 assert.deepEqual(out.cursor,cursor);
 assert.equal(out.processed,0);
});
test('queue failure prevents cursor return so caller can replay',async()=>{
 const h=setup([row()],0);
 await assert.rejects(h.collector.collect(),/temporary queue failure/);
 assert.equal(h.sent.length,0);
 assert.equal(h.releases(),1);
});
test('invalid audit row fails closed without enqueuing',async()=>{
 const h=setup([row('bad')]);
 await assert.rejects(h.collector.collect(),/COLLECTOR_EVENT_INVALID/);
 assert.equal(h.sent.length,0);
});
test('malformed cursor or huge batch rejected before SQL',async()=>{
 const h=setup([]);
 await assert.rejects(h.collector.collect({limit:500}),/COLLECTOR_CURSOR_INVALID/);
 await assert.rejects(h.collector.collect({cursor:{createdAt:'bad',id:eventId}}),/COLLECTOR_CURSOR_INVALID/);
 assert.equal(h.sql.length,0);
});
