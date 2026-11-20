import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationTargets} from '../src/server/notifications/notificationTargets.js';
const tenantId='11111111-1111-4111-8111-111111111111';
const recipientAuthUserId='22222222-2222-4222-8222-222222222222';
function harness(rows=[]){
 const calls=[];
 const pool={connect:async()=>({
  query:async(sql,params)=>{calls.push({sql,params});return {rows}},
  release:()=>calls.push({sql:'RELEASE'})
 })};
 return {targets:createNotificationTargets({pool}),calls};
}
test('looks up only recipient authenticated user id and matching tenant',async()=>{
 const h=harness([{endpoint:'https://push.test/device',auth:'private-auth',p256dh:'private-key'}]);
 const found=await h.targets.listRecipientDevices({tenantId,recipientAuthUserId});
 assert.deepEqual(found,[{endpoint:'https://push.test/device',keys:{auth:'private-auth',p256dh:'private-key'}}]);
 assert.deepEqual(h.calls[0].params,[tenantId,recipientAuthUserId]);
 assert.match(h.calls[0].sql,/join auth\.users u on u\.id=m\.auth_user_id/);
 assert.match(h.calls[0].sql,/ps\.tenant_id=m\.tenant_id/);
 assert.match(h.calls[0].sql,/m\.status='active'/);
});
test('preference opt-out blocks delivery and identity never trusts input email',async()=>{
 const h=harness([]);
 const found=await h.targets.listRecipientDevices({tenantId,recipientAuthUserId});
 assert.deepEqual(found,[]);
 assert.match(h.calls[0].sql,/coalesce\(pref\.push_enabled,true\)=true/);
 assert.doesNotMatch(h.calls[0].sql,/\$3/);
});
test('invalid tenant and recipient IDs rejected before DB connection',async()=>{
 const h=harness();
 await assert.rejects(h.targets.listRecipientDevices({tenantId:'another',recipientAuthUserId}),/RECIPIENT_ID_INVALID/);
 await assert.rejects(h.targets.listRecipientDevices({tenantId,recipientAuthUserId:'user@gmail.com'}),/RECIPIENT_ID_INVALID/);
 assert.equal(h.calls.length,0);
});
test('one database connection per lookup is released on failure',async()=>{
 let released=false;
 const targets=createNotificationTargets({pool:{connect:async()=>({
  query:async()=>{throw Error('database unavailable')},
  release:()=>{released=true},
 })}});
 await assert.rejects(targets.listRecipientDevices({tenantId,recipientAuthUserId}),/database unavailable/);
 assert.equal(released,true);
});
