# Issue #107 — Audit-driven notifications development checkpoint
Date: 9 November 2026
Branch: `feature/106-cafe-visibility-qr`
Deployment: **NONE** (no production or staging writes).

## Implemented on branch
- `src/server/notifications/notificationEventCollector.js`: reads committed `public.opps_invoice_activity` and `public.opps_quote_events`, recognizes invoice approval/full payment and quote sent/accepted/declined, and enqueues stable event IDs. A partial invoice payment is deliberately not reported as a fully paid invoice. Uses timestamp + UUID cursor and fail-closed replay behavior.
- `src/server/notifications/notificationCollectorRunner.js`: persisted checkpoint lock, `FOR UPDATE SKIP LOCKED`, advance cursor only after the outbox enqueues successfully. If the checkpoint is unset, returns `needs_bootstrap` without enqueuing historic data. An operator must explicitly initialize a go-live watermark; otherwise old quotes/invoices would create notification floods.
- `src/server/notifications/notificationTargets.js`: private lookup of push subscriptions by **server-trusted auth.users identity + active tenant membership**, using the current email-based subscription table for compatibility. Checks tenant-scoped notification preferences; no caller-supplied email.
- `src/server/notifications/notificationPushDispatcher.js`: claims a delivery, loads the matching tenant event, resolves user devices, sends a generic PII-free push payload with stable event tag, acknowledges only after sends succeed. Fails and retries if delivery is interrupted; cancels if there are no devices. No actual push sender is wired.
- `src/server/notifications/notificationDeliveryLease.js`: added lease-owner cancellation for missing device and corrected UUID validation.
- `src/server/notifications/notificationOutbox.js`: corrected UUID validation.
- `docs/ISSUE_107_PRIVATE_NOTIFICATION_OUTBOX_DRAFT.sql`: added private durable collector checkpoint with strict RLS and trusted backend privileges. Still a **draft** and not executed.

## Verification performed
- **37/37** current-branch JavaScript test cases in six notification suites passed against exact GitHub branch source with mocked SQL and mocked push. These were executed using a JavaScript test/assert harness, not Node CI and not a real database.
- The test suite caught malformed UUID patterns in early code; these were corrected and tests rerun.
- Read-only staging introspection confirmed the existing invoice/quote activity tables and current push subscription tenant/email fields.
- Read-only inspection of existing quote RPCs confirmed that `mark_quote_sent` and `accept_public_quote` create durable `opps_quote_events` records.

## Important rollout gates
1. **No deployment until** private SQL, FORCE RLS grants, concurrent collectors/leases and cursor handling pass on disposable PostgreSQL. Source code does not yet prove real DB integration.
2. At activation, set a deliberate collector start watermark to avoid generating alerts for older business events. Do not auto-backfill historic invoices/quotes into system notifications. Example for a reviewed, already-installed private schema (operator-only, not executed):

   ```sql
   insert into opps_private.notification_collectors
      (name,cursor_created_at,cursor_id)
   values ('opps_business_events',clock_timestamp(),
           'ffffffff-ffff-4fff-bfff-ffffffffffff'::uuid)
   on conflict (name) do update
      set cursor_created_at=excluded.cursor_created_at,
          cursor_id=excluded.cursor_id
   where opps_private.notification_collectors.cursor_created_at is null
     and opps_private.notification_collectors.cursor_id is null;
   ```

3. Current `push_subscriptions` stores one globally unique `endpoint` and registration chooses the first active membership; switching workspaces and multi-tenant device subscriptions require a separate audited migration.
4. The current deployed push Edge Function accepts a caller-supplied recipient email; **do not reuse this as an unrestricted sender.** Build an authenticated, server-only dispatch wrapper around the outbox and VAPID provider.
5. The new sender code is not an active cron job, Edge Function or OPPS UI feature. Add scheduling/monitoring, real delivery acknowledgement, dead-letter handling and permissions-based recipients before enabling.
6. Unsent push due to absent subscriptions is cancelled in this initial model and may warrant an in-app durable notification entry later.
7. The current branch also contains Issue #106 QR changes. Keep deployment/merge plans separate; QR payments must not be enabled as a side effect of notifications.

## Issue #106
The PostgreSQL QR transactional gate and authentic PayFast sandbox capture are still outstanding. Production and staging are unchanged.
