import test from 'node:test';
import assert from 'node:assert/strict';
import { qrPayfastRequestFields, verifyQrPayfastItn, correlateQrPayment } from '../src/server/cafeQr/qrPayfastCorrelation.js';

const request = {id:'11111111-1111-4111-8111-111111111111',targetId:'22222222-2222-4222-8222-222222222222',tenantId:'33333333-3333-4333-8333-333333333333',type:'opps_invoice',amountCents:14500};
const data = () => ({...qrPayfastRequestFields(request),merchant_id:'merchant-123',pf_payment_id:'pf-1',payment_status:'COMPLETE',amount_gross:'145.00',signature:'dummy'});
const form = values => new URLSearchParams(values).toString();
const validFetch = async (url, options) => {assert.match(url,/^https:\/\/(sandbox\.)?payfast\.co\.za\/eng\/query\/validate$/);assert.equal(options.method,'POST');return {ok:true,text:async()=> 'VALID'};};
const run = (values=data(),opts={}) => verifyQrPayfastItn(form(values),{expectedMerchantId:'merchant-123',sandbox:true,fetchImpl:validFetch,...opts});
test('issuer creates distinctive immutable request correlation fields',()=>{
  const fields=qrPayfastRequestFields(request);
  assert.equal(fields.m_payment_id,`JXQR-${request.id}`);
  assert.equal(fields.custom_str2,'jointx_qr_v1');
  assert.equal(fields.custom_str5,request.tenantId);
  assert.ok(Object.isFrozen(fields));
  assert.throws(()=>qrPayfastRequestFields({...request,tenantId:'wrong'}),/INVALID_QR_REQUEST/);
});
test('verified PayFast notification matches saved request, amount and gateway id',async()=>{
  const result=await run();
  assert.equal(result.ok,true);
  assert.deepEqual(correlateQrPayment(result,request),{verified:true,id:'pf-1',amountCents:14500,requestId:request.id,tenantId:request.tenantId,type:request.type,targetId:request.targetId});
});
test('never routes legacy invoice, Café or storefront callbacks as QR',async()=>{
  for(const marker of ['invoice','quick_solution','',undefined]){
    const entry=data(); if(marker===undefined)delete entry.custom_str2;else entry.custom_str2=marker;
    assert.equal((await run(entry)).reason,'NOT_QR_NOTIFICATION');
  }
});
test('merchant, signature and gateway reference are required',async()=>{
  for(const [prop,value,reason] of [['merchant_id','other','MERCHANT_MISMATCH'],['signature','','IDENTITY_MISSING'],['pf_payment_id','','IDENTITY_MISSING']]){
    assert.equal((await run({...data(),[prop]:value})).reason,reason);
  }
});
test('rejects malformed, duplicate-key and huge notifications',async()=>{
  assert.equal((await verifyQrPayfastItn(form(data())+'&custom_str2=jointx_qr_v1',{expectedMerchantId:'merchant-123',fetchImpl:validFetch})).reason,'MALFORMED_ITN');
  assert.equal((await verifyQrPayfastItn('x'.repeat(64001),{expectedMerchantId:'merchant-123',fetchImpl:validFetch})).reason,'MALFORMED_ITN');
});
test('rejects foreign request ID, invalid amount and noncomplete status',async()=>{
  for(const [prop,value,reason] of [
    ['custom_str3','invalid','REQUEST_IDENTITY_MISMATCH'],['custom_str4','other','REQUEST_IDENTITY_MISMATCH'],
    ['m_payment_id','forged','REQUEST_IDENTITY_MISMATCH'],['amount_gross','145.01','CORRELATION_MISMATCH'],
    ['amount_gross','1e6','AMOUNT_INVALID'],['payment_status','FAILED','NOT_COMPLETE']]){
    const result=await run({...data(),[prop]:value});
    assert.equal(reason==='CORRELATION_MISMATCH'?correlateQrPayment(result,request).reason:result.reason,reason);
  }
});
test('rejects failed PayFast validation and retries unavailable validation',async()=>{
  assert.equal((await run(data(),{fetchImpl:async()=>({ok:true,text:async()=> 'INVALID'})})).reason,'SIGNATURE_INVALID');
  assert.equal((await run(data(),{fetchImpl:async()=>{throw Error('offline')}})).reason,'VALIDATION_UNAVAILABLE');
  assert.equal((await run(data(),{fetchImpl:async()=>({ok:false,status:503})})).reason,'VALIDATION_UNAVAILABLE');
});
test('refuses mismatched private request identity or amount after verification',async()=>{
  const verified=await run();
  for(const change of [{tenantId:'another'},{targetId:'other'},{type:'cafe_order'},{id:'other'},{amountCents:14400}]){
    assert.equal(correlateQrPayment(verified,{...request,...change}).reason,'CORRELATION_MISMATCH');
  }
});
