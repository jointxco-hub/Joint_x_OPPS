#!/usr/bin/env bash
# Disposable behavioural verification for the QUOTES Q1 migration.
# Throwaway postgres:16-alpine; prelude + migration + suite; then destroyed.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CID="quotes-q1-disposable-$$"
PRELUDE="$HERE/quotes_q1_disposable_prelude.sql"
MIG="$ROOT/supabase/migrations/20260906090000_quotes_q1_canonical_schema.sql"
TEST="$HERE/quotes_q1_canonical_schema.sql"
OUTDIR="$(mktemp -d)"

cleanup() { docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap "cleanup; rm -rf \"$OUTDIR\"" EXIT

echo "== start postgres:16-alpine =="
docker run -d --name "$CID" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=q1 postgres:16-alpine >/dev/null

echo "== wait for readiness =="
ok=0
for i in $(seq 1 90); do
  if docker exec "$CID" pg_isready -U postgres -d q1 -h 127.0.0.1 >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || { echo "DB never became ready"; exit 1; }
sleep 3   # entrypoint's initdb-phase restart settle

psql_run() { docker exec -i "$CID" psql -X -v ON_ERROR_STOP=1 -U postgres -d q1; }

echo "== 1/3 prelude =="
if ! psql_run < "$PRELUDE" > "$OUTDIR/q1_prelude.out" 2>&1; then
  echo "PRELUDE FAILED:"; cat "$OUTDIR/q1_prelude.out"; exit 1
fi
echo "   ok"

echo "== 2/3 migration =="
if ! psql_run < "$MIG" > "$OUTDIR/q1_migration.out" 2>&1; then
  echo "MIGRATION FAILED:"; cat "$OUTDIR/q1_migration.out"; exit 1
fi
grep -qi error "$OUTDIR/q1_migration.out" && { echo "MIGRATION emitted ERROR:"; grep -i error "$OUTDIR/q1_migration.out"; exit 1; }
echo "   applied clean"

echo "== 3/3 behavioural suite =="
psql_run < "$TEST" > "$OUTDIR/q1_suite.out" 2>&1
rc=$?
grep -E 'NOTICE:  (SEED|PASS|CLEANUP)|^ERROR:' "$OUTDIR/q1_suite.out" | sed 's/^NOTICE:  //'
echo "-----------------------------------------"
PASSN="$(grep -c 'NOTICE:  PASS ' "$OUTDIR/q1_suite.out")"
if [ "$rc" -ne 0 ] || grep -qE '^ERROR:|FAIL' "$OUTDIR/q1_suite.out"; then
  echo "RESULT: FAIL  (psql rc=$rc, $PASSN passing scenarios)"
  grep -E '^ERROR:|^DETAIL:|^CONTEXT:' "$OUTDIR/q1_suite.out" | head
  exit 1
fi
echo "RESULT: PASS  ($PASSN / 17 scenarios, psql rc=0)"
