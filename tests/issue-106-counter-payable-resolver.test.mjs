import test from "node:test";
import assert from "node:assert/strict";
import { resolveCafeCounterPayable } from "../src/server/cafeQr/resolveCafeCounterPayable.js";

const id="11111111-1111-4111-8111-111111111111";
const tenant="22222222-2222-4222-8222-222222222222";
const user="33333333-3333-4333-8333-333333333333";
function setup({ payment="unpaid",status="confirmed",total="145.00",paid="0",pending=0,
  linked=false,channel="counter",role=true,tenantSlug="quick-solution",
  metadata={},items=1,configured=1,allowed=true,fulfilment="collection",minimum="50",
  exists=true }={}) {
  const queries=[];
  const db={async query(sql,params){
    queries.push({sql,params});
    if(sql.includes("from commerce.service_orders so")) return {rows:exists?[{
      tenant_id:tenant,status,payment_status:payment,total_amount:total,
      opps_order_id:linked?id:null,channel,fulfilment_type:fulfilment,
      source_metadata:metadata,tenant_slug:tenantSlug,tenant_status:"active",min_payfast:minimum}]:[]};
    if(sql.includes("from public.tenant_memberships")) return {rows:role?[{allowed:true}]:[]};
    if(sql.includes("from commerce.service_order_payments")) return {rows:[{paid,pending_count:pending}]};
    if(sql.includes("from commerce.service_order_items")) return {rows:[{
      total_items:items,configured_items:configured,allowed}]};
    throw Error("Unexpected SQL query");
  }};
  return {queries,run:(actor={userId:user,authenticatedByServer:true},type="cafe_order") =>
    resolveCafeCounterPayable({db,type,targetId:id,actor})};
}
test("counter order is priced from completed receipts, with locks and tenant access",async()=>{
  const {run,queries}=setup();
  assert.deepEqual(await run(),{
    tenantId:tenant,eligible:true,reviewRequired:false,balanceCents:14500});
  assert.match(queries[0].sql,/for update of so/);
  assert.match(queries[1].sql,/tenant_memberships/);
  assert.match(queries[2].sql,/status='completed'/);
  assert.deepEqual(queries[2].params,[tenant,id]);
});
test("staff auth, tenant and target gates deny unauthorized access",async()=>{
  await assert.rejects(setup().run(null),/AUTH_REQUIRED/);
  await assert.rejects(setup().run({userId:user,authenticatedByServer:false}),/AUTH_REQUIRED/);
  await assert.rejects(setup().run({userId:user,authenticatedByServer:true},"opps_invoice"),/TARGET_TYPE_NOT_SUPPORTED/);
  for(const x of [{exists:false},{role:false},{tenantSlug:"other"}])
    await assert.rejects(setup(x).run(),/NOT_FOUND_OR_FORBIDDEN/);
});
test("linked orders, non-counter channel, and partial or pending receipts fail closed",async()=>{
  for(const x of [{linked:true},{channel:"web"},{paid:"10"},{pending:1}])
    assert.equal((await setup(x).run()).eligible,false,JSON.stringify(x));
});
test("closed or paid orders and payment restrictions cannot issue checkout",async()=>{
  for(const x of [
    {payment:"paid"},{payment:"failed"},{status:"draft"},{status:"cancelled"},
    {status:"completed"},{total:"0"},{total:"not money"},{minimum:"200"},
    {metadata:{quoteRequired:true}},{metadata:{paymentProjectionReview:{required:true}}},
    {fulfilment:"delivery"},{items:0},{configured:0},{allowed:false},
  ]) assert.equal((await setup(x).run()).eligible,false,JSON.stringify(x));
});
