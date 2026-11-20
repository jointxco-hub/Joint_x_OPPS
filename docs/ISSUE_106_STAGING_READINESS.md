# Café Work Queue staging review — 9 November 2026

## Current status
**Staging RPC installed; authenticated staff end-to-end QA still pending. Production remains unchanged.**

- Supabase staging project: `tijiamrfnxrbitafiflj` (eu-west-1).
- Installed `public.qs_cafe_list_work_queue(text, integer)` from `supabase/migrations/20261105140631_issue_106_cafe_work_queue.sql` through the staging migration tool on 9 November 2026.
- Staging baseline read-only counts: 19 Café OPPS orders, five linked Café invoices, zero standalone invoices; 19 expected top-level work cards.
- A single order card includes linked invoice details, avoiding duplicate top-level linked-invoice cards.
- Function check: SECURITY DEFINER with empty search_path; authenticated EXECUTE granted; anon/service_role EXECUTE revoked.
- Verified anonymous call is rejected with `permission denied for function`, and a call without a signed-in user is rejected with `Staff sign-in is required`.
- Existing Café capability `cafe.counter.operate` and tenant `quick_solution` flag are referenced by the RPC. No payment, production data, or existing Counter RPC changed.
- Security advisors queried after migration; pre-existing advisory findings remain and require separate review.

## Release blockers
1. Test the RPC with a real authorized Café counter_staff user and denied OPPS-only/nonmember/suspended/cross-tenant users; confirm 19 cards, pagination, grouping, no unauthorized row leakage.
2. Run UI click-through of `CafeWorkQueue.jsx` against **staging only**, verify error/empty/loading, mobile layout, and real data (not demo).
3. Verify invoice status cases (unpaid, partial, draft, void, standalone) with synthetic isolated fixtures; staging currently has only linked invoices.
4. Keep work queue read-only; QR/PayFast and Send-to-Counter operations are separate phases requiring their own payment reconciliation and acceptance tests.
5. No production deployment until device acceptance, security sign-off and payment-reconciliation gate.
