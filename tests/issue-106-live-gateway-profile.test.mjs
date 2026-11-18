import test from "node:test";
import assert from "node:assert/strict";
import {getPayfastGatewayProfile,matchGatewayCheckoutProfile,PAYFAST_ENDPOINTS} from "../supabase/functions/_shared/payfastGatewayProfile.js";
const sandbox=()=>({
 PAYFAST_SANDBOX:"true",PAYFAST_MERCHANT_ID:"10000100",
 PAYFAST_MERCHANT_KEY:"sandbox-private-key",PAYFAST_PASSPHRASE:"sandbox-secret",
 OPPS106_QR_MODE:"sandbox"
});
const live=()=>({
 PAYFAST_SANDBOX:"false",PAYFAST_MERCHANT_ID:"15000100",
 PAYFAST_MERCHANT_KEY:"live-private-key",PAYFAST_PASSPHRASE:"live-secret",
 OPPS106_QR_MODE:"live",OPPS106_LIVE_MERCHANT_ID:"15000100",
 OPPS106_SANDBOX_MERCHANT_ID:"10000100",OPPS106_LIVE_GATEWAY_APPROVED:"true",
 OPPS106_LIVE_CALLBACK_ENABLED:"true",
 OPPS106_LIVE_RETURN_BASE:"https://opps.jointx.co",
 OPPS106_LIVE_NOTIFY_URL:"https://example.jointx.co/functions/v1/quick-solution-qr-opps106-live-notify"
});
test("endpoint pairing is explicit, not derived from caller/browser fields",()=>{
 assert.equal(PAYFAST_ENDPOINTS.live.process,"https://www.payfast.co.za/eng/process");
 assert.equal(PAYFAST_ENDPOINTS.live.validate,"https://www.payfast.co.za/eng/query/validate");
 assert.equal(PAYFAST_ENDPOINTS.sandbox.process,"https://sandbox.payfast.co.za/eng/process");
 assert.equal(PAYFAST_ENDPOINTS.sandbox.validate,"https://sandbox.payfast.co.za/eng/query/validate");
});
test("sandbox profile works only with server sandbox config",()=>{
 const p=getPayfastGatewayProfile(sandbox(),"sandbox");
 assert.equal(p.ok,true);assert.equal(p.environment,"sandbox");
 assert.equal(getPayfastGatewayProfile(sandbox(),"live").reason,"MODE_MISMATCH");
});
test("live profile requires two approvals and distinct LIVE config",()=>{
 const e=live();
 for(const change of [
  v=>delete v.OPPS106_LIVE_GATEWAY_APPROVED,
  v=>v.OPPS106_LIVE_CALLBACK_ENABLED="false",
  v=>v.OPPS106_QR_MODE="sandbox",
  v=>v.PAYFAST_SANDBOX="true",
  v=>v.OPPS106_LIVE_MERCHANT_ID="10000100",
  v=>v.OPPS106_SANDBOX_MERCHANT_ID="15000100",
  v=>v.OPPS106_LIVE_NOTIFY_URL="https://opps.jointx.co/functions/v1/sandbox-notify",
  v=>v.OPPS106_LIVE_NOTIFY_URL="http://not-secure",
  v=>v.OPPS106_LIVE_RETURN_BASE="https://joint-x-opps-git-feature.vercel.app"
 ]){const v={...e};change(v);assert.equal(getPayfastGatewayProfile(v,"live").ok,false);}
 const p=getPayfastGatewayProfile(e,"live");
 assert.equal(p.ok,true);assert.equal(p.validationUrl,PAYFAST_ENDPOINTS.live.validate);
});
test("missing secrets, mode or mismatched merchant never silently fall back",()=>{
 for(const key of ["PAYFAST_MERCHANT_ID","PAYFAST_MERCHANT_KEY","PAYFAST_PASSPHRASE"]){
  const e=live();delete e[key];assert.equal(getPayfastGatewayProfile(e,"live").reason,"CREDENTIALS_REQUIRED");
 }
 assert.equal(getPayfastGatewayProfile({},"live").ok,false);
 assert.equal(getPayfastGatewayProfile(live(),undefined).ok,false);
});
test("even valid gateway selection must match immutable checkout intent",()=>{
 const profile=getPayfastGatewayProfile(live(),"live");
 const intent={environment:"live",merchantId:"15000100",
  gatewayReference:"JXQR-f50bd2bf-7ee5-4389-b9d6-9867e04d8e66",amountCents:6000};
 assert.equal(matchGatewayCheckoutProfile(profile,intent).ok,true);
 assert.equal(matchGatewayCheckoutProfile(profile,{...intent,environment:"sandbox"}).reason,"ENVIRONMENT_MISMATCH");
 assert.equal(matchGatewayCheckoutProfile(profile,{...intent,merchantId:"10000100"}).reason,"MERCHANT_MISMATCH");
 assert.equal(matchGatewayCheckoutProfile(profile,{...intent,amountCents:0}).reason,"AMOUNT_INVALID");
 assert.equal(matchGatewayCheckoutProfile(profile,{...intent,gatewayReference:"JXQR-other"}).reason,"CHECKOUT_REFERENCE_INVALID");
});
