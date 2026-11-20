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
