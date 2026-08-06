# Technical issue: quote-approval order/staff assignment is not actually multi-tenant

Status: **open, not fixed, not scheduled**. Discovered while building a local
integration test for `recovery/xlab-quote-approval` (see that branch's
history and `supabase/tests/quote_approval_local_integration.sql`). Both
root causes are pre-existing X LAB/production code, predating and unrelated
to that recovery work — nothing in that branch introduced or should attempt
to fix them.

## Summary

The multi-tenant *schema* is in place (`tenants`, `tenant_memberships`,
`client_quote_requests.tenant_id`, `xlab_orders.tenant_id`, RLS policies
checking `current_user_tenant_ids()`), and the request-level and
approval-authorization checks that use it work correctly. But two other
pieces of the same workflow are hardcoded to the single real tenant
(`joint-x`), which means a genuinely separate second tenant's orders and
staff would not behave correctly today. In practice, since there is
currently only one real tenant in production, this causes no visible
problem — the moment a second tenant is onboarded to this feature, it will.

## Root cause 1 — orders are always tagged to the `joint-x` tenant

`public._activate_client_quote_request_order` (X LAB migration
`202608050001_quote_approval_and_resource_files.sql`) sets a newly created
order's tenant like this:

```sql
update public.xlab_orders
  set source_quote_request_id = p_request_id,
      tenant_id = coalesce(tenant_id, public._joint_x_tenant_id())
  where id = new_order.id;
```

`create_checkout_order` (the function this calls to actually create the
order row) never sets `tenant_id` in the first place, so `tenant_id` is
always `null` going into this `coalesce`, which means it always resolves to
`_joint_x_tenant_id()` — the tenant whose slug is literally `'joint-x'` —
**regardless of which tenant's staff approved the request, or which tenant
the source `client_quote_requests` row belonged to.**

Demonstrated directly in the local integration test: staff B (a second,
genuinely separate test tenant) approved their own tenant's request — an
action the authorization check correctly allowed — and the resulting order
was tagged `tenant_id = joint-x`, not tenant B.

Consequence: `get_client_orders_awaiting_payment` (OPPS, filters by
`tenant_id in current_user_tenant_ids()`) would not show that order to
tenant B's own staff. Not a data leak — RLS still enforces whatever
`tenant_id` ends up stored — but a functional correctness gap: a second
tenant's own staff could lose visibility into their own approved orders.

## Root cause 2 — every new staff user is auto-joined to `joint-x`

`public.users` has this trigger (found via `\d public.users` on the
reconstructed local schema, not a recovery-branch change):

```
trg_internal_user_joint_x_membership
  AFTER INSERT OR UPDATE OF auth_user_id, is_active, role ON users
  FOR EACH ROW EXECUTE FUNCTION add_internal_user_to_joint_x_team()
```

Every new internal staff `users` row automatically gets a
`tenant_memberships` row for `joint-x`, **in addition to** whatever other
tenant membership is created explicitly. Demonstrated directly: a test
staff user was given a `tenant_memberships` row for a second test tenant
only, and ended up with membership in *both* tenants anyway.

Consequence: there is currently no way to create a staff user who is
scoped to only a non-`joint-x` tenant. Every staff member can see and act
on `joint-x`'s data, structurally, regardless of intent. Again: for the one
real tenant that exists today this is invisible/harmless; it becomes a real
access-control gap the moment a second tenant with its own staff exists.

## What this means in practice today

**The current implementation supports Joint X operationally** — single
real tenant, everything resolves to it correctly, no bug visible in normal
use — **but is not fully multi-tenant.** The schema and the request-level
checks are ready for it; order tenant-assignment and staff tenant-scoping
are not.

## What fixing this would require

Not attempted here, and shouldn't be attempted as a quick patch on either
of the two functions above — both live in the X LAB repository, outside
this repo's control, and touching either without a real design pass risks
breaking the one tenant that works correctly today. A real fix needs:

- A decision on how an order's tenant should actually be resolved (from the
  source request's tenant? From the approving staff member's tenant? What
  happens for the client-side auto-activation path in
  `submit_repeat_order_request`, which has no "approving staff member" at
  all?) — this is a product/architecture decision, not a one-line fix.
- A decision on whether the `joint-x` auto-membership trigger should be
  removed, made conditional, or kept as an intentional "everyone can see
  the primary tenant" policy — it may be entirely deliberate given today's
  single-tenant reality, in which case the fix is to document that
  explicitly rather than remove it.
- Coordinated changes across both repositories (X LAB owns both root-cause
  functions/triggers; OPPS's RLS-based filters are already tenant-correct
  and would not need to change).

## Where this was found

- `recovery/xlab-quote-approval` branch, this recovery/testing session
- Reproduced in `supabase/tests/quote_approval_local_integration.sql`
  (search for `OBSERVED` in that file — both findings are logged as
  non-failing `raise notice` observations, not test failures, since they
  are pre-existing behavior being documented, not regressions to block on)
- Verified against a local disposable Supabase stack only; never
  reproduced against or fixed on production
