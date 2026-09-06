#!/usr/bin/env bash
# Disposable behavioural verification for QUOTES Q3 (public /q/:token).
# Throwaway postgres:16-alpine; prelude + pgcrypto + Q1 + Q2.5 + Q3 + suite.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CID="quotes-q3-$$"
PRELUDE="$HERE/quotes_q1_disposable_prelude.sql"
MIG_Q1="$ROOT/supabase/migrations/20260906090000_quotes_q1_canonical_schema.sql"
MIG_Q25="$ROOT/supabase/migrations/20260906100000_quotes_q2_5_published_revision.sql"
MIG_Q3="$ROOT/supabase/migrations/20260906120000_quotes_q3_public_route.sql"
TEST="$HERE/quotes_q3_public_route.sql"
OUT="$(mktemp -d)"
cleanup() { docker rm -f "$CID" >/dev/null 2>&1 || true; rm -rf "$OUT"; }
trap cleanup EXIT

docker run -d --name "$CID" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=q postgres:16-alpine >/dev/null
for i in $(seq 1 90); do docker exec "$CID" pg_isready -U postgres -d q -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
sleep 3
run() { docker exec -i "$CID" psql -X -v ON_ERROR_STOP=1 -U postgres -d q; }

echo "== extensions (pgcrypto in schema extensions) =="
run >/dev/null <<'SQL'
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to public;
SQL
echo "   ok"

for step in "prelude:$PRELUDE" "Q1:$MIG_Q1" "Q2.5:$MIG_Q25" "Q3:$MIG_Q3"; do
  name="${step%%:*}"; file="${step#*:}"
  echo "== apply $name =="
  if ! run < "$file" > "$OUT/s.out" 2>&1; then echo "$name FAILED:"; cat "$OUT/s.out"; exit 1; fi
  grep -qi '^ERROR' "$OUT/s.out" && { echo "$name ERROR:"; grep -i '^ERROR' "$OUT/s.out"; exit 1; }
  echo "   ok"
done

echo "== behavioural suite =="
run < "$TEST" > "$OUT/suite.out" 2>&1; rc=$?
grep -E 'NOTICE:  (SEED|PASS|CLEANUP)|^ERROR:' "$OUT/suite.out" | sed 's/^NOTICE:  //'
echo "-----------------------------------------"
P="$(grep -c 'NOTICE:  PASS ' "$OUT/suite.out")"
if [ "$rc" -ne 0 ] || grep -qE '^ERROR:' "$OUT/suite.out"; then
  echo "RESULT: FAIL (rc=$rc, $P passing)"; grep -E '^ERROR:|^DETAIL:|^CONTEXT:' "$OUT/suite.out" | head; exit 1
fi
echo "RESULT: PASS ($P scenario groups, rc=0)"
