import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync('supabase/functions/quick-solution-qr-opps106-notify/index.ts','utf8');
const line=src.split('\n').find(x=>x.trim().startsWith('const uuid = '));
if (!line) throw Error('QR notification UUID gate missing');
const match=line.match(/const uuid = (\/.*\/[a-z]*)/);
if (!match) throw Error('QR notification UUID regex unavailable');
const raw=match[1];const regex=new RegExp(raw.slice(1,raw.lastIndexOf('/')),raw.slice(raw.lastIndexOf('/')+1));
test('PayFast QR notification accepts issued order, request and tenant UUID identities',()=>{
 for(const id of ['f89b7e69-e642-46ef-8d3b-85fa25b473cf','0fd9376f-2b3d-4df3-97d8-d46e04df37fe','44ceb817-1a37-4fb4-8869-0b0d90a37ab3']) assert.equal(regex.test(id),true,id);
});
test('PayFast QR notification rejects malformed or injected UUID fields',()=>{
 for(const id of ['0fd9376f-2b3d-4df3-97d8d46e04df37fe','0fd9376f-2b3d-4df3-97d8-d46e04df37f','0fd9376f-2b3d-4df3-97d8-d46e04df37fe&role=admin','']) assert.equal(regex.test(id),false,id);
});
test('callback retains signature, merchant, trusted source, remote validation and atomic settlement checks',()=>{
 for(const marker of ['trustedSource(req, sandbox)','signedPayload(body, passphrase)','p.merchant_id !== merchantId',"'https://sandbox.payfast.co.za/eng/query/validate'",'qs_opps106_settle_counter_qr']) assert.ok(src.includes(marker),marker);
});
