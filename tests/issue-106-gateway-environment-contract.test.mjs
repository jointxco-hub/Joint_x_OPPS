import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVerifiedPayfastEnvironment as resolve } from '../src/server/cafeQr/gatewayEnvironmentContract.js';

const sandbox = () => ({
  serverConfig: { environment: 'sandbox', merchantId: 'sandbox-merchant-001' },
  intent: {
    environment: 'sandbox', merchantId: 'sandbox-merchant-001',
    requestId: 'r-1', orderId: 'o-1', tenantId: 't-1',
    gatewayReference: 'JXQR-r-1', amountCents: 6000,
  },
  verifiedCallback: {
    environment: 'sandbox', merchantId: 'sandbox-merchant-001',
    requestId: 'r-1', orderId: 'o-1', tenantId: 't-1',
    gatewayReference: 'JXQR-r-1', gatewayPaymentId: 'pf-1',
    amountCents: 6000, signatureValid: true, trustedSource: true,
    remoteValidated: true, status: 'COMPLETE',
  },
});

test('verified sandbox writes explicit sandbox evidence and test-only reporting overrides',()=>{
  assert.deepEqual(resolve(sandbox()),{
    ok:true,environment:'sandbox',evidence:'payfast_itn_validated_sandbox',
    gatewayPaymentId:'pf-1',reporting:{forceTest:true,forceExclude:true},
  });
});

test('verified live writes live evidence, never clears operator QA/report exclusions',()=>{
  const input=sandbox();
  input.serverConfig.environment='live';
  input.serverConfig.merchantId='live-merchant-001';
  input.intent.environment='live';
  input.intent.merchantId='live-merchant-001';
  input.verifiedCallback.environment='live';
  input.verifiedCallback.merchantId='live-merchant-001';
  assert.deepEqual(resolve(input),{
    ok:true,environment:'live',evidence:'payfast_itn_validated_live',
    gatewayPaymentId:'pf-1',reporting:null,
  });
});

test('sandbox and live gateway mixups are denied for either direction',()=>{
  for(const change of [
    x=>x.intent.environment='live',
    x=>x.verifiedCallback.environment='live',
    x=>x.serverConfig.environment='live',
  ]){
    const x=sandbox();change(x);
    assert.deepEqual(resolve(x),{ok:false,reason:'ENVIRONMENT_MISMATCH'});
  }
});

test('merchant or persisted identity changes are denied',()=>{
  for(const change of [
    x=>x.intent.merchantId='other-merchant',
    x=>x.verifiedCallback.merchantId='other-merchant',
  ]){
    const x=sandbox();change(x);
    assert.deepEqual(resolve(x),{ok:false,reason:'MERCHANT_MISMATCH'});
  }
  for(const change of [
    x=>x.verifiedCallback.requestId='other-request',
    x=>x.verifiedCallback.tenantId='other-tenant',
    x=>x.verifiedCallback.orderId='other-order',
    x=>x.verifiedCallback.gatewayReference='other-reference',
    x=>x.verifiedCallback.gatewayPaymentId='',
  ]){
    const x=sandbox();change(x);
    assert.deepEqual(resolve(x),{ok:false,reason:'REQUEST_MISMATCH'});
  }
});

test('unsigned, source-untrusted, unvalidated or non-complete callback cannot settle',()=>{
  for(const change of [
    x=>x.verifiedCallback.signatureValid=false,
    x=>x.verifiedCallback.trustedSource=false,
    x=>x.verifiedCallback.remoteValidated=false,
    x=>x.verifiedCallback.status='CANCELLED',
    x=>delete x.verifiedCallback.remoteValidated,
  ]){
    const x=sandbox();change(x);
    assert.deepEqual(resolve(x),{ok:false,reason:'CALLBACK_NOT_VERIFIED'});
  }
});

test('missing server/intent environment and amount drift fail closed',()=>{
  for(const change of [
    x=>x.serverConfig.environment=undefined,
    x=>x.intent.environment=undefined,
    x=>x.intent.merchantId='',
    x=>x.intent.amountCents=0,
    x=>x.intent.gatewayReference='',
  ]){
    const x=sandbox();change(x);
    assert.equal(resolve(x).ok,false);
  }
  for(const amount of [5900,6000.5,NaN]){
    const x=sandbox();x.verifiedCallback.amountCents=amount;
    assert.deepEqual(resolve(x),{ok:false,reason:'AMOUNT_MISMATCH'});
  }
});

test('missing context does not authorize a payment',()=>{
  assert.deepEqual(resolve({}),{ok:false,reason:'INVALID_CONTEXT'});
});
