# Issue #106 — Server Work Queue RPC: review contract

Status: **design only; NOT DEPLOYED**. Do not wire the API to a UI or run against production/staging until a reviewed, timestamped Supabase migration and isolated authorization tests exist.

Endpoint requested by `src/api/cafeWorkQueue.js`:
`public.qs_cafe_list_work_queue(p_cursor text DEFAULT NULL, p_limit integer DEFAULT 25) RETURNS jsonb`.

## Staging schema verified (read-only, 5 Nov 2026)
`public.orders`: id, tenant_id, order_number, client_name, status, total_amount, updated_at.
`public.opps_invoices`: id, tenant_id, invoice_number, source_order_id, customer_name, status, total, balance_due, updated_at.
`commerce.service_orders.opps_order_id` links Café orders to OPPS orders.
Today's Counter Orders is a different RPC and must not be edited.

## Mandatory server guards
- Reject unauthenticated callers before querying rows.
- Resolve **active** Café tenant by exact slug `quick-solution`; check `tenant_capabilities.quick_solution` enabled.
- Require `public.has_tenant_capability(v_tenant_id, 'cafe.counter.operate') IS TRUE` to read the queue. This includes active Café owner/admin/member, but excludes users with only OPPS access.
- For any future send/fulfilment action, require a separate management/fulfilment capability; reading is not an authorization to mutate.
- Both UNION branches must restrict by `tenant_id = v_tenant_id`. Never accept `tenant_id` as an argument. Never resolve tenant from `auth.jwt().user_metadata`.
- Use a tight, non-leaking JSON projection: type, id, original number, customer display name, status, total, balanceDue, reviewRequired, sourceOrderId, updatedAt. Do not return share tokens, raw PayFast ITNs, payment IDs, personal contact details, notes, or source metadata.
- Derive invoice outstanding only from canonical invoice state. For OPPS orders there is no proven canonical balance in this audit: return **null**, never `total_amount` as an assumed unpaid balance. For draft/void invoices, or invoice payment reconciliation uncertainty, require review and never provide an actionable payment.
- Paginate deterministically with upper bound 50; cursor parsing must be strict, with stable tie-breaking by type+ID. Never permit unbounded rows.
- A `SECURITY DEFINER` function requires fixed empty search_path, schema-qualified identifiers, explicit internal auth checks, revoked default PUBLIC/anon execution and a narrowly scoped authenticated grant; inspect database advisors. Consider an invoker alternative if RLS already permits the necessary cross-table read.
- Service role, authenticated, anonymous, nonmember, suspended member, member from another tenant and cross-tenant fixture checks are required. No broad permissions or app-admin bypass.

## Minimum acceptance tests
1. Active Café member reads only Café work; other tenant denied.
2. An OPPS-only staff user is denied; unauthenticated user is denied.
3. Owner/admin/member permissions are consistent with existing Counter access.
4. Unpaid, paid, partial, draft, void and standalone invoices display correct read-only state.
5. `orders` and `opps_invoices` remain original records and are never inserted into by the list.
6. Pagination does not duplicate/skip on stable data and rejects malformed cursors.
7. Missing or inconsistent financial state returns no payable amount.
8. Existing Counter RPC and shared Cash/EFT remain unchanged.
9. No deployed PayFast callback, secrets, production/staging data or customer invoice is modified by the tests.

## Implementation sequence
1. Draft the SQL as a proper migration using `supabase migration new` locally; do not apply.
2. Run syntax/permission tests in a throwaway isolated DB; inspect security advisor output.
3. Review SQL and UI contract together, then apply only to staging with a scoped release plan.
4. Test against authorized and unauthorized staging identities, then wire UI.
5. Reserve payment QR for a separate phase after financial reconciliation proof.
