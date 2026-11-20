# Issue #106 — 9 November 2026 collision / lock-order hardening

**Branch:** `feature/106-cafe-visibility-qr`
**Deployment:** none. Production and staging unchanged.

## Work performed
- Fixed the SQL syntax of the private QR schema draft (`DO $$ ... END $$;`). The schema is still a draft pending disposable PostgreSQL execution.
- Hardened `pgQrWebhookStorage.quarantineVerifiedCapture`: per-provider transaction advisory lock, check existing references across QR requests, matched exceptions and unmatched captures, and require an exact identity-and-amount match for retries. A conflicting prior reference or a failed conflict upsert now rolls back and returns `persisted:false`, so the QR webhook coordinator returns a retry rather than falsely acknowledging money.
- Updated the QR webhook coordinator regression suite, including two new cases for collision and an unsuccessful insert. **13/13 isolated mock PostgreSQL tests passed** against the committed branch code.
- Inspected the currently deployed `public.apply_invoice_payfast_payment` implementation (read-only). It delegates linked Café invoices to `commerce.qs_apply_invoice_payfast_payment`, which can use a different lock order. Both the staff QR invoice payable resolver and the trusted webhook settlement payable resolver now mark invoices linked to a Café service order as ineligible. **8/8 isolated mocked invoice resolver tests passed.**
- Read-only production push inventory confirms `send-push-notification` is deployed with `verify_jwt=true`. This does not authorize user-selected recipient email: handler code still trusts `user_email` from the caller. Event-driven invoice and quote push delivery must enforce server-owned recipients and tenant permissions before release; tracked separately in [issue #107](https://github.com/jointxco-hub/Joint_x_OPPS/issues/107).

## Important limits
- These are mocked code-level checks, **not** real PostgreSQL concurrency tests. The workspace has no PostgreSQL binaries or local PGlite.
- The private QR schema has not been applied even to staging. The trusted service-role/RLS access model is untested.
- No actual PayFast QR request has been signed or paid in sandbox; no QR webhook endpoint is deployed.
- Cross-flow PayFast receipt identity must be confirmed with real provider references and invoice ledger tests before enabling checkout.
- Linked Café invoices and all Café order QR settlements remain fail-closed until gateway intent correlation, payment projection and lock ordering are verified under real transactions.
- Verify concurrent double notifications and provider ref races with real PostgreSQL sessions, including transaction ordering of both the canonical payment writer and QR ledger.

## Next release gate
Run the private SQL on a **disposable** PostgreSQL database, run concurrent request/settlement transactions, then implement a sandbox-only QR checkout signer/notification entrypoint and verify actual provider validation, duplicate ITN replay, stale QR captures and finance exceptions. Never route QR payloads into the existing shared production `payfast-notify` fallback.
