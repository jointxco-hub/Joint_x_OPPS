import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/staging-only/20261118_opps106_manual_counter_qr_concurrency.sql','utf8')

test('Counter manual payment serializes with QR issuance using the canonical order lock', () => {
  assert.match(sql,/select so\.\*/)
  assert.match(sql,/for update;/i)
  assert.match(sql,/target_type='cafe_order'/)
  assert.match(sql,/r\.target_id=v_order\.id/)
})

test('manual payment requires review when QR active or checkout ever opened', () => {
  assert.match(sql,/r\.status='active' or r\.checkout_started_at is not null/)
  assert.match(sql,/p\.provider='payfast' and p\.status='pending'/)
  assert.match(sql,/raise exception using errcode='22023'/)
  assert.match(sql,/online QR\/PayFast payment may still settle/)
})

test('the guard occurs before any manual payment receipt insertion', () => {
  const guard = sql.indexOf("r.status='active' or r.checkout_started_at is not null")
  const insert = sql.indexOf('insert into commerce.service_order_payments')
  assert.ok(guard > 0 && insert > guard)
})

test('the staging gate retains existing staff, tenant, idempotency and paid checks', () => {
  for (const marker of [
    "auth.uid()", "cafe.counter.operate", "p_method not in ('cash', 'card')",
    "pg_advisory_xact_lock", "for update;", "_qs_counter_payment_block",
    "already_paid", "v_existing.service_order_id is distinct from p_order_id"
  ]) assert.ok(sql.includes(marker), marker)
  assert.match(sql,/Staging-only OPPS-106/)
})
