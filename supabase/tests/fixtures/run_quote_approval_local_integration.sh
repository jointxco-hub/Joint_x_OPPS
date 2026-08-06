#!/usr/bin/env bash
# Reproducible local-only test runner for recovery/xlab-quote-approval.
#
# WHAT THIS DOES: applies the disposable test scaffold, then the X LAB and
# OPPS migrations documented for this recovery work, in the required order,
# then runs the integration test. Stops on the first error (set -e plus
# `-v ON_ERROR_STOP=1` on every psql invocation).
#
# WHAT THIS NEVER DOES: read production credentials, or run against
# anything but a local Docker container. This script does not accept a
# host, port, or connection string at all - it only ever talks to a named
# local Docker container via `docker exec`, which cannot reach a remote or
# hosted database by construction (there is no network hop to redirect).
# The guard below is an explicit, auditable check for that guarantee, and
# also refuses to proceed if it finds signs your shell environment is
# configured to point at the real hosted Supabase project. (This repo has
# its own .env doing exactly that - this script deliberately never reads
# .env at all.)
#
# Usage:
#   XLAB_MIGRATIONS_DIR="/path/to/X LAB/supabase/migrations" \
#   RECOVERY_CHECKOUT="/path/to/a recovery/xlab-quote-approval checkout" \
#     ./supabase/tests/fixtures/run_quote_approval_local_integration.sh \
#     [container_name]
#
# RECOVERY_CHECKOUT must point at a working directory with
# recovery/xlab-quote-approval checked out (a `git worktree add` of that
# branch is the recommended way to get one without disturbing whatever is
# checked out in your main working directory - see
# docs/QUOTE_APPROVAL_MANUAL_BROWSER_CHECKLIST.md). That branch is where
# the OPPS migrations and the integration test itself live; this script
# does not duplicate or embed them.
#
# KNOWN LIMITATION, confirmed by actually running this script repeatedly
# while writing it: X LAB's 202608050001_quote_approval_and_resource_files.sql
# contains one bare `create trigger` (no OR REPLACE, no IF NOT EXISTS -
# Postgres does not support the latter for triggers before v14 and this
# migration does not use it). That single statement is NOT idempotent, so
# rerunning this script against a container that already has these
# migrations applied fails there with "trigger ... already exists". This is
# real, pre-existing, non-idempotent DDL in a file this recovery work does
# not own or modify - not a bug in this script. If you hit it:
#   docker exec -e PGPASSWORD=postgres <container> psql -U postgres -d postgres \
#     -c "drop trigger if exists trg_xlab_resource_files_upd on public.xlab_resource_files;"
# then rerun this script. A genuinely fresh disposable container never hits
# this on its first run.

set -euo pipefail

CONTAINER_NAME="${1:-supabase_db_codex_invoice_full_schema_20260802}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=================================================================="
echo "  Quote-approval local integration test runner"
echo "  Container: $CONTAINER_NAME"
echo "=================================================================="

# ---------------------------------------------------------------------------
# Safety gate 1: refuse to proceed if any Supabase/Postgres connection env
# var is set to something that isn't obviously local. This script never
# reads these itself (it only ever uses `docker exec` below), but their
# presence pointing at a non-local value is a strong signal that something
# in the environment intends to talk to production, and this script should
# not run at all under that condition.
# ---------------------------------------------------------------------------
for var_name in SUPABASE_URL VITE_SUPABASE_URL DATABASE_URL SUPABASE_DB_URL POSTGRES_URL; do
  value="${!var_name:-}"
  if [[ -n "$value" ]]; then
    if [[ "$value" != *"127.0.0.1"* && "$value" != *"localhost"* && "$value" != *"::1"* ]]; then
      echo "REFUSING TO RUN: \$$var_name is set to a non-local value:" >&2
      echo "  $value" >&2
      echo "This script only ever operates via 'docker exec' against a local container and does not use this variable, but its presence with a non-local value suggests your shell is configured to point at a real/hosted database. Unset it before running this script." >&2
      exit 1
    fi
  fi
done
echo "[ok] No non-local Supabase/Postgres connection variable found in the environment."

# ---------------------------------------------------------------------------
# Safety gate 2: Docker must be reachable, and the target must be a real
# local container - not a hostname, not a URL, nothing resolvable over a
# network. This is what makes "non-local" structurally impossible here.
# ---------------------------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not reachable. Start Docker Desktop first." >&2
  exit 1
fi

if [[ "$CONTAINER_NAME" == *"."* || "$CONTAINER_NAME" == *":"* || "$CONTAINER_NAME" == *"/"* ]]; then
  echo "REFUSING TO RUN: container name '$CONTAINER_NAME' looks like a hostname or URL, not a Docker container name. This script only accepts a plain local container name." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Container '$CONTAINER_NAME' is not running - attempting to start it (it must already exist from a prior disposable-stack session)..."
  if ! docker start "$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "ERROR: could not start '$CONTAINER_NAME'. It may not exist yet." >&2
    echo "See docs/QUOTE_APPROVAL_MANUAL_BROWSER_CHECKLIST.md, 'Recreate the local stack from scratch', if you need to build a new disposable stack." >&2
    exit 1
  fi
  sleep 3
fi

CONTAINER_ID="$(docker inspect --format '{{.Id}}' "$CONTAINER_NAME" 2>/dev/null || true)"
if [[ -z "$CONTAINER_ID" ]]; then
  echo "ERROR: could not resolve container '$CONTAINER_NAME' after starting it - refusing to continue." >&2
  exit 1
fi
echo "[ok] Target confirmed: local Docker container '$CONTAINER_NAME' ($CONTAINER_ID)."
echo "     This is a docker-exec target, not a network host/URL - it cannot reach a remote database."

# ---------------------------------------------------------------------------
# Locate inputs.
# ---------------------------------------------------------------------------
if [[ -z "${XLAB_MIGRATIONS_DIR:-}" ]]; then
  echo "ERROR: set XLAB_MIGRATIONS_DIR to the path of the X LAB repo migrations directory." >&2
  echo "Example: XLAB_MIGRATIONS_DIR=/c/path/to/X_LAB/supabase/migrations" >&2
  exit 1
fi
if [[ -z "${RECOVERY_CHECKOUT:-}" ]]; then
  echo "ERROR: set RECOVERY_CHECKOUT to a working directory with recovery/xlab-quote-approval checked out (e.g. a git worktree)." >&2
  echo "Example: RECOVERY_CHECKOUT=/c/wt/opps-recovery" >&2
  exit 1
fi

if [[ ! -d "$XLAB_MIGRATIONS_DIR" ]]; then
  echo "ERROR: XLAB_MIGRATIONS_DIR does not exist: $XLAB_MIGRATIONS_DIR" >&2
  exit 1
fi
if [[ ! -f "$RECOVERY_CHECKOUT/supabase/tests/quote_approval_local_integration.sql" ]]; then
  echo "ERROR: RECOVERY_CHECKOUT does not look like a recovery/xlab-quote-approval checkout (missing supabase/tests/quote_approval_local_integration.sql): $RECOVERY_CHECKOUT" >&2
  exit 1
fi

run_sql() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: expected file not found: $file" >&2
    exit 1
  fi
  echo ""
  echo "== Applying: $file =="
  docker exec -i -e PGPASSWORD=postgres "$CONTAINER_NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$file"
}

echo ""
echo "== Step 1/5: local-only test scaffold (never production schema) =="
run_sql "$SCRIPT_DIR/xlab_quote_approval_local_scaffold.sql"

echo ""
echo "== Step 2/5: X LAB migrations =="
run_sql "$XLAB_MIGRATIONS_DIR/202608050001_quote_approval_and_resource_files.sql"
run_sql "$XLAB_MIGRATIONS_DIR/202608050004_quote_request_drafts.sql"
run_sql "$XLAB_MIGRATIONS_DIR/202608060001_client_quote_request_archive_delete.sql"

echo ""
echo "== Step 3/5: OPPS migrations (from RECOVERY_CHECKOUT) =="
run_sql "$RECOVERY_CHECKOUT/supabase/migrations/202608050001_xlab_quote_approval.sql"
run_sql "$RECOVERY_CHECKOUT/supabase/migrations/202608050002_xlab_orders_awaiting_payment.sql"
run_sql "$RECOVERY_CHECKOUT/supabase/migrations/202608050004_hide_draft_quote_requests.sql"

if [[ -f "$RECOVERY_CHECKOUT/supabase/migrations/202608060001_hide_archived_quote_requests.sql" ]]; then
  echo ""
  echo "== Applying 202608060001_hide_archived_quote_requests.sql to THIS LOCAL DATABASE ONLY =="
  echo "This file is intentionally uncommitted on recovery/xlab-quote-approval (its X LAB"
  echo "counterpart is real but also uncommitted there - see"
  echo "docs/QUOTE_APPROVAL_TENANT_ARCHITECTURE_LIMITATION.md). Applying it to a disposable"
  echo "local database for testing is a separate decision from committing it to git, already"
  echo "made and documented earlier in this recovery work, and is required for the archive-"
  echo "hides-the-request assertion in quote_approval_local_integration.sql (a committed file)"
  echo "to mean anything. This step changes only this local container's schema - it does not"
  echo "touch git, and does not run 'git add'/'git commit' on that file."
  run_sql "$RECOVERY_CHECKOUT/supabase/migrations/202608060001_hide_archived_quote_requests.sql"
else
  echo "NOTE: 202608060001_hide_archived_quote_requests.sql was not found in RECOVERY_CHECKOUT's"
  echo "working tree (it is uncommitted, so a fresh git checkout will not have it) - the"
  echo "archive-hides-the-request assertion in the integration test will fail without it."
  echo "Copy it in manually from wherever it is currently preserved, or recreate it from"
  echo "docs/QUOTE_APPROVAL_TENANT_ARCHITECTURE_LIMITATION.md before rerunning this script."
fi

echo ""
echo "== Step 4/5: cleaning up any leftover rows from a previous run of this script =="
# The integration test always inserts (never upserts) using fixed test
# emails/IDs, so rerunning it against a database that already has rows from
# a prior run fails on stale-data collisions (e.g. a request already
# approved on a previous run no longer has status='new'). This cleanup step
# lives here, in the runner script, rather than in the committed
# quote_approval_local_integration.sql on the recovery branch, so that
# fixing script-level reproducibility does not require any change to that
# branch. Covers every table get_internal_client_requests_unscoped unions
# from (not just client_quote_requests/xlab_orders) because ad hoc manual
# testing against the same fixture emails can leave rows in any of them,
# which then inflates "visible request count" assertions on rerun. Only
# ever deletes rows tied to this fixture's own *.invalid test emails.
docker exec -e PGPASSWORD=postgres "$CONTAINER_NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
  delete from public.xlab_orders where customer_email in ('client-a@quote-approval-local-test.invalid','client-b@quote-approval-local-test.invalid');
  delete from public.client_quote_requests where client_email in ('client-a@quote-approval-local-test.invalid','client-b@quote-approval-local-test.invalid');
  delete from public.client_messages where client_email in ('client-a@quote-approval-local-test.invalid','client-b@quote-approval-local-test.invalid');
  delete from public.client_profile_requests where client_email in ('client-a@quote-approval-local-test.invalid','client-b@quote-approval-local-test.invalid');
  delete from public.client_tech_packs where client_id in (select id from public.clients where email in ('client-a@quote-approval-local-test.invalid','client-b@quote-approval-local-test.invalid'));
  delete from public.client_special_instructions where client_id in (select id from public.clients where email in ('client-a@quote-approval-local-test.invalid','client-b@quote-approval-local-test.invalid'));
  delete from public.client_approvals where client_id in (select id from public.clients where email in ('client-a@quote-approval-local-test.invalid','client-b@quote-approval-local-test.invalid'));
  delete from public.client_contract_acceptances where client_id in (select id from public.clients where email in ('client-a@quote-approval-local-test.invalid','client-b@quote-approval-local-test.invalid'));
"

echo ""
echo "== Step 5/5: running the integration test =="
run_sql "$RECOVERY_CHECKOUT/supabase/tests/quote_approval_local_integration.sql"

echo ""
echo "=================================================================="
echo "  ALL STEPS COMPLETED SUCCESSFULLY."
echo "=================================================================="
