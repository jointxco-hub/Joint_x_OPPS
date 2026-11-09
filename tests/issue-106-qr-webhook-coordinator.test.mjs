import test from "node:test";
import assert from "node:assert/strict";
import { createQrWebhookCoordinator } from "../src/server/cafeQr/qrWebhookCoordinator.js";
import { applyQrInvoiceReceipt } from "../src/server/cafeQr/applyQrInvoiceReceipt.js";
import { createPgQrWebhookStorage } from "../src/server/cafeQr/pgQrWebhookStorage.js";

const request = {
 id:"11111111-1111-4111-8111-111111111111",
 targetId:"22222222-2222-4222-8222-222222222222",
 tenantId:"33333333-3333-4333-8333-333333333333",
 type:"opps_invoice",amountCents:14500,status:"active",
};
const verified = {
 ok:true,requestId:request.id,targetId:request.targetId,
 tenantId:request.tenantId,type:request.type,amountCents:14500,
 gatewayPaymentId:"pf-123",
};
function coordinator(overrides={}) {
  const quarantine=[];
  const send = createQrWebhookCoordinator({
    expectedMerchantId:"merchant-1",sandbox:true,
    verify: async () => verified,
    loadSavedRequest: async () => request,
    paymentService:{recordVerifiedSettlement:async input=>{
      assert.equal(input.verifiedPayment.requestId,request.id);
      assert.equal(input.applyCanonicalReceipt,applyQrInvoiceReceipt);
      return {status:"settled",replayed:false};
    }},
    quarantineVerifiedCapture:async entry=>{quarantine.push(entry);return {persisted:true}},
    ...overrides,
  });
  return {send,quarantine};
}
test("verified invoice capture returns 200 only after settled canonical receipt",async()=>{
  const h=coordinator(),result=await h.send("irrelevant");
  assert.deepEqual(result,{httpStatus:200,reason:"SETTLED"});
});
test("gateway outage returns 503 and does not touch database",async()=>{
  let lookedUp=false;
  const h=coordinator({
    verify:async()=>({ok:false,reason:"VALIDATION_UNAVAILABLE"}),
    loadSavedRequest:async()=>{lookedUp=true},
  });
  assert.equal((await h.send("raw")).httpStatus,503);
  assert.equal(lookedUp,false);
});
test("invalid merchant is rejected without touching ledger",async()=>{
  let lookedUp=false;
  const h=coordinator({
    verify:async()=>({ok:false,reason:"MERCHANT_MISMATCH"}),
    loadSavedRequest:async()=>{lookedUp=true},
  });
  assert.deepEqual(await h.send("raw"),{httpStatus:200,reason:"MERCHANT_MISMATCH"});
  assert.equal(lookedUp,false);
});
test("missing request is acknowledged only if capture is durably quarantined",async()=>{
  const a=coordinator({loadSavedRequest:async()=>null});
  assert.equal((await a.send("raw")).reason,"DURABLY_QUARANTINED");
  assert.equal(a.quarantine[0].reason,"CORRELATION_MISMATCH");
  const b=coordinator({
    loadSavedRequest:async()=>null,quarantineVerifiedCapture:async()=>({persisted:false}),
  });
  assert.equal((await b.send("raw")).httpStatus,503);
});
test("verified mismatched amount is quarantined; foreign order type never settles",async()=>{
  const a=coordinator({loadSavedRequest:async()=>({...request,amountCents:14400})});
  assert.equal((await a.send("raw")).reason,"DURABLY_QUARANTINED");
  const b=coordinator({loadSavedRequest:async()=>({...request,type:"cafe_order"})});
  assert.equal((await b.send("raw")).reason,"DURABLY_QUARANTINED");
});
test("payment write failure never falsely acknowledges an invoice payment",async()=>{
  const h=coordinator({paymentService:{
    recordVerifiedSettlement:async()=>{throw Error("DB unavailable")},
  }});
  assert.deepEqual(await h.send("raw"),{httpStatus:503,reason:"SETTLEMENT_FAILED"});
});
test("review-required ledger exception is a durable acknowledged outcome",async()=>{
  const h=coordinator({paymentService:{
    recordVerifiedSettlement:async()=>({status:"review_required"}),
  }});
  assert.deepEqual(await h.send("raw"),{httpStatus:200,reason:"DURABLY_QUARANTINED"});
});
test("invoice receipt writes through existing DB RPC in caller transaction",async()=>{
  const queries=[];
  const out=await applyQrInvoiceReceipt({tx:{db:{query:async(sql,params)=>{
    queries.push({sql,params});return {rows:[{result:{ok:true,payment_id:"receipt-1",replayed:false}}]};
  }}},request,verifiedPayment:{
    verified:true,id:"pf-123",amountCents:14500,requestId:request.id,
    targetId:request.targetId,tenantId:request.tenantId,type:request.type,
  }});
  assert.equal(out.paymentId,"receipt-1");
  assert.match(queries[0].sql,/public.apply_invoice_payfast_payment/);
  assert.deepEqual(queries[0].params,[request.targetId,14500,"pf-123"]);
});
test("invoice receipt refuses invalid correlation and ignored payment",async()=>{
  await assert.rejects(applyQrInvoiceReceipt({
    tx:{db:{query:async()=>{throw Error("must not write")}}},
    request,verifiedPayment:{
      verified:true,id:"pf",requestId:"wrong",tenantId:request.tenantId,
      targetId:request.targetId,type:request.type,amountCents:14500
    }
  }),/RECEIPT_CORRELATION_INVALID/);
  await assert.rejects(applyQrInvoiceReceipt({
    tx:{db:{query:async()=>({rows:[{result:{ok:true,ignored:true}}]})}},
    request,verifiedPayment:{
      verified:true,id:"pf",requestId:request.id,tenantId:request.tenantId,
      targetId:request.targetId,type:request.type,amountCents:14500
    }
  }),/INVOICE_RECEIPT_REQUIRES_RECONCILIATION/);
});
function poolWith(rowsForRequest=[]) {
  const calls=[],db={
    query:async(sql,params)=>{
      calls.push({sql,params});
      if(sql.includes("from qr_payments.payment_requests where id=")) return {rows:rowsForRequest};
      if(sql.includes("as reference_conflict")) return {rows:[{reference_conflict:false}]};
      if(sql.includes("insert into qr_payments.")) return {rows:[{id:1}]};
      return {rows:[]};
    }, release:()=>calls.push({sql:"RELEASE"})
  };
  return {calls,pool:{connect:async()=>db}};
}
test("verified orphan capture persists without request foreign key",async()=>{
  const p=poolWith(),storage=createPgQrWebhookStorage({pool:p.pool});
  const result=await storage.quarantineVerifiedCapture({
    requestId:request.id,tenantId:request.tenantId,
    targetId:request.targetId,type:request.type,
    gatewayPaymentId:"pf-orphan",amountCents:14500,reason:"MISSING",
  });
  assert.equal(result.persisted,true);
  assert.ok(p.calls.some(x=>x.sql.includes("qr_payments.unmatched_captures")));
  assert.equal(p.calls.at(-2).sql,"COMMIT");
});
test("matching saved QR capture uses linked exception ledger",async()=>{
  const p=poolWith([{id:request.id,tenant_id:request.tenantId,
    target_id:request.targetId,target_type:request.type}]);
  const storage=createPgQrWebhookStorage({pool:p.pool});
  await storage.quarantineVerifiedCapture({
    requestId:request.id,tenantId:request.tenantId,
    targetId:request.targetId,type:request.type,
    gatewayPaymentId:"pf-linked",amountCents:14500,reason:"AMOUNT_CHANGED",
  });
  assert.ok(p.calls.some(x=>x.sql.includes("qr_payments.payment_exceptions")));
  assert.ok(!p.calls.some(x=>x.sql.includes("qr_payments.unmatched_captures")));
});

test("quarantine fails closed on a reused provider reference with a different claim", async () => {
  const queries=[];
  const db={
    query:async(sql,params)=>{
      queries.push({sql,params});
      if(sql.includes("from qr_payments.payment_requests where id=")) return {rows:[]};
      if(sql.includes("as reference_conflict")) return {rows:[{reference_conflict:true}]};
      throw Error("No insert allowed after provider reference conflict");
    },
    release:()=>{},
  };
  const storage=createPgQrWebhookStorage({pool:{connect:async()=>db}});
  const out=await storage.quarantineVerifiedCapture({
    requestId:request.id,tenantId:request.tenantId,targetId:request.targetId,
    type:request.type,gatewayPaymentId:"pf-collision",amountCents:14500,
    reason:"CORRELATION_MISMATCH",
  });
  assert.deepEqual(out,{persisted:false,reason:"GATEWAY_REFERENCE_CONFLICT"});
  assert.equal(queries.at(-1).sql,"ROLLBACK");
  assert.ok(!queries.some(q=>q.sql.includes("insert into")));
});

test("quarantine does not acknowledge an unsuccessful conflicting insert",async()=>{
  const calls=[];
  const db={
    query:async(sql,params)=>{
      calls.push(sql);
      if(sql.includes("from qr_payments.payment_requests where id=")) return {rows:[]};
      if(sql.includes("as reference_conflict")) return {rows:[{reference_conflict:false}]};
      if(sql.includes("insert into qr_payments.unmatched_captures")) return {rows:[]};
      return {rows:[]};
    },release:()=>{}
  };
  const storage=createPgQrWebhookStorage({pool:{connect:async()=>db}});
  const out=await storage.quarantineVerifiedCapture({
    requestId:request.id,tenantId:request.tenantId,targetId:request.targetId,
    type:request.type,gatewayPaymentId:"pf-conflict",amountCents:14500,reason:"MISSING",
  });
  assert.equal(out.persisted,false);
  assert.equal(calls.at(-1),"ROLLBACK");
});
