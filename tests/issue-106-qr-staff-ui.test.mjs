import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getCafeQrPresentation } from "../src/features/cafeQr/paymentRequestView.js";

const NOW=Date.parse("2026-11-15T15:00:00Z");
const UUID="61cb3665-4a50-48ce-b1bc-685d32c3d203";
const scan="https://tijiamrfnxrbitafiflj.supabase.co/functions/v1/quick-solution-qr-opps106-scan?rid="+UUID;
const base={status:"active",paymentRequestId:UUID,amountCents:35000,currency:"ZAR",expiresAt:"2026-11-15T15:02:00Z",checkoutUrl:scan};
const show=(url=scan,opts={allowStagingScan:true})=>
  getCafeQrPresentation({...base,checkoutUrl:url},NOW,opts);

test("staging scan URLs must be explicitly opted in",()=>{
  assert.equal(show(scan,{allowStagingScan:false}).canShowQr,false);
  assert.equal(show(scan).canShowQr,true);
  assert.equal(show(scan).amountCents,35000);
});
test("only exact staging host, exact path and a single UUID parameter accepted",()=>{
  for(const u of [
    scan.replace("supabase.co","supabase.co.evil.example"),
    scan.replace("https:","http:"),
    scan.replace("/quick-solution-qr-opps106-scan","/quick-solution-qr-opps106-notify"),
    scan+"&return=1",
    scan+"&rid="+UUID,
    scan.replace(UUID,"not-a-uuid"),
    scan+"#fragment",
    scan.replace("tijiamrfnxrbitafiflj","slhcvyeuqsduaglddqdb"),
  ]) assert.equal(show(u).canShowQr,false,u);
});
test("expired, settled and unpaid balance errors never show a scan link",()=>{
  assert.equal(getCafeQrPresentation({...base,expiresAt:"2026-11-15T14:59:59Z"},NOW,{allowStagingScan:true}).canShowQr,false);
  assert.equal(getCafeQrPresentation({...base,status:"settled"},NOW,{allowStagingScan:true}).canShowQr,false);
  assert.equal(getCafeQrPresentation({...base,amountCents:0},NOW,{allowStagingScan:true}).canShowQr,false);
});
test("feature-branch staff view never offers a browser-supplied price and checks staging + workspace",()=>{
  const page=readFileSync("src/pages/CafeQrSandbox.jsx","utf8");
  const api=readFileSync("src/api/cafeCounterQr.js","utf8");
  assert.match(page,/currentWorkspace\?\.slug === "quick-solution"/);
  assert.match(page,/VITE_SUPABASE_URL === STAGING_SUPABASE/);
  assert.match(page,/allowStagingScan:isStaging/);
  assert.match(api,/qs_opps106_counter_qr_preflight/);
  assert.match(api,/qs_opps106_issue_counter_qr/);
  assert.doesNotMatch(api,/p_amount|amountCents|tenant_id/);
});
