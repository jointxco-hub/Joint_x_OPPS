# Issue #106 / November 9 — QR verified capture and notification reliability checkpoint

## Implemented on feature branch, not deployed

1. `src/server/cafeQr/applyQrInvoiceReceipt.js`: applies a verified, correlated invoice QR capture by calling existing `public.apply_invoice_payfast_payment` with **the same database connection/transaction** as the locked request. No separate Supabase network RPC. Rejects mismatched tenant, amount, request or ignored/rejected ledger results. Sanitizes away raw ITN.
2. `src/server/cafeQr/qrWebhookCoordinator.js`: PayFast verification precedes all request reads. Verified COMPLETE captures are only acknowledged if the canonical receipt commits, the existing settlement service commits a reconciliation exception, or an unmatched capture is durably quarantined. On DB failure, returns 503 rather than silently accepting an unrecorded payment.
3. `src/server/cafeQr/pgQrWebhookStorage.js`: trusted private Postgres storage lookup and verified-capture quarantine. Matched requests use payment exceptions, missing/mismatched request identities use unmatched capture storage with unique gateway references.
4. `docs/ISSUE_106_QR_PRIVATE_SCHEMA_DRAFT.sql`: adds `qr_payments.unmatched_captures` (no FK, retains verified orphan captures) and explicit trusted service-role grants. The SQL is still a **draft, not a deployed migration**.
5. `tests/issue-106-qr-webhook-coordinator.test.mjs`: covers successful receipt, merchant rejection, gateway outage, orphan capture, mismatch, retry and transaction-bound existing invoice ledger invocation. Eleven isolated groups passed using mocked PayFast and PostgreSQL.
6. Separately: `src/components/common/NotificationsPanel.jsx` no longer issues OS push alerts on passive inventory snapshot refetch; stock remains in the in-app bell. `tests/issue-107-stock-notification-regression.test.mjs` added and static regression checks passed. Full notification pipeline tracked in [Issue #107](https://github.com/jointxco-hub/Joint_x_OPPS/issues/107).

## Critical blockers: DO NOT deploy or turn on QR yet

- The private SQL draft has **not** run on a disposable PostgreSQL instance or passed concurrent transaction tests. Its RLS grants and service-role access need validation on real Postgres.
- No actual PayFast QR checkout signer or Edge Function entrypoint has been configured/deployed. The deployed shared notifier does not route `custom_str2=jointx_qr_v1` and must not receive QR traffic until a separately tested branch is in place.
- No PayFast sandbox payment, ITN replay, refund or late capture has been observed for this new QR flow.
- Real atomicity across invoice ledger and request state, especially concurrent cash/EFT, must be demonstrated. The receipt adapter relies on existing `apply_invoice_payfast_payment` and the same transaction; it is not a substitute for a full end-to-end test.
- Café counter-order settlement is still **quarantined** until its existing full-total PayFast intent and receipt writer are safely correlated to QR payment request identity; only OPPS invoices have a preliminary canonical receipt adapter.
- The proposed `quarantineVerifiedCapture` interface needs strict server-only invocation and permission checks. Do not grant private QR schema access to anon/authenticated or let callers pass arbitrary `verified:true`.
- The orphan capture table uses unique provider references. Before rollout, add integrity verification that duplicate provider reference retries match the originally persisted amount/request identity; do not treat a conflicting retry as benign.
- The existing OPPS push dispatcher should be authenticated and redesigned for tenant-scoped, idempotent invoice/quote events before being expanded. Avoid loading live secrets into source or browser bundles.

## Next testable milestone

Set up a disposable PostgreSQL 17/Supabase local project, apply the reviewed schema, exercise concurrent requests/receipts and forced DB failures. Only then expose an isolated staging QR checkout and ITN handler with sandbox credentials. Verify a payment updates precisely one canonical invoice ledger receipt and a settled QR request; exercise duplicate/expired/mismatched transactions and finance reconciliation.

**No production or staging deployment, payment, or schema write was performed in this session.**
