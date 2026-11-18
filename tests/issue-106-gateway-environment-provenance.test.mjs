import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/staging-only/20261118_opps106_gateway_environment_provenance.sql','utf8');
const classification = readFileSync('supabase/staging-only/20261118_opps106_verified_qr_metadata.sql','utf8');

test('environment evidence is persisted only with a linked complete gateway ITN',()=>{
  assert.match(sql,/add column gateway_environment text/);
  assert.match(sql,/add column gateway_environment_evidence text/);
  assert.match(sql,/p\.pf_payment_id=r\.gateway_payment_id/);
  assert.match(sql,/p\.raw_itn->>'payment_status'='COMPLETE'/);
  assert.match(sql,/p\.raw_itn->>'m_payment_id'='JXQR-'\|\|r\.id::text/);
  assert.match(sql,/r\.status='settled'/);
  assert.match(sql,/gateway_environment='sandbox'/);
  assert.match(sql,/gateway_environment_evidence='sandbox_only_verified_itn'/);
});
test('the gateway environment must be explicit and paired with an evidence source',()=>{
  assert.match(sql,/qr_payment_environment_evidence_pair/);
  assert.match(sql,/gateway_environment is null and gateway_environment_evidence is null/);
  assert.match(sql,/gateway_environment in \('sandbox','live'\)/);
  assert.match(sql,/gateway_environment_evidence in \('sandbox_only_verified_itn'\)/);
});
test('verified sandbox classification checks persisted environment and exact gateway identity',()=>{
  assert.match(sql,/r\.gateway_environment='sandbox'/);
  assert.match(sql,/r\.gateway_environment_evidence='sandbox_only_verified_itn'/);
  assert.match(sql,/p\.raw_itn->>'m_payment_id'='JXQR-'\|\|r\.id::text/);
  assert.match(classification,/and new\.payment_environment='sandbox'/);
  assert.match(classification,/and new\.is_test=true and new\.excluded_from_reports=true/);
});
test('this canary-specific environment proof is never an automatic production migration',()=>{
  assert.match(sql,/STAGING CANARY ONLY/);
  assert.doesNotMatch(sql,/drop trigger/i);
  assert.doesNotMatch(sql,/disable trigger/i);
  assert.doesNotMatch(sql,/grant\s+execute\s+on\s+function/i);
});
