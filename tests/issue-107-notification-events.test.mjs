import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDocumentTransition, describeLowStockCrossing, notificationEventTypes } from '../src/lib/notificationEvents.js';
const tenantId='11111111-1111-4111-8111-111111111111';
const documentId='22222222-2222-4222-8222-222222222222';
const sourceEventId='33333333-3333-4333-8333-333333333333';
const movementId='44444444-4444-4444-8444-444444444444';
const invoice=(fromStatus,toStatus)=>describeDocumentTransition({tenantId,kind:'invoice',documentId,sourceEventId,fromStatus,toStatus});
test('invoice approval emits a stable identifier derived from committed audit event',()=>{
 const a=invoice('draft','approved');
 assert.equal(a.eventType,'INVOICE_APPROVED');
 assert.equal(a.eventKey,invoice('draft','approved').eventKey);
 assert.equal(a.tenantId,tenantId);
});
test('unchanged status on reopen or refetch does not emit an event',()=>{
 assert.equal(invoice('approved','approved'),null);
 assert.equal(invoice('paid','paid'),null);
});
test('payment and void are distinct events and unsupported changes do not dispatch',()=>{
 assert.equal(invoice('approved','paid').eventType,'INVOICE_PAID');
 assert.equal(invoice('approved','void').eventType,'INVOICE_VOIDED');
 assert.equal(invoice('draft','exported'),null);
});
test('quote accepted and declined use explicit event templates',()=>{
 const event=describeDocumentTransition({tenantId,kind:'quote',documentId,sourceEventId,fromStatus:'sent',toStatus:'accepted'});
 assert.equal(event.eventType,'QUOTE_ACCEPTED');
 assert.equal(notificationEventTypes[event.eventType].path,'/Quotes');
});
test('invalid tenant and source event IDs fail closed',()=>{
 assert.equal(describeDocumentTransition({tenantId:'bad',kind:'invoice',documentId,sourceEventId,fromStatus:'draft',toStatus:'approved'}),null);
 assert.equal(describeDocumentTransition({tenantId,kind:'invoice',documentId,sourceEventId:'bad',fromStatus:'draft',toStatus:'approved'}),null);
});
test('stock alerts only on crossing low threshold, not reopening while still low',()=>{
 const make=(before,after)=>describeLowStockCrossing({tenantId,itemId:documentId,before,after,reorderPoint:10,movementId});
 assert.equal(make(10,9),null);
 assert.equal(make(9,8),null);
 assert.equal(make(11,10).eventType,'INVENTORY_LOW');
 assert.equal(make(11,10).eventKey,make(11,10).eventKey);
});
test('restoring stock does not emit a low-stock alert',()=>{
 assert.equal(describeLowStockCrossing({tenantId,itemId:documentId,before:5,after:15,reorderPoint:10,movementId}),null);
});
