\set ON_ERROR_STOP on

-- Local-only integration test/fixture for the quote-approval recovery work
-- (recovery/xlab-quote-approval). Requires the migration chain documented
-- in the branch's recovery report to already be applied:
--   local_xlab_scaffold.sql (disposable-stack-only prerequisite objects;
--     never committed - see that file's header for why it's needed)
--   X LAB: 202608050001_quote_approval_and_resource_files.sql
--   X LAB: 202608050004_quote_request_drafts.sql
--   OPPS:  202608050001_xlab_quote_approval.sql
--   OPPS:  202608050002_xlab_orders_awaiting_payment.sql
--   OPPS:  202608050004_hide_draft_quote_requests.sql
--   OPPS:  202608060003_quote_approval_regression_guard_and_order_lookup.sql
--
-- Deliberately does NOT require or exercise the client-side archive/delete
-- RPC (update_client_quote_request) or its OPPS-side counterpart
-- (get_internal_client_requests hiding archived requests). Both migrations
-- for that feature (X LAB: 202608060001_client_quote_request_archive_delete.sql,
-- OPPS: 202608060001_hide_archived_quote_requests.sql) are uncommitted in
-- their respective repos and unrelated to this recovery work's actual
-- scope (approval mutation contract, refresh, status locking, read-only
-- linked-order display) - shipping them is a separate cross-repo decision.
--
-- Unlike other *_smoke.sql fixtures in this repo, this one COMMITS its seed
-- data on success (fake/test data only) so it can also be used as a fixture
-- for a manual browser pass against the same local stack. Safe to rerun
-- against a disposable stack; not idempotent against a populated database
-- (fixed test IDs), and must never be run anywhere but a local/disposable
-- Postgres instance.

-- Reuse the real 'joint-x' tenant seeded by OPPS's own multi-tenant
-- foundation migration (_joint_x_tenant_id() looks it up by slug, so a
-- fabricated second 'joint-x' row would just collide/be wrong) as tenant A.
select id as joint_x_tenant_id from public.tenants where slug = 'joint-x' \gset

begin;

insert into public.tenants (id, slug, name) values
  ('92000000-0000-0000-0000-000000000002', 'tenant-b-local-test', 'Tenant B (local test, isolation check only)')
on conflict (id) do nothing;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('9a000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'staff-a@quote-approval-local-test.invalid', '{}'::jsonb, '{}'::jsonb),
  ('9b000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'staff-b@quote-approval-local-test.invalid', '{}'::jsonb, '{}'::jsonb)
on conflict (id) do nothing;

insert into public.users (id, auth_user_id, user_email, full_name, role, is_active) values
  ('91100000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', 'staff-a@quote-approval-local-test.invalid', 'Staff A (local test)', 'ops', true),
  ('92100000-0000-0000-0000-000000000002', '9b000000-0000-0000-0000-000000000002', 'staff-b@quote-approval-local-test.invalid', 'Staff B (local test)', 'ops', true)
on conflict (id) do nothing;

insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role) values
  (:'joint_x_tenant_id', '9a000000-0000-0000-0000-000000000001', 'owner'),
  ('92000000-0000-0000-0000-000000000002', '9b000000-0000-0000-0000-000000000002', 'owner')
on conflict (tenant_id, auth_user_id) do nothing;

insert into public.clients (id, name, email, tenant_id) values
  ('91300000-0000-0000-0000-000000000001', 'Local Test Client A', 'client-a@quote-approval-local-test.invalid', :'joint_x_tenant_id'),
  ('92300000-0000-0000-0000-000000000002', 'Local Test Client B', 'client-b@quote-approval-local-test.invalid', '92000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

commit;

-- ── Client actions, via the real client-portal RPCs (no auth context - these
--    are security definer and gate on email/order-number, not auth.uid()) ──

-- 1. Client A saves a DRAFT quote request.
select public.submit_client_portal_item(
  'client-a@quote-approval-local-test.invalid',
  'ANY-ORDER-NUMBER',
  'quote_request',
  jsonb_build_object('details', 'Draft: 50 x local test hoodie, size run TBC', 'project_name', 'Local test draft', 'quantity', '50'),
  'draft'
) as draft_submission \gset draft_

-- 2. Client A submits a REAL (non-draft) quote request - the one staff will approve.
select public.submit_client_portal_item(
  'client-a@quote-approval-local-test.invalid',
  'ANY-ORDER-NUMBER',
  'quote_request',
  jsonb_build_object('details', 'Real request: 20 x local test t-shirt, black, size M', 'project_name', 'Local test order', 'quantity', '20'),
  'new'
) as real_submission \gset real_

\echo '--- draft submission result ---'
select :'draft_draft_submission';
\echo '--- real submission result ---'
select :'real_real_submission';

-- Note: psql's :'var' substitution does not reach inside dollar-quoted ($$)
-- blocks, so every DO block below looks these ids up by their distinctive
-- seeded content instead of via the \gset variables above (which are only
-- used for the plain \echo confirmations right before this).
do $$
declare
  v_draft_id uuid;
  v_real_id uuid;
begin
  select id into v_draft_id from public.client_quote_requests
    where client_email = 'client-a@quote-approval-local-test.invalid' and details like 'Draft: 50 x local test hoodie%';
  select id into v_real_id from public.client_quote_requests
    where client_email = 'client-a@quote-approval-local-test.invalid' and details like 'Real request: 20 x local test t-shirt%';

  if v_draft_id is null or v_real_id is null then
    raise exception 'TEST_SETUP_FAILED: client submissions did not return an id';
  end if;

  -- Sanity: both landed in client_quote_requests with the expected status.
  if (select status from public.client_quote_requests where id = v_draft_id) <> 'draft' then
    raise exception 'TEST_SETUP_FAILED: draft request does not have status=draft';
  end if;
  if (select status from public.client_quote_requests where id = v_real_id) not in ('new') then
    raise exception 'TEST_SETUP_FAILED: real request does not have status=new';
  end if;

  raise notice 'draft_id=%, real_id=%', v_draft_id, v_real_id;
end
$$;

-- Simulated: a tenant B quote request. The real client-submission RPC path
-- (_joint_x_tenant_id()) hardcodes every submission to the 'joint-x' tenant
-- regardless of which client submits - see the accompanying report - so a
-- genuine tenant B request cannot currently be produced by that RPC. This
-- direct insert exists only to exercise the OPPS-side tenant filters
-- (get_internal_client_requests / approve_client_quote_request /
-- get_client_orders_awaiting_payment), which DO correctly check tenant_id
-- regardless of how a row was created.
insert into public.client_quote_requests (id, client_id, client_email, client_name, project_name, details, quantity, source_app, status, tenant_id)
values (
  '92900000-0000-0000-0000-000000000001',
  '92300000-0000-0000-0000-000000000002',
  'client-b@quote-approval-local-test.invalid',
  'Local Test Client B',
  'Tenant B local test order',
  'Real request: 5 x tenant B item',
  '5',
  'xlab',
  'new',
  '92000000-0000-0000-0000-000000000002'
);

-- SET LOCAL only works inside an explicit transaction, and needs to stay in
-- effect across every staff-view/action check below (including the reset
-- role/re-set for staff B) - so everything from here to the final commit is
-- one transaction.
begin;

-- ── Staff A (tenant A / joint-x) view ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"9a000000-0000-0000-0000-000000000001","email":"staff-a@quote-approval-local-test.invalid","role":"authenticated"}';

do $$
declare
  v_visible_count integer;
  v_draft_visible boolean;
  v_tenant_b_visible boolean;
begin
  select count(*) into v_visible_count
  from public.get_internal_client_requests(null, null, null, null, 100)
  where client_email = 'client-a@quote-approval-local-test.invalid';

  if v_visible_count <> 1 then
    raise exception 'TEST_FAILED: staff A should see exactly 1 visible request from client A (draft excluded), saw %', v_visible_count;
  end if;

  select exists (
    select 1 from public.get_internal_client_requests(null, null, null, null, 100) r
    join public.client_quote_requests q on q.id = r.id
    where q.status = 'draft'
  ) into v_draft_visible;
  if v_draft_visible then
    raise exception 'TEST_FAILED: a draft request is visible to staff - draft exclusion is broken';
  end if;

  select exists (
    select 1 from public.get_internal_client_requests(null, null, null, null, 100)
    where client_email = 'client-b@quote-approval-local-test.invalid'
  ) into v_tenant_b_visible;
  if v_tenant_b_visible then
    raise exception 'TEST_FAILED (TENANT ISOLATION): staff A can see tenant B''s request';
  end if;

  raise notice 'PASS: staff A sees only their own tenant''s non-draft requests (% visible)', v_visible_count;
end
$$;

-- Staff A tries to approve tenant B's request - must be rejected.
do $$
declare v_code text;
begin
  begin
    perform public.approve_client_quote_request(
      '92900000-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object('product_name', 'Cross-tenant item', 'quantity', 1, 'unit_price', 100, 'line_total', 100)),
      100, null
    );
    raise exception 'TEST_FAILED (TENANT ISOLATION): staff A was able to approve tenant B''s request';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code !~ 'not found in your tenant' then raise; end if;
    raise notice 'PASS: staff A cannot approve tenant B''s request (%)', v_code;
  end;
end
$$;

-- Staff A approves client A's real request with valid items.
do $$
declare
  v_real_id uuid;
  v_result jsonb;
  v_order_id uuid;
begin
  select id into v_real_id from public.client_quote_requests where client_email = 'client-a@quote-approval-local-test.invalid' and details like 'Real request: 20 x local test t-shirt%';

  v_result := public.approve_client_quote_request(
    v_real_id,
    jsonb_build_array(
      jsonb_build_object('product_name', 'Local test t-shirt', 'quantity', 20, 'unit_price', 120, 'line_total', 2400)
    ),
    2400,
    'Approved by local integration test'
  );

  if not (v_result->>'ok')::boolean then
    raise exception 'TEST_FAILED: approval did not return ok=true';
  end if;
  if v_result->>'order_number' is null then
    raise exception 'TEST_FAILED: approval did not return an order_number';
  end if;

  v_order_id := (v_result->>'order_id')::uuid;
  if (select status from public.client_quote_requests where id = v_real_id) <> 'actioned' then
    raise exception 'TEST_FAILED: source request was not marked actioned after approval';
  end if;
  if (select status from public.xlab_orders where id = v_order_id) <> 'pending_payment' then
    raise exception 'TEST_FAILED: created order is not in pending_payment';
  end if;
  if (select source_quote_request_id from public.xlab_orders where id = v_order_id) <> v_real_id then
    raise exception 'TEST_FAILED: created order does not reference the source request';
  end if;
  if (select total_amount from public.xlab_orders where id = v_order_id) <> 2400 then
    raise exception 'TEST_FAILED: order total_amount does not match the approved total';
  end if;

  raise notice 'PASS: approval created order % (id %) in pending_payment, correctly linked, total matches', v_result->>'order_number', v_order_id;
end
$$;

-- Duplicate approval attempt must be blocked with the specific message
-- describeApprovalError() (frontend) maps to a friendlier one.
do $$
declare v_real_id uuid; v_code text;
begin
  select id into v_real_id from public.client_quote_requests where client_email = 'client-a@quote-approval-local-test.invalid' and details like 'Real request: 20 x local test t-shirt%';
  begin
    perform public.approve_client_quote_request(
      v_real_id,
      jsonb_build_array(jsonb_build_object('product_name', 'Duplicate attempt', 'quantity', 1, 'unit_price', 1, 'line_total', 1)),
      1, null
    );
    raise exception 'TEST_FAILED: a second approval of the same request was accepted';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code !~ 'already been activated for payment' then raise; end if;
    raise notice 'PASS: duplicate approval blocked with the expected message (%)', v_code;
  end;
end
$$;

-- Invalid items must be rejected before any order is created (this is the
-- database's own defense; the frontend's validateApprovalItems blocks this
-- earlier still, before the RPC is even called - see quoteApprovalCalculations.js).
do $$
declare v_draft_id uuid; v_code text; v_orders_before integer; v_orders_after integer;
begin
  select id into v_draft_id from public.client_quote_requests where client_email = 'client-a@quote-approval-local-test.invalid' and details like 'Draft: 50 x local test hoodie%';
  select count(*) into v_orders_before from public.xlab_orders;

  begin
    perform public.approve_client_quote_request(
      v_draft_id, jsonb_build_array(jsonb_build_object('product_name', 'x', 'quantity', 1, 'unit_price', 1, 'line_total', 1)), 0, null
    );
    raise exception 'TEST_FAILED: a total of 0 was accepted';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code !~ 'greater than zero' then raise; end if;
  end;

  select count(*) into v_orders_after from public.xlab_orders;
  if v_orders_after <> v_orders_before then
    raise exception 'TEST_FAILED: an order was created despite the rejected total';
  end if;
  raise notice 'PASS: zero total rejected, no order created (orders count unchanged at %)', v_orders_after;
end
$$;

-- Approved/linked request must not be able to regress to new/reviewing via
-- update_internal_client_request_status (the manual browser test for this
-- branch found exactly this - see 202608060003_quote_approval_regression_
-- guard_and_order_lookup.sql for the root cause and fix).
do $$
declare v_real_id uuid; v_code text;
begin
  select id into v_real_id from public.client_quote_requests where client_email = 'client-a@quote-approval-local-test.invalid' and details like 'Real request: 20 x local test t-shirt%';

  if (select status from public.client_quote_requests where id = v_real_id) <> 'actioned' then
    raise exception 'TEST_SETUP_FAILED: expected the approved request to already be actioned before the regression test';
  end if;

  begin
    perform public.update_internal_client_request_status('quote_request', v_real_id, 'reviewing');
    raise exception 'TEST_FAILED: an approved/linked request was moved back to reviewing';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code !~ 'already has a payable order' then raise; end if;
    raise notice 'PASS: approved/linked request cannot regress to reviewing (%)', v_code;
  end;

  begin
    perform public.update_internal_client_request_status('quote_request', v_real_id, 'new');
    raise exception 'TEST_FAILED: an approved/linked request was moved back to new';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code !~ 'already has a payable order' then raise; end if;
    raise notice 'PASS: approved/linked request cannot regress to new (%)', v_code;
  end;

  -- The other intentional terminal state must still be reachable.
  perform public.update_internal_client_request_status('quote_request', v_real_id, 'closed');
  if (select status from public.client_quote_requests where id = v_real_id) <> 'closed' then
    raise exception 'TEST_FAILED: approved/linked request could not be moved to closed';
  end if;
  raise notice 'PASS: approved/linked request can still be moved to closed';

  -- Restore to actioned so the rest of this fixture, and any manual browser
  -- pass reusing this seed data, sees the expected default state.
  update public.client_quote_requests set status = 'actioned' where id = v_real_id;
end
$$;

-- get_client_quote_request_order must return the saved order so staff can
-- see read-only pricing when an approved request is reopened (the request's
-- own payload never contained a price - only the approval did).
do $$
declare v_real_id uuid; v_order_number text; v_items jsonb;
begin
  select id into v_real_id from public.client_quote_requests where client_email = 'client-a@quote-approval-local-test.invalid' and details like 'Real request: 20 x local test t-shirt%';

  select order_number, items into v_order_number, v_items
  from public.get_client_quote_request_order(v_real_id);

  if v_order_number is null then
    raise exception 'TEST_FAILED: get_client_quote_request_order returned no linked order for an approved request';
  end if;
  if jsonb_array_length(v_items) <> 1 or (v_items->0->>'product_name') <> 'Local test t-shirt' then
    raise exception 'TEST_FAILED: get_client_quote_request_order returned unexpected items: %', v_items;
  end if;

  raise notice 'PASS: get_client_quote_request_order returns order % with saved line items', v_order_number;
end
$$;

-- Awaiting payment list: staff A sees the new order; must not see tenant B orders.
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.get_client_orders_awaiting_payment(50);
  if v_count <> 1 then
    raise exception 'TEST_FAILED: staff A should see exactly 1 order awaiting payment, saw %', v_count;
  end if;
  raise notice 'PASS: Awaiting Payment shows exactly the 1 new order for staff A';
end
$$;

-- ── Staff B (tenant B) view - must see ONLY tenant B's request, and must
--    not see tenant A's approved order in Awaiting Payment. ──
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"9b000000-0000-0000-0000-000000000002","email":"staff-b@quote-approval-local-test.invalid","role":"authenticated"}';

-- Discovered while running this fixture (not a bug in this recovery branch):
-- public.users has an AFTER INSERT/UPDATE trigger
-- (trg_internal_user_joint_x_membership -> add_internal_user_to_joint_x_team)
-- that automatically grants every new internal staff user membership in the
-- 'joint-x' tenant, in addition to whatever tenant_memberships row is
-- created explicitly. So "staff B, deliberately scoped only to tenant B"
-- does not really exist as a condition the current schema can produce -
-- staff B ends up with membership in BOTH tenant B and joint-x. This means
-- the direction "does staff B leak into tenant A/joint-x's data" cannot be
-- cleanly tested today; the direction that matters in production right now
-- (staff A/joint-x cannot see or approve a genuinely separate tenant's data)
-- was already verified above and held correctly.
do $$
declare v_visible_count integer; v_tenant_a_visible boolean; v_awaiting_count integer;
begin
  select count(*) into v_visible_count
  from public.get_internal_client_requests(null, null, null, null, 100)
  where client_email = 'client-b@quote-approval-local-test.invalid';
  if v_visible_count <> 1 then
    raise exception 'TEST_FAILED: staff B should see their own tenant''s request regardless of the joint-x auto-membership, saw %', v_visible_count;
  end if;
  raise notice 'PASS: staff B sees their own tenant''s request (%)', v_visible_count;

  select exists (
    select 1 from public.get_internal_client_requests(null, null, null, null, 100)
    where client_email = 'client-a@quote-approval-local-test.invalid'
  ) into v_tenant_a_visible;
  raise notice 'OBSERVED (trg_internal_user_joint_x_membership, pre-existing, not part of this recovery): staff B can see tenant A/joint-x''s request = % - expected true given the auto-membership trigger described above.', v_tenant_a_visible;

  select count(*) into v_awaiting_count from public.get_client_orders_awaiting_payment(50);
  raise notice 'OBSERVED: staff B sees % order(s) awaiting payment via the same joint-x auto-membership (consistent with the finding above, not a separate bug).', v_awaiting_count;
end
$$;

-- Documented observation (not a pass/fail assertion): _activate_client_quote_
-- request_order (X LAB, not modified by this branch) sets a new order's
-- tenant_id via `coalesce(tenant_id, public._joint_x_tenant_id())`, and
-- create_checkout_order never sets tenant_id in the first place - so this
-- always resolves to the 'joint-x' tenant, regardless of which tenant's
-- staff approved the request. Demonstrated here using staff B approving
-- their OWN tenant B request, which the authorization check correctly
-- allows (unlike the earlier cross-tenant attempt).
do $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_order_tenant uuid;
  v_joint_x_tenant uuid;
begin
  select id into v_joint_x_tenant from public.tenants where slug = 'joint-x';

  v_result := public.approve_client_quote_request(
    '92900000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('product_name', 'Tenant B item', 'quantity', 5, 'unit_price', 50, 'line_total', 250)),
    250, null
  );
  v_order_id := (v_result->>'order_id')::uuid;
  select tenant_id into v_order_tenant from public.xlab_orders where id = v_order_id;

  if v_order_tenant = v_joint_x_tenant then
    raise notice 'OBSERVED (X LAB, pre-existing, not part of this recovery): tenant B''s own approved order was tagged tenant_id=joint-x, not tenant B. Staff B will not see it in Awaiting Payment. Not a security leak (RLS still enforces whatever tenant_id ends up stored) but a functional correctness gap if a second tenant is ever onboarded.';
  else
    raise notice 'Order correctly tagged with tenant B''s own tenant_id (%) - hardcoding concern did not reproduce.', v_order_tenant;
  end if;
end
$$;

reset role;
commit;

select 'ALL_QUOTE_APPROVAL_LOCAL_INTEGRATION_CHECKS_PASSED' as result;
