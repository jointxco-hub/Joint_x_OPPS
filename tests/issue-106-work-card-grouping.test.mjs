import test from 'node:test';
import assert from 'node:assert/strict';
import { groupWorkCards } from '../src/features/cafeWorkQueue/groupWorkCards.js';

test('linked invoices are nested under one order without losing canonical identities', () => {
  const cards = groupWorkCards([
    {type:'invoice',id:'i1',number:'INV-1',sourceOrderId:'o1',balanceDue:0},
    {type:'order',id:'o1',number:'ORD-1',balanceDue:null},
    {type:'invoice',id:'i1',number:'INV-1',sourceOrderId:'o1',balanceDue:0},
    {type:'invoice',id:'i2',number:'INV-2',sourceOrderId:'o1',balanceDue:15},
  ]);
  assert.equal(cards.length,1);
  assert.equal(cards[0].kind,'order');
  assert.equal(cards[0].order.id,'o1');
  assert.deepEqual(cards[0].invoices.map(x=>x.id),['i1','i2']);
  assert.deepEqual(cards[0].invoices.map(x=>x.balanceDue),[0,15]);
});

test('truly standalone invoice is its own card', () => {
  const cards = groupWorkCards([{type:'invoice',id:'i3',sourceOrderId:null}]);
  assert.equal(cards.length,1);
  assert.equal(cards[0].kind,'invoice');
  assert.equal(cards[0].linkedOrderNotOnPage,false);
});

test('linked invoice with absent order is flagged instead of falsely standalone', () => {
  const cards = groupWorkCards([{type:'invoice',id:'i4',sourceOrderId:'other-page'}]);
  assert.equal(cards.length,1);
  assert.equal(cards[0].linkedOrderNotOnPage,true);
});

test('never merges a same-id invoice with an unrelated order', () => {
  const cards = groupWorkCards([
    {type:'order',id:'same'},
    {type:'invoice',id:'same',sourceOrderId:null},
  ]);
  assert.equal(cards.length,2);
  assert.deepEqual(cards.map(x=>x.key),['order:same','invoice:same']);
});
