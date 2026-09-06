#!/usr/bin/env bash
# Disposable behavioural verification for QUOTES Q2.5.
# Throwaway postgres:16-alpine; prelude + Q1 migration + Q2.5 migration +
# suite; then destroyed. Touches nothing else.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CID="quotes-q25-disposable-$$"
PRELUDE="$HERE/quotes_q1_disposable_prelude.sql"
MIG_Q1="$ROOT/supabase/migrations/20260906090000_quotes_q1_canonical_schema.sql"
MIG_Q25="$ROOT/supabase/migrations/20260906100000_quotes_q2_5_published_revision.sql"
TEST="$HERE/quotes_q2_5_published_revision.sql"
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
sleep 3

psql_run() { docker exec -i "$CID" psql -X -v ON_ERROR_STOP=1 -U postgres -d q1; }

for step in "prelude:$PRELUDE" "Q1 migration:$MIG_Q1" "Q2.5 migration:$MIG_Q25"; do
  name="${step%%:*}"; file="${step#*:}"
  echo "== apply: $name =="
  if ! psql_run < "$file" > "$OUTDIR/step.out" 2>&1; then
    echo "$name FAILED:"; cat "$OUTDIR/step.out"; exit 1
  fi
  grep -qi '^ERROR' "$OUTDIR/step.out" && { echo "$name emitted ERROR:"; grep -i '^ERROR' "$OUTDIR/step.out"; exit 1; }
  echo "   ok"
done

echo "== behavioural suite =="
psql_run < "$TEST" > "$OUTDIR/suite.out" 2>&1
rc=$?
grep -E 'NOTICE:  (SEED|PASS|CLEANUP)|^ERROR:' "$OUTDIR/suite.out" | sed 's/^NOTICE:  //'
echo "-----------------------------------------"
PASSN="$(grep -c 'NOTICE:  PASS ' "$OUTDIR/suite.out")"
if [ "$rc" -ne 0 ] || grep -qE '^ERROR:' "$OUTDIR/suite.out"; then
  echo "RESULT: FAIL  (psql rc=$rc, $PASSN passing scenario groups)"
  grep -E '^ERROR:|^DETAIL:|^CONTEXT:' "$OUTDIR/suite.out" | head
  exit 1
fi
echo "RESULT: PASS  ($PASSN scenario groups, psql rc=0)"
