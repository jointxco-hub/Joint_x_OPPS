import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const scanner = readFileSync('supabase/functions/quick-solution-qr-opps106-scan/index.ts','utf8');
const line = scanner.split('\n').find(line => line.startsWith('const UUID = '));
if (!line) throw new Error('Scanner UUID validation not found');
const regex = /^const UUID = (\/.*\/[a-z]*)$/.exec(line.trim())?.[1];
if (!regex) throw new Error('Expected an explicit scanner regex');
const validate = new RegExp(regex.slice(1,regex.lastIndexOf('/')),regex.slice(regex.lastIndexOf('/')+1));
test('scan route accepts a genuine version-4 UUID issued by private DB',()=>{
  assert.equal(validate.test('7705b342-1323-4b54-89d1-30990b9d91ea'),true);
  assert.equal(validate.test('61cb3665-4a50-48ce-b1bc-685d32c3d203'),true);
});
test('scan route rejects malformed, truncated and parameter-contaminated UUIDs',()=>{
  for(const str of [
    '7705b342-1323-4b54-89d1-30990b9d91e',
    '7705b342-1323-4b54-89d130990b9d91ea',
    '7705b342-1323-4b54-89d1-30990b9d91ea&cancel=1',
    '',
    'not-a-uuid'
  ]) assert.equal(validate.test(str),false,str);
});
