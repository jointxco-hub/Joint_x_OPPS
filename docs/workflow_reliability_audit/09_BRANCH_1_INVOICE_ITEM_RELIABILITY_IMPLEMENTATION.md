# Branch 1 — Invoice Item Reliability Implementation

## Scope and branch

- Branch: `fix/invoice-item-reliability`
- Scope: invoice detail/item loading, false-empty protection, atomic header/item persistence, save feedback, refresh, diagnostics, and focused tests.
- Explicitly excluded: the broader invoice/order redesign, approved-invoice revisions, purchasing work, attachments, PDF changes, naming changes, and global UI redesign.

## Original root cause

The invoice list row was used as a fallback when the full detail query failed. A list row has no authoritative line-item collection, but the editor could treat that incomplete record as a normal invoice and initialize an empty item list. Updating then deleted all saved rows before inserting the current rows in a second request. A failed insert, or a false-empty editor state, could therefore leave a valid invoice with no items. Save notifications also used Sonner while no Sonner renderer was mounted in the OPPS application.

## Files changed

- `src/features/invoices/invoiceReliability.js`
- `src/api/invoices.js`
- `src/pages/Invoices.jsx`
- `src/features/invoices/InvoiceCreateFlow.jsx`
- `src/features/invoices/InvoiceDetailDrawer.jsx`
- `src/App.jsx`
- `supabase/migrations/202608020001_invoice_item_atomic_persistence.sql`
- `tests/invoice-reliability.test.mjs`
- `package.json`
- `docs/workflow_reliability_audit/09_BRANCH_1_INVOICE_ITEM_RELIABILITY_IMPLEMENTATION.md`

Unrelated dirty-worktree files that existed before this branch were not edited as part of this implementation.

## Loading-state changes

Full invoice detail is now marked explicitly with:

- `items_loaded: true`
- `item_load_state: "loaded"`
- `loaded_item_count`

The supported conceptual states are `not_started`, `loading`, `loaded`, and `failed`. An array by itself is not proof that loading completed. List summary data is passed only to the protected read-only failure view; it is no longer passed to the normal detail renderer or editor as a fallback.

When the detail or item query fails, the drawer shows:

> Invoice details could not be loaded. Saving has been disabled to protect the existing invoice.

The failure state offers Retry, Close, and an explicitly read-only summary without line items or edit actions. Diagnostics include only an invoice identifier, a safe error code/message, and item counts.

## Save-protection rules

For an existing invoice, an item-bearing update is rejected before any invoice-item write unless:

1. item loading is explicitly `loaded`;
2. `items_loaded` is true;
3. the editor has an array and a valid starting item count;
4. a previously non-empty invoice is not represented by an empty editor; and
5. the server's locked current item count still matches the editor's starting count.

A deliberate reduction, such as two lines to one, is allowed only after a confirmed complete load. New empty invoices continue through the existing invoice validation rules. Approved invoices remain read-only under the existing draft restriction; the transaction independently rejects non-draft updates.

## Selected transaction strategy

Transactional replace was selected. The existing UI and history model do not rely on stable invoice-item row IDs during editing, and the previous implementation already treated the submitted collection as the complete desired line set. Preserving that semantic inside one database transaction is less disruptive than introducing diff/upsert identity rules in this branch.

The new RPC:

1. authenticates the caller and checks active-tenant plus finance/admin access;
2. locks the existing invoice with `FOR UPDATE`;
3. rejects invoices outside the tenant and non-draft invoices;
4. checks the expected header timestamp and existing item count;
5. rejects conflicting line ownership;
6. verifies referenced item templates, catalog items, and inventory items belong to the tenant;
7. updates/inserts the header;
8. deletes and reinserts the complete item collection within the same transaction;
9. writes applicable activity in the same transaction; and
10. returns the final invoice, ordered items, and item count as structured JSON.

Any header, line, or activity exception rolls the entire function call back. The client no longer performs a standalone item delete.

## Query invalidation and server confirmation

After a successful transaction the client invalidates:

- invoice lists;
- the saved invoice detail;
- invoice export candidates; and
- the linked order's invoice summary when the saved invoice already has that relationship.

It then fetches full detail from the server and compares the refreshed item count with the transaction result. A mismatch is treated as a failure, logged safely, and leaves the editor state available rather than trusting optimistic data.

## Notification handling

The existing Sonner renderer is now mounted in the OPPS application next to the existing shadcn toast renderer. Invoice save actions:

- disable both save/approve buttons while pending;
- display a spinner and `Saving...`;
- show the existing success notification after server confirmation;
- show an actionable error notification on failure; and
- close/reset the editor only in the success handler.

The application still has more than one notification API globally. Consolidating that system is intentionally deferred.

## Migration details

Migration: `202608020001_invoice_item_atomic_persistence.sql`

- Additive: creates/replaces one function and changes no table shape.
- Execution is revoked from `public` and `anon`; only `authenticated` receives execute.
- Tenant and finance authorization are repeated inside the `SECURITY DEFINER` function.
- No historical migration was edited or replayed.
- This migration was created locally only and was not applied to a remote environment.

## Tests and static verification

Focused automated suite:

```text
npm run test:invoice-reliability
13 tests passed, 0 failed
```

Coverage includes complete multi-item loading, summary/detail separation, failed and unresolved load guards, false-empty protection, deliberate removal after confirmed load, new-invoice behavior, post-save count verification, transaction contract/authorization/rollback markers, and protected UI/pending feedback.

Additional checks:

- `npm run build`: passed.
- ESLint on the changed invoice/reliability JS files: no errors (the project's ESLint configuration reports three JSX files as having no matching scoped configuration).
- `git diff --check`: passed.
- Repository-wide `npm run lint`: not clean at baseline; 218 existing findings across unrelated files.
- Repository-wide `npm run typecheck`: not clean at baseline; broad existing JS inference/component typing failures remain. No attempt was made to repair unrelated modules in this branch.

## Manual verification status

Locally verified without contacting a backend:

- production build compilation;
- explicit loaded-detail construction with multiple items;
- summary records cannot qualify as full detail;
- failed/unresolved and false-empty states throw before persistence;
- confirmed two-to-one removal is allowed;
- post-save count mismatch is rejected;
- UI source contains pending, retry, close, read-only, success, and failure paths; and
- the migration contains the lock, ownership checks, atomic replace, structured return, grants, and rollback behavior.

Not interactively executed because this workspace did not have a connected local Supabase test stack or browser test harness:

1. open/close/reopen an existing two-line invoice;
2. edit a quantity and observe pending/success states;
3. inject an item-query failure and retry;
4. inject a database line constraint failure and inspect retained rows;
5. display an approved invoice; and
6. exercise two real tenants.

These remain required staging checks before rollout:

1. Open an existing invoice with at least two saved items and confirm all items.
2. Close/reopen and confirm the same items.
3. Edit a quantity, save, observe `Saving...` and success, then reopen and confirm the server value.
4. Force the item query to fail; confirm the protected failure view appears and no edit/save action is possible; retry successfully.
5. Force one submitted line to violate a constraint; confirm the old header and items remain unchanged.
6. Confirm approved invoice items display and an update is rejected.
7. Attempt an invoice ID and item/template/catalog/inventory reference from another tenant; confirm rejection.
8. Double-click save while pending; confirm only one transaction occurs.

## Remaining risks and limitations

- Atomic behavior and tenant isolation have source-level coverage but still require execution against a disposable/staging PostgreSQL database.
- Client item-template synchronization happens before the core invoice RPC, and item-version history is written after it. Those auxiliary records are outside the header/item atomic boundary. A history failure is diagnosed but does not misreport the already-committed core invoice as unsaved.
- The RPC must be present before deploying the client code; otherwise invoice create/update returns a visible transaction error.
- Global notification-system consolidation and the approved-invoice revision workflow remain deferred by scope.

## Rollout recommendation

1. Apply the additive migration to a disposable or staging database first.
2. Run the staging manual flow above, including forced constraint failures and two-tenant tests.
3. Deploy the matching client only after the RPC is confirmed.
4. Monitor safe `[invoice-reliability]` diagnostics for detail failures, blocked saves, transaction failures, and count mismatches.
5. Promote through the normal reviewed release process only after staging evidence is captured.

No deployment or production change is part of this branch.

## Rollback approach

Coordinate application and database rollback:

1. Roll back the client to the version that does not call the RPC.
2. Revoke and drop:

```sql
revoke all on function public.save_opps_invoice_with_items(
  uuid, uuid, jsonb, jsonb, timestamptz, integer
) from authenticated;

drop function if exists public.save_opps_invoice_with_items(
  uuid, uuid, jsonb, jsonb, timestamptz, integer
);
```

Dropping the function does not alter invoice tables or historical data. Do not drop the RPC while this client version is active.
