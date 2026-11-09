# Issue #106 — deployed PayFast discovery (9 Nov 2026; read-only)

No Edge Function was deployed, no database migration applied, and no payment traffic was generated during this inspection. Sources were the connected Supabase project's **deployed** function contents, not assumptions from GitHub main.

## Function inventory

| | Staging `tijiamrfnxrbitafiflj` | Production `slhcvyeuqsduaglddqdb` |
| --- | --- | --- |
| `quick-solution-payfast` | v12, `verify_jwt=false` | v2, `verify_jwt=false` |
| `quick-solution-payfast-notify` | v8, `verify_jwt=false` | no separately listed deployment |
| `payfast-notify` | v31 | v62 |
| `init-payfast` | v29 | v83 |

**Production:** `quick-solution-payfast` requires server-side `qs_begin_quick_solution_payment` and uses `PAYFAST_NOTIFY_URL` (not a hardcoded dedicated Café notify URL). Production `payfast-notify` v62 contains a Quick Solution path selected by `custom_str2='quick_solution'`, reconciled through `qs_apply_quick_solution_payment`. These are **different naming/contracts** from staging's dedicated Café notifier, which calls `qs_apply_quick_solution_payfast_payment`. Check that production's `PAYFAST_NOTIFY_URL` points to the intended shared notifier, and confirm the applicable RPC exists before treating the path as proven.

**Staging:** `quick-solution-payfast` v12 builds its notify URL for `quick-solution-payfast-notify`; the dedicated notifier v8 calls `qs_apply_quick_solution_payfast_payment`, and uses `qs_record_quick_solution_payfast_noncomplete` for non-complete results. This is not proof that staging and production have identical ledger behavior.

**Invoice path:** the separate `init-payfast` function can initiate an invoice payment using `begin_invoice_payment` and server-derived balance. Invoice reconciliation on production's shared notifier calls `apply_invoice_payfast_payment` for `custom_str2='invoice'`. These RPCs are not a ready-made, expiring, tenant-authorized staff QR request lifecycle.

## What this changes for the MVP

- Reuse the live, verified PayFast validation path and canonical invoice/Café receipt writer appropriate to **each** target. Do not blindly redirect both workloads to one RPC.
- First confirm actual `PAYFAST_NOTIFY_URL` **destination** without printing secret values. A configured but wrong endpoint would result in accepted payment that is not reconciled in the expected ledger.
- Compare active database definitions and permissions for `qs_begin_quick_solution_payment`, `qs_apply_quick_solution_payment`, `qs_apply_quick_solution_payfast_payment`, `begin_invoice_payment`, and `apply_invoice_payfast_payment`. Keep production queries read-only.
- Verify signature, merchant ID and amount checks in the deployed notifier *as a complete path*, not by searching for one code keyword.
- Current initiation returns a PayFast checkout URL tied to a saved order/payment token; this is **not** automatically a short-lived, revocable QR request. Do not claim time-bounded security or amount-version locking exists until implemented.
- Added a **read-only UI presentation guard** (`src/features/cafeQr/paymentRequestView.js`) for a future server-issued request. It accepts only active, unexpired, positive integer-cent ZAR requests with an HTTPS PayFast `/eng/process` URL on a known host. This code cannot initiate, authorize or settle payments, and is **not wired into a screen**.
- Added Node regression tests in `tests/issue-106-qr-presentation.test.mjs`; execution and integration tests remain to be verified.

## Next bounded step

1. Verify which notification destination production uses and which corresponding RPCs exist with **read-only** SQL/metadata.
2. Implement and test a single authoritative server-side request identity, expiry/revocation, final outstanding-balance check and same-request retry. Cross-target invoice/Café reconciliation needs explicit separate adapters.
3. Only then wire a QR component to the counter payment surface, initially behind an explicit staging feature flag.
4. Validate callbacks, duplicate/late ITNs, amount changes, concurrent Cash/EFT, and iMin D4/customer phone scanning on staging before any production work.

## Read-only database function verification (9 Nov 2026)

A `pg_proc` metadata query on **both** projects confirmed the actual function names and execute permissions (no user/order/payment rows queried).

- **Production:** `qs_begin_quick_solution_payment(uuid,text)`, `qs_apply_quick_solution_payment(uuid,numeric,text,jsonb)`, `begin_invoice_payment(text)`, and `apply_invoice_payfast_payment(uuid,numeric,text,jsonb)` exist. All deny direct `anon` and `authenticated` EXECUTE. Production `qs_cafe_list_work_queue` does **not** exist.
- **Staging:** all four above exist, along with `qs_apply_quick_solution_payfast_payment(uuid,numeric,text,jsonb)` and `qs_record_quick_solution_payfast_noncomplete(uuid,text,jsonb)`, with direct `anon` and `authenticated` EXECUTE denied.
- **Important correction to earlier branch comments:** staging **already has** `qs_cafe_list_work_queue(text,integer)` at the time of this live check, with `authenticated` EXECUTE and no `anon` EXECUTE. Exact migration provenance, body parity and staff end-to-end behaviour remain unverified; do not reapply blindly.
- Production's missing dedicated Café notification function is consistent with its shared `payfast-notify` route and available `qs_apply_quick_solution_payment` RPC, but **configured notify destination is still unverified**.

No deployment or data mutation was performed.
