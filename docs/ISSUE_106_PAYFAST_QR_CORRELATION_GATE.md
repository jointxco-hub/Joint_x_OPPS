# Issue #106 — PayFast QR correlation integration checkpoint (9 Nov 2026)

**Committed components**
- `src/server/cafeQr/qrPayfastCorrelation.js`: server-only request field construction, raw PayFast validation, and private-record correlation.
- `tests/issue-106-payfast-qr-correlation.test.mjs`: eight grouped Node regression cases.

## Verified production routing (read-only inspection)
Production `payfast-notify` v62 validates a raw notification by posting it to `/eng/query/validate`, checks `PAYFAST_MERCHANT_ID`, then dispatches `custom_str2='invoice'` or `custom_str2='quick_solution'`; all other notifications are treated as X LAB order payments. **A QR notification with marker `jointx_qr_v1` is NOT currently routed** and must not be sent to that live endpoint before a new, validated branch is implemented. No function has been redeployed.

## Proposed QR-only correlation contract
The checkout signer must set the following fields from a **saved and authorized server-side** request, not browser input:

| PayFast field | Value |
| --- | --- |
| `m_payment_id` | `JXQR-<request UUID>` |
| `custom_str1` | canonical target UUID |
| `custom_str2` | `jointx_qr_v1` |
| `custom_str3` | request UUID |
| `custom_str4` | `opps_invoice` or `cafe_order` |
| `custom_str5` | canonical tenant UUID |
| `amount` | positive integer cents converted to a 2-decimal ZAR string **by the server** |

The QR ITN verifier rejects:
- malformed or oversized encoded forms and duplicate keys;
- any marker other than `jointx_qr_v1` (preserves the legacy routes);
- unexpected merchant ID, missing signature/provider payment ID or non-`COMPLETE` notification;
- unmatched reference/target/tenant/type format;
- invalid or non-cent ZAR amounts;
- PayFast remote validation returning `INVALID`, or unavailable validation.

On a successful PayFast remote `VALID` response, a separate function compares the verified request ID, target, tenant, type and amount with a request fetched from **private server storage**. The module intentionally does **not** store receipts or trust browser-provided `verified:true` objects.

**Validation caveat:** `/eng/query/validate` reuses the deployed shared handler's existing PayFast validation approach. Actual merchant/signature requirements must still be end-to-end tested with the provider in sandbox. No sandbox transaction was initiated for this work.

## Hard release blockers
1. Wire a **new QR-only route after existing PayFast validation and merchant checks**, and before the legacy X LAB fallback. Keep old invoice/Café/order code and deployed versions unchanged until staging tests pass.
2. Implement durable `getRequest` and canonical receipt settlement in the same transaction or a proven idempotent reconciliation design. For the Café order path, adapt the full-order PayFast initiation/receipt mechanism so an already-paid/partial balance cannot be double charged.
3. QR expiry is an app-side presentation/settlement limit, **not cancellation of a previously opened PayFast checkout**. Captured money from expired URLs must be audited and reconciled/refunded rather than dropped.
4. Never return HTTP 200 on a verified `COMPLETE` capture that has not been durably recorded or durably quarantined. PayFast validation/network failures need retry behavior; permanent business exceptions need durable finance visibility.
5. Create a payment initiation signer matching this correlation contract and test PayFast's actual signature format without compromising the existing checkout functions.
6. Run the SQL schema smoke test and concurrent ledger tests on disposable PostgreSQL, then full sandbox ITN replay, merchant mismatch, amount mismatch, expired URL and double-capture scenarios.

## Verification
- Eight Node.js tests passed locally against the standalone module with a **mocked** PayFast validation endpoint.
- The same code and test bodies were committed to the feature branch; no staging/production writes, webhook deployment, or actual PayFast interaction occurred.
