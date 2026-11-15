import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync('supabase/functions/quick-solution-qr-opps106-notify/index.ts','utf8');
test('QR webhook explicitly accepts both PayFast normal and dashboard resend bodies',()=>{
 assert.match(source,/contentType\.startsWith\('application\/x-www-form-urlencoded'\)/);
 assert.match(source,/contentType\.startsWith\('multipart\/form-data;'\)/);
 assert.match(source,/await req\.formData\(\)/);
 assert.match(source,/fields\.append\(key,value\)/);
 assert.match(source,/body = fields\.toString\(\)/);
});
test('multipart form rejects file content, duplicate fields, malformed keys, unknown content types',()=>{
 assert.match(source,/typeof value !== 'string' \|\| seen\.has\(key\)/);
 assert.match(source,/seen\.add\(key\)/);
 assert.match(source,/response\(400\)/);
 assert.match(source,/response\(415\)/);
});
test('both body types pass through the SAME signature, trusted source and PayFast VALID verification',()=>{
 const canonical=source.indexOf('const verified = signedPayload(body, passphrase)');
 const multipart=source.indexOf("contentType.startsWith('multipart/form-data;')");
 assert.ok(multipart>0 && canonical>multipart);
 assert.match(source,/trustedSource\(req, sandbox\)/);
 assert.match(source,/same\(verified\.signature, verified\.expected\)/);
 assert.match(source,/sandbox\.payfast\.co\.za\/eng\/query\/validate/);
 assert.match(source,/qs_opps106_settle_counter_qr/);
});
