# Shared Supabase Migration Reconciliation — 2026-09-01

## Background

The production Supabase project (`slhcvyeuqsduaglddqdb`, "Alethe
Ecosyteme") is shared by more than one repository. Historically, both
`jointxco-hub/Joint_x_OPPS` and the separate X LAB repository have
applied migrations directly against this same database. Each repo's
`supabase/migrations` directory has only ever tracked its own team's
work, so neither repo's migration history — on its own — fully
reproduces the live production schema.

This document records a **source-history-only** reconciliation that
brings OPPS's tracked migration files back into agreement with what is
actually live in production and in the shared ledger
(`supabase_migrations.schema_migrations`). **No SQL from this PR was
executed against production. No ledger row was inserted, updated, or
repaired. No production write of any kind occurred.**

## Immediate canonical source

For this recovery, **OPPS becomes the practical canonical migration
source** for the shared database — not because it is architecturally
correct long-term, but because it already holds the deeper/older
history and is where this reconciliation effort lives. This is a
pragmatic, least-churn choice, not a final decision.

**Long-term recommendation:** a dedicated, shared `supabase/migrations`
repository (or equivalent single authority) that both OPPS and X LAB
push through, so no team can again apply schema changes that the other
team's repo never sees. Not implemented by this PR.

## Findings and dispositions

### `202608300001` — historical, intentional 12-digit version
This version predates the later `YYYYMMDDHHMMSS` convention and uses a
12-digit `YYYYMMDD` + 4-digit-sequence form instead. It is genuinely
recorded in the production ledger this way; it does not need — and must
not be given — a 14-digit rename. `supabase migration list --linked`
renders it as two separate (one remote-only, one local-only) rows
instead of one matched row. This is a **CLI display/ordering artifact**,
reproduced identically under Supabase CLI 2.90.0 and 2.116.0: the
merge logic appears to compare version strings as bare integers, and a
12-digit version sitting next to 14-digit neighbors from the same week
sorts far out of place numerically even though its ledger content is
byte-identical (modulo line endings) to this file. **No repair is
needed for this entry.**

### `20260828090000` — belongs to Public Storefront Commerce
The production ledger's `20260828090000` row is, and remains,
`supabase/migrations/20260828090000_public_storefront_commerce_catalog.sql`.
Its version and contents are unchanged by this PR.

### Snapshot Lifecycle — was applied but unrecorded, now renamed to `20260828090001`
A second, unrelated migration
(`order_line_snapshot_lifecycle_foundation.sql`) was originally also
authored under version `20260828090000` — a version collision with the
Storefront Commerce migration above. Its SQL is fully live in
production (the `is_current`/`revision`/`superseded_by` columns and
`order_line_component_snapshots_current_uidx` index on
`order_line_component_snapshots`, plus
`revise_order_line_component_snapshot()` and
`duplicate_order_line_with_snapshots()`, all confirmed present), but it
has **no record at all in `schema_migrations`**, under any version —
most likely because it was applied through a path that bypassed the
ledger entirely once the version collision made a normal `db push`
impossible.

This PR renames the file, verbatim (no SQL body change), to:

```
supabase/migrations/20260828090001_order_line_snapshot_lifecycle_foundation.sql
```

`20260828090001` was verified unused in OPPS, in X LAB, and in the
production ledger before the rename. A follow-up, separate,
explicitly-authorized step will later mark this version `applied` in
the ledger via a controlled `migration repair` (recording history —
never re-executing the already-live SQL). That step is **not** part of
this PR.

### Customer-facing RPCs — recovered from X LAB, verbatim

Two migrations were already recorded in the production ledger, but
their source files had never been committed to OPPS. The true original
files were located, still tracked, in the X LAB repository and are
copied here **byte-for-byte** (verified by SHA-256 checksum against the
X LAB working tree) — no rewrite, no added header, no format change:

- `202608300001_client_product_customer_isolation_rpcs.sql`
- `20260830160000_customer_invoices_rpc.sql`

Their statement-level content was independently re-verified against
`supabase_migrations.schema_migrations` for these exact versions
(normalizing only CRLF/LF line-ending differences — X LAB's checkout of
the first file uses CRLF, the ledger and the second file use LF; this
is not a content difference).

Three further migrations are live in production but have **no ledger
record under any version** — the same "applied but unrecorded" pattern
as the Snapshot Lifecycle case above, this time originating entirely
from X LAB:

- `20260830170000_customer_invoices_rpc_v2.sql` — adds
  `customer_name`, `customer_billing_address`, `payment_terms`,
  `reference_number` to `get_my_invoices()`, for the customer's own
  invoice document/PDF. Confirmed genuinely rendered by X LAB's
  `CustomerInvoiceDocument.jsx`.
- `20260831140000_customer_link_client_file_to_artwork_rpc.sql` — lets
  a customer link one of their own existing files to a required
  artwork placement (`link_my_client_file_to_artwork`).
- `20260831150000_customer_product_artwork_current_rows.sql` — changes
  `get_my_client_product_artwork()` to return every `is_current = true`
  row regardless of approval status (previously `approved`-only), so a
  customer sees a file they just linked immediately. Explicitly a
  **display projection only** — it does not touch approval or reorder
  readiness authority, which remain server-side and unchanged.

All three are copied verbatim from their tracked X LAB originals
(SHA-256 verified), and their live `pg_get_functiondef()` definitions
were independently confirmed to match these files exactly.

**The current live behavior for both the invoice fields and the
artwork visibility change is intentional, already-shipped, working
product behavior.** This PR does not revert, "fix," or add a corrective
migration for either — it only makes the source history match what is
already running.

## What this PR does NOT do

- Does not run `supabase db push`.
- Does not run `supabase migration repair`.
- Does not insert, update, or delete any row in
  `supabase_migrations.schema_migrations`.
- Does not execute any migration SQL against any database.
- Does not apply XOS 2.7C
  (`20260829130000_xos_2_7c_test_order_hygiene.sql`), which remains
  merged to `main` but **not applied** to production.
- Does not classify any order.
- Does not touch PayFast.
- Does not change any frontend or backend runtime behavior — every
  change in this PR is either a migration file (source-history only) or
  a documentation/comment/test-path update.

## Expected `supabase migration list --linked` state after this PR

| Version | Expected state | Why |
|---|---|---|
| `20260828090000` | local + remote | Storefront Commerce, unchanged |
| `20260828090001` | local only | Snapshot Lifecycle SQL already live; ledger repair deferred |
| `20260829130000` | local only | XOS 2.7C — genuinely not yet applied |
| `202608300001` | matched (may display split) | Historical 12-digit version; CLI display artifact only |
| `20260830160000` | local + remote | Recovered, matches ledger |
| `20260830170000` | local only | SQL already live, ledger repair deferred |
| `20260831140000` | local only | SQL already live, ledger repair deferred |
| `20260831150000` | local only | SQL already live, ledger repair deferred |

Any other anomaly encountered should be reported separately, not
silently resolved.
