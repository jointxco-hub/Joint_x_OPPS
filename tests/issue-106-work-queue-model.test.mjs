import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkQueue } from '../src/features/cafeWorkQueue/normalizeWorkQueue.js';

test('malformed server response fails closed', () => {
  assert.throws(() => normalizeWorkQueue(null), /Invalid Cafe/);
  assert.throws(() => normalizeWorkQueue({items: {}}), /Invalid Cafe/);
});

test('retains distinct invoice and order identities and deduplicates repeats', () => {
  const {items} = normalizeWorkQueue({items:[
    {type:'invoice',id:'one',number:'INV-1',balanceDue:0},
    {type:'invoice',id:'one',number:'INV-1',balanceDue:0},
    {type:'order',id:'one',number:'ORD-1',balanceDue:15},
  ]});
  assert.equal(items.length,2);
  assert.deepEqual(items.map(x=>x.key),['invoice:one','order:one']);
});

test('never infers payment balance when amount is missing or invalid', () => {
  const {items} = normalizeWorkQueue({items:[
    {type:'invoice',id:'a'},
    {type:'invoice',id:'b',balanceDue:'invalid'},
    {type:'invoice',id:'c',balanceDue:-1},
  ]});
  assert.deepEqual(items.map(x=>x.balanceDue),[null,null,null]);
});

test('drops unsupported work types and retains review-required state', () => {
  const {items,nextCursor}=normalizeWorkQueue({items:[
    {type:'payment',id:'p'},
    {type:'invoice',id:'i',reviewRequired:true,balanceDue:50},
  ],nextCursor:'next'});
  assert.equal(items.length,1);
  assert.equal(items[0].reviewRequired,true);
  assert.equal(nextCursor,'next');
});

test('preserves server-provided invoice linkage through normalization for safe display grouping', () => {
  const {items} = normalizeWorkQueue({items:[
    {type:'order',id:'order-a',number:'QS-A',customerName:'Client A'},
    {type:'invoice',id:'invoice-a',number:'INV-A',sourceOrderId:'order-a',balanceDue:0},
    {type:'invoice',id:'invoice-b',sourceOrderId:null},
  ]});
  assert.equal(items[0].sourceOrderId,null);
  assert.equal(items[0].customerName,'Client A');
  assert.equal(items[1].sourceOrderId,'order-a');
  assert.equal(items[1].balanceDue,0);
  assert.equal(items[2].sourceOrderId,null);
});
