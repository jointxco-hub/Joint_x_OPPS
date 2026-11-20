import test from "node:test";
import assert from "node:assert/strict";
import { resolveTrustedQrSettlementPayable } from "../src/server/cafeQr/resolveTrustedQrSettlementPayable.js";

const invoice = "11111111-1111-4111-8111-111111111111";
const tenant = "22222222-2222-4222-8222-222222222222";
function setup({ exists=true, slug="quick-solution", tenantStatus="active", status="approved",
    currency="ZAR", cents="14500", linked=false }={}) {
  const statements=[];
  const db={async query(sql,params) {
    statements.push({sql,params});
    if(sql.includes("from public.opps_invoices i")) return {rows:exists?[{
      id:invoice,tenant_id:tenant,status,currency_code:currency,tenant_slug:slug,
      tenant_status:tenantStatus,cafe_service_order_linked:linked
    }]:[]};
    if(sql.includes("invoice_balance_due")) return {rows:[{cents}]};
    throw Error("Unexpected SQL");
  }};
  return {statements,run:(type="opps_invoice",targetId=invoice,tenantId=tenant)=>
    resolveTrustedQrSettlementPayable({db,type,targetId,tenantId})};
}
test("verified gateway resolver reads canonical balance only after tenant-scoped invoice lock",async()=>{
  const h=setup(),result=await h.run();
  assert.deepEqual(result,{tenantId:tenant,eligible:true,reviewRequired:false,balanceCents:14500});
  assert.match(h.statements[0].sql,/where i.id=\$1 and i.tenant_id=\$2/);
  assert.match(h.statements[0].sql,/for update of i/);
  assert.deepEqual(h.statements[0].params,[invoice,tenant]);
  assert.match(h.statements[1].sql,/invoice_balance_due/);
});
test("callback cannot choose unsupported Café order settlement path",async()=>{
  const h=setup();
  await assert.rejects(h.run("cafe_order"),/SETTLEMENT_TARGET_NOT_SUPPORTED/);
  assert.equal(h.statements.length,0);
});
test("invalid identifiers and cross-tenant invoices fail without reading balance",async()=>{
  await assert.rejects(setup().run("opps_invoice","bad-id"),/INVALID_SETTLEMENT_IDENTITY/);
  await assert.rejects(setup().run("opps_invoice",invoice,"bad-tenant"),/INVALID_SETTLEMENT_IDENTITY/);
  for(const options of [{exists:false},{slug:"another-tenant"},{tenantStatus:"suspended"}]){
    const h=setup(options);
    await assert.rejects(h.run(),/SETTLEMENT_TARGET_UNAVAILABLE/);
    assert.equal(h.statements.length,1);
  }
});
test("paid or invalid invoice states never authorize a second gateway settlement",async()=>{
  for(const options of [{status:"paid",cents:"0"},{status:"draft"},{status:"void"},
    {status:"exported"},{currency:"USD"},{linked:true},{cents:null},{cents:"-1"},
    {cents:"999999999999999999999"}]){
    const result=await setup(options).run();
    assert.equal(result.eligible,false,JSON.stringify(options));
    assert.equal(result.reviewRequired,true);
  }
});
