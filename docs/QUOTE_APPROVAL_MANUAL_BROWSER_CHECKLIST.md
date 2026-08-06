# Quote Approval — Manual Browser Acceptance Test Checklist

Status: **not yet run**. This checklist exists because the recovery/testing
session for `recovery/xlab-quote-approval` had no browser automation tool
available — every workflow step was verified at the RPC/database layer
(`supabase/tests/quote_approval_local_integration.sql`, 460 lines, all
assertions passing) and via unit tests
(`tests/quote-approval-calculations.test.mjs`, 29/29 passing), but nobody has
actually clicked through the rendered UI yet. Do that here before treating
this feature as done.

**Do not run this against production.** Run it against the local disposable
Supabase stack with `recovery/xlab-quote-approval` checked out and
`npm run dev` pointed at that local stack via a temporary `.env.local`
override (never commit real Supabase credentials or point this at the
hosted project).

## Setup

- [ ] `recovery/xlab-quote-approval` checked out
- [ ] Docker running, local Supabase stack started:
  ```
  # if the disposable containers already exist (created in this recovery session):
  docker start supabase_db_codex_invoice_full_schema_20260802 supabase_rest_codex_invoice_full_schema_20260802 supabase_auth_codex_invoice_full_schema_20260802 supabase_kong_codex_invoice_full_schema_20260802

  # verify:
  docker ps
  ```
  If those containers no longer exist, a fresh disposable stack needs to be
  built and the full migration chain re-applied — see the "Root cause"
  sections of `docs/QUOTE_APPROVAL_TENANT_ARCHITECTURE_LIMITATION.md` for
  what depends on what, and the recovery branch's commit messages
  (`git log recovery/xlab-quote-approval`) for the exact migration list and
  order that was applied.
- [ ] Migrations re-applied if this is a fresh stack (local-only scaffold,
      then X LAB's 202608050001/202608050004/202608060001, then this
      repo's 202608050001/202608050002/202608050004, then — only if you've
      confirmed X LAB's archive UI has since been committed —
      202608060001)
- [ ] `.env.local` temporarily points `VITE_SUPABASE_URL` to
      `http://127.0.0.1:54321` and `VITE_SUPABASE_ANON_KEY` to the local
      stack's anon key, not production (append to `.env.local`, don't
      overwrite it — it may already contain unrelated Vercel CLI content;
      remove the two lines again when done)
- [ ] `npm run dev`, signed in as a seeded local staff user
- [ ] Test data present: at minimum one draft quote request, one submitted
      (non-draft) quote request, both from a test client —
      `supabase/tests/quote_approval_local_integration.sql` seeds exactly
      this and is safe to rerun (it cleans up and reseeds its own fixed
      test IDs)

## Checklist

### Visibility
- [ ] **Draft is hidden from staff** — the draft request does not appear
      anywhere in the Client Requests list, under any filter combination
- [ ] **Submitted quote appears** — the non-draft request shows up in the
      list with the correct client name/email and preview text

### Approval — happy path
- [ ] Opening the request shows the "Approve & create payable order"
      section with an editable item row, prefilled from the request's
      payload where available
- [ ] **Valid approval succeeds** — enter a name, quantity, and price,
      click Approve, and it completes without error
- [ ] **Awaiting Payment refreshes immediately** — the new order appears in
      the Awaiting Payment section without a manual page refresh
- [ ] **Approved request becomes read-only** — reopening the same request
      no longer shows the approval form, instead shows the
      "already actioned" message; the status badge reflects `actioned`

### Validation
- [ ] **Invalid items are blocked**: try each of the following and confirm
      the Approve button stays disabled / the request is not submitted,
      with a specific per-row error message shown, not just a generic
      failure:
  - [ ] Empty item list (remove the only row, if the UI allows it)
  - [ ] Blank product name
  - [ ] Quantity of `0`
  - [ ] Negative quantity
  - [ ] Negative unit price
  - [ ] Non-numeric quantity or price (type letters into the field)
  - [ ] A single line so large it pushes the total absurdly high (sanity
        cap — should be rejected with a "cannot exceed" message)
- [ ] Fixing the invalid field(s) re-enables Approve without needing to
      reopen the dialog

### Duplicate approval
- [ ] **Duplicate approval gives the friendly message** — approve a
      request, then (e.g. via a second tab/session, or by reopening if the
      UI still permits an attempt) try to approve the same request again;
      confirm the message is the friendly one ("already been approved and
      turned into an order...") and not a raw Postgres error string

### Display correctness
- [ ] **Amounts and formatting render correctly**: quantity × price
      matches the displayed line total; the grand total equals the sum of
      line totals; currency is formatted consistently (thousands
      separator, two decimal places) in both the approval form and the
      Awaiting Payment card
- [ ] Dates in Awaiting Payment render as real dates, not "Invalid Date"

### Loading / empty / error states
- [ ] **Loading state**: on first page load (slow network throttling, or
      just observe on a fresh load), the Awaiting Payment section and the
      request list show a visible loading indicator, not a flash of empty
      content
- [ ] **Empty state**: with no orders awaiting payment, the Awaiting
      Payment section either doesn't render or clearly says there's
      nothing there — it must not look identical to an error
- [ ] **Error state**: force a failure (e.g. temporarily rename the
      `get_client_orders_awaiting_payment` function in the local DB, or
      revoke execute from `authenticated`) and confirm the UI shows a
      visible, distinct error message rather than silently rendering as
      empty

### Reorder requests
- [ ] **Reorder requests behave correctly**: a request classified as
      `reorder_request` (project name or details starting with "reorder")
      shows the same approval UI as a `quote_request` and approves the
      same way — confirm this explicitly, since the two request types
      share one underlying table and one approval code path
- [ ] If a reorder request was auto-activated by X LAB's own
      `submit_repeat_order_request` (i.e. it arrives already `actioned`),
      confirm it shows as read-only immediately, with no approval form
      offered

## Recording results

When this is run, replace the "not yet run" status at the top with the date,
who ran it, which items passed/failed, and link any bugs filed as a result.
Do not mark this feature complete until every box above is checked against
a real browser session.
