# Issue #107 Notification Outbox — Implementation Gate (9 November 2026)

**Feature branch only. Not deployed.**

## Implemented
- `docs/ISSUE_107_PRIVATE_NOTIFICATION_OUTBOX_DRAFT.sql`: a private `opps_private` schema with stable event keys, recipient delivery rows, tenant-consistent foreign keys, retry state, attempts, lease tokens and scheduled next attempts. Public/anon/authenticated roles are not granted direct access; trusted service role only. **Not executed in PostgreSQL.**
- `src/server/notifications/notificationOutbox.js`: trusted server enqueues from an authoritative event and fans out to active tenant memberships **inside one DB transaction**; duplicate event/recipient keys do not reinsert notifications. Invoice and quote events are conservatively sent to owner/admin memberships; inventory may include operational staff. Actual capability-based recipient filtering needs review.
- `src/server/notifications/notificationDeliveryLease.js`: independent worker-side claim with `FOR UPDATE SKIP LOCKED`, claim token and 60-second lease. Failed attempts have increasing retry delays; a stale claim cannot mark the row sent. This component **does not invoke web push**.
- `tests/issue-107-notification-outbox.test.mjs` and `tests/issue-107-notification-delivery-lease.test.mjs`: 12 Node tests executed locally with fake SQL responses, all passed. These are not actual Postgres concurrency tests.

## Verified schema context
Read-only staging schema inspection confirmed `tenants(id,status)`, `tenant_memberships(tenant_id,auth_user_id,status,tenant_role)`, `opps_invoice_activity(id,tenant_id,activity_type)`, `opps_quotes(id,tenant_id,status)`, and email-based `push_subscriptions`.

## Release blockers
1. **No real PostgreSQL test has yet run.** Apply draft to disposable DB, verify service-role privileges and two workers claiming simultaneously, row-lease expiration and replay behavior.
2. No quote/invoice database writers have yet been wired to enqueue committed transition events. This must happen in the same canonical transaction or via a guaranteed catch-up reconciliation job; do not rely on browser mount or best-effort network calls.
3. Push subscriptions currently use `user_email`, while delivery rows use `recipient_auth_user_id`. Add a secure migration to user-ID-based subscriptions, including tenant isolation and opt-in, and filter unsubscribed devices.
4. A real authorized push dispatcher is not wired. Audit the existing `send-push-notification` endpoint, which currently trusts recipient email in request body; do not let browsers select arbitrary recipients. Use only server-owned outbox messages and scoped subscriptions.
5. A provider send may succeed just before a worker crashes without marking sent, causing at-least-once redelivery. Use event-ID notification tags and client-side collapse; do not promise exactly-once OS delivery without provider acknowledgement.
6. Ensure duplicate suppression, retry max-attempt dead-letter behavior and preferences are validated end-to-end before shipping.
7. Notification changes must not be coupled to QR PayFast deployment. Existing production and staging remain unchanged.

## Issue #106 payment gate unchanged
Disposable PostgreSQL is unavailable in the current workspace (no `psql`, `postgres` or Docker). The QR private SQL/transaction tests and actual PayFast sandbox confirmation are still outstanding. Do not enable QR checkout or rewire the shared webhook until both pass.
