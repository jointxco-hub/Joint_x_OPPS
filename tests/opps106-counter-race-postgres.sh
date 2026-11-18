#!/usr/bin/env bash
# Disposable local / CI PostgreSQL ONLY. Never point PGHOST to Supabase.
set -euo pipefail
: "${PGHOST:?PGHOST required}"
: "${PGUSER:?PGUSER required}"
: "${PGDATABASE:?PGDATABASE required}"
if [[ "$PGHOST" != "127.0.0.1" && "$PGHOST" != "localhost" ]]; then
  echo "Refusing non-local PGHOST; disposable test only" >&2
  exit 2
fi
export PGOPTIONS="-c statement_timeout=15000 -c lock_timeout=10000"
psql -q -v ON_ERROR_STOP=1 -f tests/fixtures/opps106-counter-race-postgres.sql
psql -q -v ON_ERROR_STOP=1 -f supabase/staging-only/20261118_opps106_manual_counter_qr_concurrency.sql

ACTOR="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
id(){ printf '00000000-0000-4000-8000-%012d' "$1"; }
manual(){
 local order="$1" key="$2" method="$3"
 psql -qAt -v ON_ERROR_STOP=1 -c "
 select set_config('request.jwt.claim.sub','$ACTOR',false);
 select public.record_quick_solution_counter_payment(
   '$order'::uuid,'$method','$key');"
}
expect_block(){
 local order="$1" key="$2"
 if manual "$order" "$key" cash >"/tmp/$key.out" 2>&1; then
   echo "FAIL: manual payment unexpectedly accepted for $order" >&2; exit 1
 fi
 grep -q 'online QR/PayFast payment may still settle' "/tmp/$key.out"
}

# Concurrent session 1: owns canonical order lock and creates active QR.
# Session 2: manual payment waits on exactly that lock, then must be denied.
(
 psql -q -v ON_ERROR_STOP=1 <<SQL > /tmp/qr-lock-session.log 2>&1
BEGIN;
SELECT id FROM commerce.service_orders WHERE id='$(id 1)' FOR UPDATE;
INSERT INTO qr_payments.payment_requests(tenant_id,target_type,target_id,status)
VALUES ('11111111-1111-4111-8111-111111111111','cafe_order','$(id 1)','active');
SELECT pg_sleep(3);
COMMIT;
SQL
) &
locker=$!
sleep 1
expect_block "$(id 1)" "qractive01"
wait "$locker"
[[ "$(psql -qAt -c "select count(*) from commerce.service_order_payments where service_order_id='$(id 1)' and status='completed'")" == "0" ]]

# A checkout started before expiry stays review-required even when QR expired.
expect_block "$(id 3)" "qrexpiredstarted01"
# An expired, never-started QR doesn't make Cash/Card wait forever.
manual "$(id 4)" "expiredneverstarted01" cash > /tmp/manual-expired-safe.log
grep -q '"ok": true' /tmp/manual-expired-safe.log
expect_block "$(id 5)" "pendingpayfast01"

# Two independent cash/card terminals race on the same unpaid order.
# The canonical row lock must permit exactly one receipt.
manual "$(id 2)" "terminalA123" cash > /tmp/terminalA.log 2>&1 &
a=$!
manual "$(id 2)" "terminalB123" card > /tmp/terminalB.log 2>&1 &
b=$!
wait "$a"
wait "$b"
grep -q '"ok": true' /tmp/terminalA.log /tmp/terminalB.log
grep -q '"already_paid"' /tmp/terminalA.log /tmp/terminalB.log
[[ "$(psql -qAt -c "select count(*) from commerce.service_order_payments where service_order_id='$(id 2)' and status='completed'")" == "1" ]]
[[ "$(psql -qAt -c "select payment_status from commerce.service_orders where id='$(id 2)'")" == "paid" ]]
# Retry the winning request must return original receipt (idempotent).
if grep -q '"ok": true' /tmp/terminalA.log; then
 manual "$(id 2)" "terminalA123" cash > /tmp/replay.log
else
 manual "$(id 2)" "terminalB123" card > /tmp/replay.log
fi
grep -q '"replayed": true' /tmp/replay.log
[[ "$(psql -qAt -c "select count(*) from commerce.service_order_payments where service_order_id='$(id 2)' and status='completed'")" == "1" ]]
echo "PASS: two-session QR/manual + dual manual + stale checkout + replay; zero duplicate receipts"
