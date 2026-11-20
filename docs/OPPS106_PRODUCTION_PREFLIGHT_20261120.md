# OPPS-106 — production preflight and controlled release plan
**20 November 2026. Status: NO-GO — preparation only. No migrations, live callbacks, credentials or payment controls deployed to production.**

## 1. Read-only source-of-truth inventory
Verified against the two connected projects using `scripts/opps106-production-readiness.sql`, which cannot write any data.

| Requirement | Production `slhcvyeuqsduaglddqdb` | Staging `tijiamrfnxrbitafiflj` |
|---|---|---|
| PostgreSQL | 17.6 | 17.6 |
| OPPS-106 migrations in Supabase history (name prefix) | **0** | **24** |
| Café orders / receipts + Finance | Existing | Existing |
| `qr_payments.payment_requests`, `issuance_controls`, `payment_exceptions` | **Missing** | Present |
| `qs_opps106_issue_counter_qr` | Missing | Present |
| Live gateway policy + live issue/settle RPCs | Missing | Missing |
| Approval to enable live QR | **NO** | **NO** |

The staging source contains historical tests/settled transactions, which **must not be copied** to production. The repository and staging migration history differ in naming; migration planning must reconcile applied *definitions* and dependency order, not assume matching filenames prove equivalence.

## 2. Required migration inventory and dependency order
These are **candidate sources for review**, not an executable production migration bundle.

**Baseline that production lacks:** inspect each `supabase/migrations/` SQL file in dependency order, including:
- `20261114224000_opps106_payfast_intent_binding.sql` and `20261114225000_opps106_payfast_intent_replay.sql` — private PayFast intent verification.
- `20261115143000_opps106_qr_private_payment_requests.sql` and `20261115144500_opps106_qr_unmatched_capture_quarantine.sql` — private QR tables and exception logging.
- `20261115150500_opps106_counter_qr_preflight.sql`, `20261115163500_opps106_counter_qr_issuance_disabled.sql`, `20261115165200_opps106_scanned_qr_readonly_status.sql` — staff authorization and disabled issuance.
- `20261115171500_opps106_qr_scan_payfast_intent.sql`, `20261115173000_opps106_qr_verified_settlement.sql`, `20261115174500_opps106_qr_scanner_intent_reuse.sql`, `20261115181500_opps106_qr_noncomplete_events.sql`, `20261115193000_opps106_single_order_qa_gate.sql` — intent/settlement, late events and single-order QA guard.
- Review whether `20261114223000_opps106_finance_paid_scope_guard.sql` and `20261114223600_opps106_paid_invoice_order_projection.sql` are already present in production under other migration names, before changing existing Finance behavior.

**Staging hotfixes requiring production-shape equivalents:** reconcile code and security tests for `supabase/staging-only/` checkout identity, immutable gateway provenance, cross-device Cash/Card guard, verified capture quarantine, staff-only review, and Finance receipts. **Do not** copy staging-only settlement SQL: it explicitly labels captures as sandbox.

**Future live-specific candidate:** review `supabase/production-candidate/opps106_live_gateway_rpcs_REVIEW_ONLY.sql` and `opps106_verified_finance_projector_REVIEW_ONLY.sql`. Both depend on the baseline QR schema and are currently inoperative without it.

## 3. Security gates before preparing a production migration
- Obtain a verified pre-change production database backup, reproducible restore instructions, and operator assignment. Do not treat the earlier October backup as a current November pre-release snapshot.
- Compare the **actual** production definitions of `commerce.qs_apply_payfast_payment`, `qs_project_manual_receipt`, `_qs_sync_opps_payment_ledger` and invoice projection against staging. Preserve unrelated fixes and tenant/role policies.
- Validate all `SECURITY DEFINER` functions: restricted `EXECUTE` grants, explicit service-role/staff guard, safe `search_path`, no browser access to service keys. Confirm private tables have RLS and no public grants.
- Test every migration against a fresh disposable **production-shaped** database, not just the simplified unit-test fixture. Validate older Café/OPPS invoice workflows and rollback/restore.
- Ensure `qr_payments.issuance_controls` and `live_gateway_policy` are **OFF** after each migration, and no test order is enabled. Use independent read-only rechecks before proceeding.
- Confirm one canonical receipt and Finance row, sandbox/test exclusion, live-revenue inclusion, independent staff QA flag preservation, failed projection review, duplicate/replayed captures, unrelated PayFast callbacks and Cash/Card races.

## 4. Independent live PayFast controls
Separate **issuance** from **callback processing**:
- `OPPS106_LIVE_GATEWAY_APPROVED` gates new live issuance.
- `OPPS106_LIVE_CALLBACK_ENABLED` gates validated notifications for checkouts already initiated.
- `OPPS106_QR_MODE=live`, `PAYFAST_SANDBOX=false`, live merchant/key/passphrase, independent merchant-ID attestation, proper HTTPS callback domain and verified ingress/IP source are mandatory for live callback processing.
- Pausing issuance **must not** disable delayed verified ITNs. Keep callback authorized until all earlier captures are reconciled; never interpret a disabled issuer switch as cancelling PayFast.
- Credential provisioning and endpoint registration require named human approval. Never print or commit secrets or set live flags automatically.
- Validate signed ITN amount, merchant, checkout identity, source/IP and PayFast remote `VALID`, then replay/mismatch/late capture. Official reference: https://developers.payfast.co.za/docs/itn-instant-transaction-notification/

## 5. UI and physical acceptance
A Vercel preview for commit `4b5b272` was marked READY on 20 November; the newest readiness script commit had not yet reached READY when checked. A READY build is **not** evidence of passing the browser workflow. Review staff authorization, reconciliation packet, return/cancel pages, copy buttons, QR status, and Next Sale on the actual preview.

The iMin D4 remains unavailable. Physical 58/80 mm receipt printing and Next Sale acceptance remain unverified and are a **live rollout blocker**.

## 6. Activation is a separate approval
After approved base schema is installed with controls OFF and independently inspected:
1. Deploy the dedicated **live** notification route in fail-closed mode, with signed ITN/IP/merchant validation and **no issuer enabled**. Preserve the sandbox endpoints separately.
2. Deploy the live scanner in disabled mode; verify it rejects both unauthorised clients and inactive orders.
3. Complete provider-specific integration and operator review of the actual PayFast merchant dashboard, notify URL, replay, terminal outcomes and Finance.
4. Approve one bounded real-money live test with explicit transaction amount, merchant, order and expected fees; record refund/reconciliation procedure. The sandbox cannot prove real live settlement.
5. Obtain separate finance, security and operational sign-off for any rollout beyond the test. Explicitly configure a time-bound/single-order issuer allowlist; no global enable by default.

## 7. No-go / rollback
Any incorrect amount, merchant, environment, duplicate receipt, unverified callback source, Finance QA classification, or incompatible production schema is **NO-GO**. Stop *new* issuance; **keep a secured callback available to receive and quarantine late PayFast notifications**. Reconcile every started hosted checkout and confirmed provider capture before retiring anything. Never clear Cash/Card holds solely because a QR or issuer was disabled. Rollbacks after any actual money movement require data reconciliation, not dropping QR tables.

**Current decision:** production QR baseline absent, live gateway and return origin unverified, provider live integration untested, latest browser workflow not physically accepted, iMin receipt untested. **Release authorization: NOT GRANTED.**

## 20 November follow-up — Phase A schema-only candidate PASSED clean install

Prepared `supabase/production-candidate/opps106_private_qr_base_PHASE_A_REVIEW_ONLY.sql`. This is a **review-only** composed candidate from the inspected QR private table, unmatched capture, issuance-controls, checkout-intent and noncomplete-event source migrations. It deliberately **excludes all issuer, scan, receipt, settlement and PayFast functions** as well as the old issuer's hardcoded staging URL.

- Installs five private RLS-protected tables: `payment_requests`, `payment_exceptions`, `unmatched_captures`, `issuance_controls`, `noncomplete_events`.
- Starts both `cafe_order` and `opps_invoice` issuance controls **disabled**, with no allowed order or expiry. The future single-order `qr_issuance_requires_scope` constraint is present.
- Adds server-bound checkout merchant/environment/reference/contract columns and verified gateway-environment evidence constraints. It does **not** backfill or infer any payment environment.
- Requires existing `public.tenants` and `commerce.service_order_payments`, and refuses to run if the QR schema already exists (no hidden drift or accidental overwrite).
- Does not install any public QR payment RPC, deploy a callback, send a provider request, mutate existing Finance records or change old Café orders.

New GitHub Actions `private-qr-base` job uses a **fresh disposable PostgreSQL 16 database** and synthetic public tenant/commerce payment dependencies, not a live Supabase database. It applies Phase A, asserts both controls off, no public payment RPC, all five tables under RLS, private role grants and provenance fields, then checks that a duplicate run fails closed. **Run #44740530434: private-qr-base job passed.** This test proves clean schema compatibility with the mocked dependencies, **not** that production's complete app, existing policies or live credentials are ready.

### Production function drift that must be reviewed before Phase B

Read-only `pg_get_functiondef` hashes from production vs staging on 20 November 2026:

| Existing function | Production MD5 | Staging MD5 | Decision |
|---|---|---|---|
| `commerce.qs_apply_payfast_payment` | `9a821331d43afcd04304afd758de163d` | same | Preserve |
| `commerce.qs_project_invoice_receipts` | `bc3cc9f496f132462aabb1dace20db2f` | same | Preserve |
| `commerce.qs_project_manual_receipt` | `fc235c5e150505b93b3378c05366dc5d` | `6b88dc9a40cb67a9259d05403281eef0` | Reconcile verified QR classification in separate Phase B |
| `commerce._qs_sync_opps_payment_ledger` | `f5b31fb5508286d6e4cc44bb06f8f9c6` | `4f488b47983f9b12170cd3135ac125f6` | Reconcile linked OPPS/QA behavior |
| `public.enforce_workspace_order_update_scope` | `cc2acde8cb7fb58f2dfbcfb07a813611` | `3fb458ca33a6d6140c13609b20ee1645` | Preserve original role controls; audit narrow change separately |

**Important:** Existing `20261115163500_opps106_counter_qr_issuance_disabled.sql` and `20261115193000_opps106_single_order_qa_gate.sql` each embed a staging Supabase scan endpoint. Do **not** blindly promote those issuing functions. A production-safe issuer must use an explicitly reviewed return/callback domain, tenant-scoped authorization and dedicated validated live backend, and must still be disabled until acceptance.

**Next**: separately test the actual production-shaped tenant/Café/OPPS function definitions in an isolated snapshot before constructing Phase B. Also ensure an up-to-date independent backup and successful restoration rehearsal before approved production Phase A installation. This new candidate is **NOT APPLIED** to production or staging.

## Phase B1 — production-derived Counter/QR conflict controls (review only)

Source: `supabase/production-candidate/opps106_qr_operations_PHASE_B1_REVIEW_ONLY.sql`, derived from the **actual production** `public.record_quick_solution_counter_payment(uuid,text,text)` definition (MD5 `af0dc64d91f977861a0fa0142bcd5a17` on 20 November). The migration first checks the existing function's exact hash and requires Phase A's private QR tables and **all issuer switches OFF**. Any drift causes an explicit abort before function replacement.

Phase B1 intentionally installs:
- An authenticated, tenant-member/capability-checked, **read-only** `qs_opps106_counter_qr_preflight` (never authorizes a charge by itself).
- A narrow QR/PayFast conflict check in the **existing production Counter cash/card function**, after locking the canonical order and before a new manual payment is inserted. It blocks active QR, any previously started hosted QR checkout (including expired), and pending canonical PayFast intents; existing ordinary Cash/Card and idempotent retry logic remain the production version.
- A stub `qs_opps106_issue_counter_qr` that always returns `QR_ISSUANCE_DISABLED`. It has **no staging/live URL**, cannot initiate PayFast or mint QR records, and does not change either issuer switch.

It does **not** yet install a live/sandbox scan, verified settlement, Finance projection, exceptional-capture handler or hold-release action. Those are separate, later Phase B2/payment acceptance gates. No production migration is authorized merely because Phase B1's disposable checks pass.

The `private-qr-base` CI job now first applies Phase A to a clean disposable PostgreSQL 16 database, then creates a synthetic production-shaped Café/Counter fixture and replays the exact production manual-payment function snapshot before applying Phase B1. Tests cover an eligible Counter preflight, active QR block, expired-after-checkout block, pending PayFast block, ordinary cash payment and idempotent repeat, as well as issuer always OFF.

**Do not apply Phase B1 without an independently confirmed current production function hash and backup.** A new production deployment may change the hash; in that case re-review against the latest function instead of overriding.

## 20 November follow-up — Phase B2 verified callback/settlement integration foundation

**Implementation status:** review-only SQL and disposable tests on feature branch. **Nothing applied to either live or staging Supabase.**

- Added `supabase/production-candidate/opps106_verified_callback_foundation_PHASE_B2_REVIEW_ONLY.sql`, intentionally after Phase A and B1. Preflight requires the private QR schema, existing preflight/disabled issuer, and both issuance switches OFF; aborts if a live settlement RPC is already installed.
- Extends the Phase A `qr_payments.payment_exceptions.reason` constraint to the two verified-provenance reasons expected by the payment callback: `QR_CHECKOUT_PROVENANCE_REVIEW` and `GATEWAY_PROVENANCE_MISMATCH`. This fixes a real incompatibility between the pristine Phase A schema and the existing live candidate, which simplified older fixtures failed to detect.
- Adds `qs_opps106_get_counter_qr_checkout_identity`, a service-role-only checkout identity lookup. It requires a started, bound original intent, exact `JXQR-<request uuid>` reference, server-issued merchant/environment and contract version; unbound legacy QR is rejected.
- Adds `qs_opps106_quarantine_verified_qr_capture` with canonical order→QR locks, strict input validation, idempotent exception/unmatched-capture storage and no payment or Finance mutation. **Caller is trusted backend only**; the Edge Function must establish source, signature, merchant and remote PayFast `VALID` independently, before invoking the RPC.
- A fresh disposable PostgreSQL 16 job now applies **Phase A → Phase B1 → Phase B2 foundation → separately proposed live gateway RPCs**. It checks legitimate simulated capture→one completed receipt and settled QR with `payfast_itn_validated_live` evidence, idempotent replay, second provider payment ID quarantined, mismatches quarantined, legacy provenance denied and new QR issuance still OFF. A synthetic canonical payment projector is used for this test; it does **not** demonstrate a real PayFast callback or all production Finance projections.
- **GitHub run #44746214191: all four CI jobs SUCCESS**, including the new complete private-base stack, the existing two-session payment race suite, QR security, and OPPS build.

**Remaining launch blockers:** integrate the verified live notifier with production-approved merchant credentials and ingress/IP verification, review the actual production Finance and OPPS functions for installation drift, validate production-shaped invoice/Finance reporting, obtain fresh production backup/restore proof, and complete Vercel browser and physical iMin D4 acceptance. The live SQL candidate and all Phase A/B1/B2 migrations remain **unapplied**. PR stays DRAFT; live QR issuance remains disabled.

## 20 November — Phase B3 production Finance / linked OPPS function reconciliation

**Candidate built, NOT applied**: `supabase/production-candidate/opps106_reconciled_finance_PHASE_B3_REVIEW_ONLY.sql`.

Read-only source comparison found these production/staging differences:
- `commerce.qs_project_manual_receipt(uuid)`: production MD5 `fc235c5e150505b93b3378c05366dc5d`; staging differs. Production preserves legacy receipt identity, amounts, invoice projection, and existing QA flags; the new candidate reuses the **original** production function and inserts a narrow QR evidence gate and post-insert verified payment-method/reference/classification update.
- `commerce._qs_sync_opps_payment_ledger(uuid,uuid)`: production MD5 `f5b31fb5508286d6e4cc44bb06f8f9c6`; new candidate retains the exact original flow and invokes a separate verified QR classification helper after normal handoff.
- `public.enforce_workspace_order_update_scope()`: production MD5 `cc2acde8cb7fb58f2dfbcfb07a813611`. The candidate checks that exact MD5 but **does not replace or broaden** the production workspace authorization trigger.
- Production's `trg_orders_payment_environment` is **BEFORE INSERT only** and derives an environment from storefront host. Existing trigger remains unchanged; a verified settled QR can later update its linked OPPS order environment via an internal helper, after checking exact tenant/order/receipt/provenance.

**Important additional production reconciliation discovered:** `commerce.qs_apply_payfast_payment` (unchanged between production and staging, MD5 `9a821331d43afcd04304afd758de163d`) **inserts a separate completed PayFast receipt and cancels the original pending QR payment intent**. The original mock incorrectly mutated pending into completed. The new Phase B3 candidate requires (a) exactly one settled, server-verified QR, (b) exactly one separate completed PayFast receipt with the provider transaction ID, (c) the original matching canceled pending intent with no provider ID, (d) matching tenant/order/amount, and (e) exact merchant, environment, reference and contract version. Unknown/unbound QR claims raise `QR_GATEWAY_ENVIRONMENT_REVIEW_REQUIRED` before creating Finance income.

New sandbox QR receipts are excluded from reports and marked test; verified live QR receipts are included by default without clearing existing staff-set `is_test` or `excluded_from_reports` flags. The helper is explicitly denied to `anon`/`authenticated`, and restricted to `service_role` for direct invocation. Existing manual cash/card and invoice projection code remains production-derived.

**Testing:** Original production functions were snapshotted as *synthetic-test code only* in `tests/fixtures/opps106-production-finance-function-snapshot.sql`. CI replays them on a disposable PostgreSQL fixture and checks the original hashes before applying Phase B3. Updated mock PayFast recorder now matches production by inserting a completed receipt separately and canceling the pending intent. Finance/OPPS regression tests validate verified live inclusion, sandbox exclusion, unbound QR rejection, duplicate/replay safeguards, preserved staff QA flags, separate receipt identity, and clearing Finance review only after settlement.

**Constraints:** The fixture does not replay every production trigger, data policy, existing invoice state or third-party payment event. It also does not verify live PayFast signature/source/remote `VALID` with real credentials. An independent, current production snapshot with restored-schema tests and explicit release sign-off are still required before any migration. Phase A/B1/B2/B3 and live settlement candidate remain uninstalled in Supabase production; QR issuance is OFF.
