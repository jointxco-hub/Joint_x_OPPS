# OPPS-106 — unresolved QR checkout / manual-payment policy

**Status:** staging implementation and operator review protocol; NOT production release approval.

## Operational invariant

A QR code expiring **does not** mean its PayFast checkout is cancelled. A scanner may have opened the hosted payment page before the QR expired, and the verified PayFast ITN may arrive later. Counter staff must not confirm a Cash/Card receipt against the same order until the original hosted checkout has been reconciled. Browser return URLs, client screenshots and absent notifications are not payment proofs.

## What was built

1. SQL-level Counter guard: `public.record_quick_solution_counter_payment` serializes through `commerce.service_orders FOR UPDATE` and refuses a manual payment if there is an active QR, any started QR checkout, or a pending PayFast intent. This protects across devices even if the UI is bypassed.
2. Staff-only read-only `public.qs_opps106_list_qr_checkout_reviews(50)` RPC returns unresolved started checkouts. Requires authenticated OPPS staff and Café operations management. Anonymous calls have no EXECUTE privilege. Never exposes secrets, customer PII or a payment URL.
3. Staging `CafeQrSandbox` shows a **Refresh unresolved checkouts** button with only order number, amount, QR status, intent status and checkout time.
4. The queue never marks orders paid/unpaid, releases holds, or initiates a checkout.
5. An isolated two-session PostgreSQL CI job exercises the actual Counter RPC for (a) QR/Manual race and (b) two competing manual devices; verifies one receipt, idempotent retry, and hold behavior for a started expired checkout.

## Operator protocol: no automatic release

- First check the canonical Café order/payment ledger: if there is a completed receipt, no further payment is allowed.
- Review the canonical settled QR request and signed PayFast ITN, and compare the PayFast merchant payment ID and amount. If the status is settled, treat it as paid.
- If unsettled but PayFast hosted checkout was started, compare against merchant/provider records under an authorized staff review workflow. Absence of ITN alone must **not** be treated as no capture.
- If the gateway has a confirmed capture that has not projected into Café, use the established exception/reconciliation process. Do not insert a manually fabricated receipt or remove the QR record.
- If the provider confirms the transaction cannot subsequently settle (including a documented terminal status and reconciliation process), record the proof and the operator/reviewer in an auditable release procedure. Such a release procedure is **not implemented** here.
- If the provider outcome is unavailable or uncertain, leave the hold in place and escalate. Never automatically clear after 2 minutes, 1 hour, or any other timer.
- Never re-charge the same order to test this protocol.

## Current staging unresolved example

Read-only query on 18 Nov 2026 identified **QS-261116-5F45**: QR status active, checkout intent pending, original Café order unpaid; checkout began 16 Nov 2026. This is **review needed**, NOT evidence of lost payment or authorization to charge manually. No mutation to this order was made.

## Remaining release gates

- Operator review and audit design for safely closing abandoned intents, including confirmed no-capture evidence and late ITN handling.
- Production-safe provider-attested gateway environment for both sandbox and live paths; staging-only inferred canary proof must not be deployed as a generic live resolver.
- iMin D4 physical receipt printing and Next Sale.
- Existing five unrelated Café test failures.
- Release approval and QR issuance controls. Both issuance switches remain OFF.

## 18 November — review evidence implementation (staging only)

An append-only `qr_payments.checkout_review_events` table now records `actor_user_id`, event type, provider reference, factual note, idempotency key and timestamp. RLS is enabled; direct anonymous/authenticated access is revoked. Only a signed-in OPPS staff member with `cafe.operations.manage` can write or read through `qs_opps106_log_qr_checkout_review` and `qs_opps106_list_qr_checkout_review_events`.

- Available findings: opened case, provider-reported no capture, provider-reported capture, escalated, independent second review.
- A second review requires the same provider reference and a different actor from a prior no-capture report.
- The authorized staff UI provides a review form, history, reviewer identity and explicit **no payment release** label.
- A finding or two-person review is **not backend-attested provider proof** and cannot cancel a pending PayFast intent, clear a Cash/Card hold, issue another QR, or mark an order paid. The release action is deliberately not implemented until a secure provider-verification and operator-approved reconciliation is designed and tested.
- No review evidence was invented for `QS-261116-5F45`; it remains unresolved and unpaid pending actual provider evidence.


## 18 November — immutable staff review state (staging)

Applied `opps106_staging_qr_review_status_failclosed`, source `supabase/staging-only/20261118_opps106_qr_review_status_failclosed.sql`.

- Added `qr_payments.qs106_deny_review_event_mutation` trigger. Existing `qr_payments.checkout_review_events` entries cannot be updated or deleted by ordinary DML; new records remain append-only.
- Added staff-authorized, read-only `public.qs_opps106_get_qr_checkout_review_status` RPC. Returns a conservative state: awaiting provider verification, escalated, provider capture reported, first review recorded, two independent staff reports recorded, or payment already recorded.
- Even when independent staff reports exist, response explicitly states `cashCardHoldReleased=false` and `gatewayNoCaptureAttested=false`. A staff-typed reference cannot count as an authenticated PayFast provider response.
- UI under the existing staging `CafeQrSandbox` review panel displays status, event count and independent-review status while spelling out that the Cash/Card hold remains in force.
- CI guard `tests/issue-106-review-status-failclosed.test.mjs` verifies append-only behavior, staff authorization and no released-payments side effects.
- **Provider confirmation for no-capture is not implemented as an API**. Official PayFast `/eng/query/validate` validates an incoming ITN payload; it is NOT a separate negative-payment lookup. Authorized operators must investigate in PayFast Transaction History/support. Do not treat absence of an ITN or a staff statement alone as terminal no-capture.
- No new checkout, payment, review event or release was fabricated; original unresolved order remains unpaid with Cash/Card hold. QR issuance controls remain OFF.
