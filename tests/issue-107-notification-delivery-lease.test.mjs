import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationDeliveryLease} from '../src/server/notifications/notificationDeliveryLease.js';
const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222';
const harness=(rows=[{id}])=>{
 const calls=[],db={query:async(sql,params=[])=>{calls.push({sql,params});return{rows}},
 release:()=>calls.push({sql:'RELEASE'})};
 return{svc:createNotificationDeliveryLease({pool:{connect:async()=>db}}),calls};
};
test('one atomic claim with SKIP LOCKED and expiring lease',async()=>{
 const x=harness();assert.ok(await x.svc.claimNext());
 assert.match(x.calls[0].sql,/for update skip locked limit 1/);
 assert.match(x.calls[0].sql,/claim_token=gen_random_uuid\(\)/);
 assert.match(x.calls[0].sql,/attempt_count<8/);
});
test('nothing due does not dispatch',async()=>{assert.equal(await harness([]).svc.claimNext(),null)});
test('only current claim owner can mark delivery sent',async()=>{
 const x=harness();assert.equal(await x.svc.complete({deliveryId:id,claimToken:token}),true);
 assert.match(x.calls[0].sql,/claim_token=\$2/);
 assert.match(x.calls[0].sql,/claimed_until>now\(\)/);
 assert.deepEqual(x.calls[0].params,[id,token]);
});
test('stale claim cannot acknowledge delivery',async()=>{
 assert.equal(await harness([]).svc.complete({deliveryId:id,claimToken:token}),false);
});
test('failure schedules bounded backoff and stores code only',async()=>{
 const x=harness();assert.equal(await x.svc.fail({deliveryId:id,claimToken:token,errorCode:'PUSH_RETRYABLE'}),true);
 assert.match(x.calls[0].sql,/make_interval/);
 assert.deepEqual(x.calls[0].params,[id,token,'PUSH_RETRYABLE']);
});
test('invalid claim identity and freeform errors rejected before SQL',async()=>{
 const x=harness();
 await assert.rejects(x.svc.complete({deliveryId:'bad',claimToken:token}),/CLAIM_INVALID/);
 await assert.rejects(x.svc.fail({deliveryId:id,claimToken:token,errorCode:'password=secret'}),/CLAIM_INVALID/);
 assert.equal(x.calls.length,0);
});

test('no-device cancellation requires current lease and allowlisted reason',async()=>{
 const h=harness();
 assert.equal(await h.svc.cancel({deliveryId:id,claimToken:token,reasonCode:'NO_SUBSCRIBED_DEVICE'}),true);
 assert.match(h.calls[0].sql,/status='cancelled'/);
 assert.match(h.calls[0].sql,/claimed_until>now\(\)/);
 assert.deepEqual(h.calls[0].params,[id,token,'NO_SUBSCRIBED_DEVICE']);
});
