# Canonical Pricing Slice 01 — OPPS Invoice Pricing Normalization

## Status

**COMPLETE — production**

## Date

2026-09-30

## References

| | |
|---|---|
| Production migration | `20260929120000_opps_invoice_pricing_normalization` |
| Main commit (post fast-forward) | `20719f122ecaf30f65b9cc87ae53ddfa11d338a6` |
| Implementation commit | `5f42124` |
| Test-fix commit | `20719f1` |
| Production project | `slhcvyeuqsduaglddqdb` |
| Pre-apply function hash (`save_opps_invoice_with_items`, full-definition md5) | `e06411e53b8353963ded0e7771d62aa4` |
| Post-apply function hash | `61b9f2d7d0b921bfa9437a3ed5c38740` |

This is a completion record, not the full architecture — see
`docs/architecture/canonical-product-pricing-v1.md` for the reference
model this slice is the first proof point for.

## Background

Before this slice, `public.save_opps_invoice_with_items` already enforced
a ±R0.01 grand-total reconciliation with an audited override, but
persisted the invoice header's `subtotal`/`discount_total`/`tax_total`
and every line's `item_total` verbatim from client-submitted input, with
no server-side recomputation of those specific fields. `amount_paid`/
`balance_due` were already ledger-derived (the P1A fix — see
`docs/MANUAL_INVOICE_PAYMENT_RELEASE.md`); this slice extends the same
"never trust the client for money fields" treatment to the remaining
ones, using the same computation pattern `save_opps_quote_with_items`
already used for its own item totals.

The live production definition of this function was not represented in
this repository's tracked migration history at the time of this slice —
`origin/main`'s only prior redefinition
(`202608020001_invoice_item_atomic_persistence.sql`) predated the
P1A/tolerance/override logic actually live in production. This is the
same class of drift documented in
`docs/SHARED_SUPABASE_MIGRATION_RECONCILIATION_2026-09-01.md` and
`docs/OPPS_PERMISSION_MODEL_SOURCE_OF_TRUTH_RESTORATION_2026-09-27.md` —
not unique to pricing. The migration for this slice was therefore built
by capturing and hash-verifying the live `pg_get_functiondef` output
directly, not by diffing the tracked file.

## What changed

- OPPS invoice header `subtotal` is now recomputed server-side from
  billable items.
- `discount_total` is recomputed server-side.
- `tax_total` is recomputed server-side.
- Each invoice line's `item_total` is recomputed server-side, using the
  same calculation `save_opps_quote_with_items` already uses for its own
  item totals.
- Client-supplied `item_total` is no longer authoritative.
- The stated invoice `total` still uses the existing ±R0.01
  reconciliation rule — unchanged.
- Total-override behavior and the override reason/audit trail are
  unchanged.
- `amount_paid` and `balance_due` remain ledger-derived (P1A) —
  unchanged.
- Optimistic concurrency behavior (`p_expected_updated_at`/
  `p_expected_item_count`) is unchanged.
- Function signature is unchanged.
- `SECURITY DEFINER` behavior is unchanged.
- ACL is unchanged.
- No frontend deployment was required.

## Production validation

*Every step below was run directly against production by the engineer
operating the database (via Supabase Studio), from scripts prepared and
reviewed in-session; results were reported back and reviewed, not
executed against production by an automated agent.*

- Full production rollback rehearsal completed successfully inside an
  explicit `BEGIN...ROLLBACK` transaction, against the real database.
- The rehearsal's concurrency test (TEST 7) needed correction: its
  first version reused a captured `updated_at` value as a "stale"
  token, but Postgres's `now()` is transaction-stable — every
  statement inside one transaction sees the same timestamp, so a value
  captured earlier in the same rehearsal was never actually stale. The
  corrected version manufactures a deliberately different token (the
  real current `updated_at` minus one hour) instead, proving the same
  guard without depending on wall-clock time advancing mid-transaction.
- The rollback restored the function to its original, pre-rehearsal
  hash.
- Rehearsal tenant residue after rollback: 0.
- The live migration was applied directly, as the single migration SQL
  file, wrapped in its own `BEGIN`/`COMMIT` with a preflight guard that
  aborts the whole transaction if the live function's hash had drifted
  since it was last verified — not via a broad `supabase db push`,
  consistent with the practice already established in
  `docs/MANUAL_INVOICE_PAYMENT_RELEASE.md` ("Do NOT `supabase db
  push` … Apply the file(s) explicitly").
- Post-apply function hash verified (see table above).
- A rollback-safe smoke test, run inside its own `BEGIN...ROLLBACK`
  against the real, now-live function, passed all checks: correct
  total saves; a wrong client-supplied `item_total` is ignored and
  server-computed; header `subtotal`/`discount_total`/`tax_total`
  normalize server-side; a mismatched total is still rejected without
  an override; an approved override with a reason still works; ledger-
  derived `amount_paid`/`balance_due` remain correct; a valid
  concurrency token succeeds; a mismatched concurrency token is
  rejected.
- Smoke-test tenant residue after rollback: 0.
- Migration bookkeeping recorded: `20260929120000 /
  opps_invoice_pricing_normalization`.

## Why this matters architecturally

This slice establishes, with a real production example, the rule that
commercial document totals cannot rely on arbitrary client-computed
line or header values. Server-side normalization at the point a
mutating RPC commits a transaction is part of the canonical pricing
contract (see §8, "Server Authority Rule," in
`docs/architecture/canonical-product-pricing-v1.md`).

This does not make all invoice pricing canonical on its own — it
normalizes server authority specifically at the invoice commit boundary
(the header totals and line totals persisted by
`save_opps_invoice_with_items`), which is the concrete first proof
point for that broader rule, not its completion. Quotes
(`save_opps_quote_with_items`) were already a stronger example of this
pattern; invoice normalization is now aligned further toward it. It is
the first completed implementation slice of that broader architecture,
not a standalone fix.
