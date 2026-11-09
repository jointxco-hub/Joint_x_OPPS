import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationCollectorRunner} from '../src/server/notifications/notificationCollectorRunner.js';
const id='11111111-1111-4111-8111-111111111111';
function setup({busy=false,fail=false,existing=null,next={createdAt:'2026-11-09T08:00:00.000Z',id}}={}) {
 const calls=[],processed=[];let released=0;
 const pool={connect:async()=>({
  query:async(sql,params=[])=>{
   calls.push({sql,params});
   if(sql.includes('select cursor_created_at,cursor_id'))
    return {rows:busy?[]:[{cursor_created_at:existing?.createdAt||null,cursor_id:existing?.id||null}]};
   return {rows:[]};
  },
  release:()=>{released++},
 })};
 const collector={collect:async params=>{processed.push(params);if(fail)throw Error('fanout failed');return {processed:1,hasMore:false,cursor:next}}};
 return {runner:createNotificationCollectorRunner({pool,collector}),calls,processed,releases:()=>released};
}
test('initial collection persists cursor only after downstream fanout',async()=>{
 const h=setup(),result=await h.runner.runOnce();
 assert.equal(result.status,'collected');
 assert.equal(h.calls[0].sql,'BEGIN');
 assert.match(h.calls[2].sql,/for update skip locked/);
 assert.equal(h.processed.length,1);
 assert.equal(h.calls.at(-1).sql,'COMMIT');
 const write=h.calls.find(c=>c.sql.includes('update opps_private.notification_collectors'));
 assert.equal(write.params[2],id);
 assert.equal(h.releases(),1);
});
test('existing cursor resumes from committed position',async()=>{
 const cursor={createdAt:'2026-11-08T08:00:00.000Z',id};
 const h=setup({existing:cursor});
 await h.runner.runOnce({limit:12});
 assert.deepEqual(h.processed[0],{cursor,limit:12});
});
test('busy collector does not call fanout and releases lock',async()=>{
 const h=setup({busy:true});
 const result=await h.runner.runOnce();
 assert.equal(result.status,'busy');
 assert.equal(h.calls.at(-1).sql,'ROLLBACK');
 assert.equal(h.processed.length,0);
});
test('fanout fails: checkpoint rolls back so event will be replayed',async()=>{
 const h=setup({fail:true});
 await assert.rejects(h.runner.runOnce(),/fanout failed/);
 assert.equal(h.calls.at(-1).sql,'ROLLBACK');
 assert.equal(h.releases(),1);
});
test('invalid scheduling inputs never connect',async()=>{
 const h=setup();
 await assert.rejects(h.runner.runOnce({name:'bad;DROP TABLE'}),/COLLECTOR_RUN_INVALID/);
 await assert.rejects(h.runner.runOnce({limit:1001}),/COLLECTOR_RUN_INVALID/);
 assert.equal(h.calls.length,0);
});
test('no events does not overwrite existing cursor',async()=>{
 const h=setup({next:null});
 await h.runner.runOnce();
 assert.equal(h.calls.some(c=>c.sql.includes('update opps_private.notification_collectors')),false);
 assert.equal(h.calls.at(-1).sql,'COMMIT');
});
