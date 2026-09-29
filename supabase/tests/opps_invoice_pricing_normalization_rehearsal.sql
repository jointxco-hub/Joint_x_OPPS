-- feat/opps-invoice-pricing-normalization -- REHEARSAL SCRIPT
--
-- HOW TO RUN (Supabase Studio SQL editor, against production):
--   1. Type or paste: BEGIN;
--   2. Paste the ENTIRE contents of
--      supabase/migrations/20260929120000_opps_invoice_pricing_normalization.sql
--      (the CREATE OR REPLACE FUNCTION statement)
--   3. Paste this entire file after it.
--   4. Type or paste: ROLLBACK;
--   5. Run the whole thing as one execution.
--
-- Nothing here persists: every fixture (tenant, invoices, items, activity
-- rows) is created and asserted against inside the same transaction that
-- gets rolled back at the end. No real tenant, user, or invoice is touched.
--
-- Auth is simulated via the hardcoded owner-email override already present
-- in the live public.is_app_admin() / public.user_finance_level() bodies
-- (both grant access for auth.jwt()->>'email' = 'jointx.co@gmail.com'),
-- so this does not depend on any public.users/auth.users row existing.

do $$
declare
  v_tenant_id         uuid;
  v_fake_user_id      uuid := gen_random_uuid();
  v_invoice_id        uuid;          -- REHEARSAL-001, reused for the update/concurrency test
  v_override_invoice  uuid;          -- REHEARSAL-003, the override test
  v_result            jsonb;
  v_row               public.opps_invoices;
  v_stale_updated_at  timestamptz;
  v_item_total        numeric;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_fake_user_id, 'email', 'jointx.co@gmail.com', 'role', 'authenticated')::text,
    true
  );
  perform set_config('role', 'authenticated', true);

  insert into public.tenants (slug, name, status)
  values ('rehearsal-invoice-norm-' || substr(v_fake_user_id::text, 1, 8), 'Rehearsal Invoice Normalization', 'active')
  returning id into v_tenant_id;

  raise notice '--- fixtures ready: tenant=%, fake_user=% ---', v_tenant_id, v_fake_user_id;

  -- ============================================================
  -- TEST 1 + TEST 3: a correct grand total still saves, and the
  -- client-supplied WRONG item_total (1) is ignored and replaced
  -- with the server-computed value (115.00 = 100 * 1.15 tax).
  -- ============================================================
  select save_opps_invoice_with_items(
    v_tenant_id, null,
    jsonb_build_object(
      'invoice_number', 'REHEARSAL-001',
      'customer_name', 'Rehearsal Customer',
      'invoice_date', current_date,
      'shipping_charge', 0, 'adjustment', 0,
      'subtotal', 999, 'discount_total', 999, 'tax_total', 999,  -- deliberately wrong, see TEST 2
      'total', 115
    ),
    jsonb_build_array(
      jsonb_build_object('item_name', 'Widget', 'quantity', 1, 'rate', 100, 'discount', 0, 'tax_percentage', 15, 'item_total', 1)
    ),
    null, null, false
  ) into v_result;

  v_invoice_id := (v_result->'invoice'->>'id')::uuid;
  select * into v_row from public.opps_invoices where id = v_invoice_id;

  if v_row.id is null then
    raise exception 'TEST 1/3 FAILED: correct grand total did not save';
  end if;

  select item_total into v_item_total from public.opps_invoice_items where invoice_id = v_invoice_id;
  if v_item_total is distinct from 115.00 then
    raise exception 'TEST 1 FAILED: item_total was not server-computed (expected 115.00, got %)', v_item_total;
  end if;
  raise notice 'TEST 1 passed: client item_total (1) ignored, server computed %', v_item_total;

  if v_row.total_override_reason is not null then
    raise exception 'TEST 3 FAILED: an override was unexpectedly recorded for a correct total';
  end if;
  raise notice 'TEST 3 passed: correct grand total saved without override';

  -- ============================================================
  -- TEST 2: incorrect submitted header subtotal/tax/discount are
  -- normalized from the item math (100 / 0 / 15), not the
  -- deliberately-wrong 999/999/999 submitted above.
  -- ============================================================
  if v_row.subtotal is distinct from 100.00 then
    raise exception 'TEST 2 FAILED: header subtotal was not normalized (expected 100.00, got %)', v_row.subtotal;
  end if;
  if v_row.discount_total is distinct from 0.00 then
    raise exception 'TEST 2 FAILED: header discount_total was not normalized (expected 0.00, got %)', v_row.discount_total;
  end if;
  if v_row.tax_total is distinct from 15.00 then
    raise exception 'TEST 2 FAILED: header tax_total was not normalized (expected 15.00, got %)', v_row.tax_total;
  end if;
  raise notice 'TEST 2 passed: header subtotal/discount_total/tax_total normalized from item math';

  -- ============================================================
  -- TEST 4: total mismatch beyond tolerance (>R0.01) still fails
  -- without an override.
  -- ============================================================
  begin
    perform save_opps_invoice_with_items(
      v_tenant_id, null,
      jsonb_build_object(
        'invoice_number', 'REHEARSAL-002', 'customer_name', 'Rehearsal Customer',
        'invoice_date', current_date, 'shipping_charge', 0, 'adjustment', 0, 'total', 999
      ),
      jsonb_build_array(jsonb_build_object('item_name', 'Widget', 'quantity', 1, 'rate', 100, 'discount', 0, 'tax_percentage', 15)),
      null, null, false
    );
    raise exception 'TEST 4 FAILED: mismatched total (999 vs computed 115) was accepted without override';
  exception
    when others then
      if sqlerrm not like 'INVOICE_TOTAL_MISMATCH%' then
        raise exception 'TEST 4 FAILED: wrong error raised: %', sqlerrm;
      end if;
      raise notice 'TEST 4 passed: rejected as expected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 5: approved override (allow_total_override + reason)
  -- still works exactly as before.
  -- ============================================================
  select save_opps_invoice_with_items(
    v_tenant_id, null,
    jsonb_build_object(
      'invoice_number', 'REHEARSAL-003', 'customer_name', 'Rehearsal Customer',
      'invoice_date', current_date, 'shipping_charge', 0, 'adjustment', 0, 'total', 999,
      'total_override_reason', 'Rehearsal test override'
    ),
    jsonb_build_array(jsonb_build_object('item_name', 'Widget', 'quantity', 1, 'rate', 100, 'discount', 0, 'tax_percentage', 15)),
    null, null, true
  ) into v_result;

  v_override_invoice := (v_result->'invoice'->>'id')::uuid;

  if (v_result->>'total_reconciled')::boolean is distinct from false then
    raise exception 'TEST 5 FAILED: total_reconciled should be false for an override';
  end if;

  select * into v_row from public.opps_invoices where id = v_override_invoice;
  if v_row.total_override_reason is distinct from 'Rehearsal test override' then
    raise exception 'TEST 5 FAILED: override reason not stored';
  end if;
  if not exists (
    select 1 from public.opps_invoice_activity
    where invoice_id = v_override_invoice and activity_type = 'invoice_total_overridden'
  ) then
    raise exception 'TEST 5 FAILED: override activity not logged';
  end if;
  raise notice 'TEST 5 passed: override accepted, reason stored, activity logged';

  -- ============================================================
  -- TEST 6: amount_paid/balance_due remain ledger-derived
  -- (0 / total for a brand-new invoice, never from client input).
  -- ============================================================
  if v_row.amount_paid is distinct from 0 then
    raise exception 'TEST 6 FAILED: amount_paid should be 0 for a brand-new invoice, got %', v_row.amount_paid;
  end if;
  if v_row.balance_due is distinct from v_row.total then
    raise exception 'TEST 6 FAILED: balance_due should equal total for a brand-new invoice (total=%, balance_due=%)', v_row.total, v_row.balance_due;
  end if;
  raise notice 'TEST 6 passed: amount_paid=0, balance_due=total, both ledger-derived';

  -- ============================================================
  -- TEST 7: existing draft update/concurrency behaviour unchanged
  -- (valid token succeeds, stale token is rejected).
  -- ============================================================
  select * into v_row from public.opps_invoices where id = v_invoice_id;  -- refresh: REHEARSAL-001
  v_stale_updated_at := v_row.updated_at;

  select save_opps_invoice_with_items(
    v_tenant_id, v_invoice_id,
    jsonb_build_object(
      'invoice_number', 'REHEARSAL-001', 'customer_name', 'Rehearsal Customer Updated',
      'invoice_date', current_date, 'shipping_charge', 0, 'adjustment', 0, 'total', 115
    ),
    jsonb_build_array(jsonb_build_object('item_name', 'Widget', 'quantity', 1, 'rate', 100, 'discount', 0, 'tax_percentage', 15)),
    v_stale_updated_at, 1, false
  ) into v_result;

  if (v_result->>'ok')::boolean is distinct from true then
    raise exception 'TEST 7a FAILED: valid concurrency token was rejected';
  end if;
  raise notice 'TEST 7a passed: valid concurrency token accepted';

  begin
    perform save_opps_invoice_with_items(
      v_tenant_id, v_invoice_id,
      jsonb_build_object(
        'invoice_number', 'REHEARSAL-001', 'customer_name', 'Should Fail',
        'invoice_date', current_date, 'shipping_charge', 0, 'adjustment', 0, 'total', 115
      ),
      jsonb_build_array(jsonb_build_object('item_name', 'Widget', 'quantity', 1, 'rate', 100, 'discount', 0, 'tax_percentage', 15)),
      v_stale_updated_at,  -- deliberately the PRE-7a timestamp, now stale
      1, false
    );
    raise exception 'TEST 7b FAILED: stale concurrency token was accepted';
  exception
    when others then
      if sqlerrm not like 'INVOICE_STALE_VERSION%' then
        raise exception 'TEST 7b FAILED: wrong error raised: %', sqlerrm;
      end if;
      raise notice 'TEST 7b passed: stale token rejected as expected (%)', sqlerrm;
  end;

  raise notice '=== ALL REHEARSAL TESTS PASSED ===';
end $$;
