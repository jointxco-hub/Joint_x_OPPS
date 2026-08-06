-- ============================================================================
-- DISPOSABLE TEST SCAFFOLD - NOT PRODUCTION SCHEMA - NOT PRODUCTION-READY
-- ============================================================================
--
-- This file exists ONLY to let a local, disposable Postgres/Supabase stack
-- run the quote-approval integration test
-- (supabase/tests/quote_approval_local_integration.sql) and the manual
-- browser checklist (docs/QUOTE_APPROVAL_MANUAL_BROWSER_CHECKLIST.md) for
-- recovery/xlab-quote-approval, entirely offline.
--
-- It is NOT the real production schema. It is NOT authoritative. It must
-- NEVER be applied to any shared, staging, or production database. Apply it
-- only to a disposable local container you created for this purpose (see
-- the "Recreate the local stack from scratch" section of the manual
-- checklist for the exact commands).
--
-- WHY THIS FILE EXISTS:
-- The real objects it reconstructs - public.xlab_orders, public.xlab_payments,
-- public.create_checkout_order(jsonb), public.verify_client_portal_access(text, text) -
-- are referenced throughout X LAB's committed migrations (e.g.
-- 202608050001_quote_approval_and_resource_files.sql calls all four), but
-- their original CREATE TABLE / CREATE FUNCTION statements were NOT FOUND
-- anywhere in version control after searching:
--   - every file under X LAB's supabase/migrations/ (54 files, all of them)
--   - X LAB's schema_new_tables.sql and base44/ directory
--   - this repo's (OPPS) own supabase/migrations/ and
--     src/api/supabase/migrations/
-- The most likely explanation is that these objects were created by a
-- one-off script run directly against the Supabase Dashboard SQL editor at
-- some point before migration tracking was adopted for this part of the
-- schema - the same pattern already found and documented this session for
-- OPPS's own folders/client_assets tables
-- (src/api/supabase/migrations/02_phase2_entities.sql).
--
-- WHAT IS APPROXIMATED VS. REAL:
--   - Column lists for xlab_orders/xlab_payments are inferred from how the
--     real, committed X LAB migrations reference and ALTER them (e.g.
--     202608050001 adds source_quote_request_id to xlab_orders,
--     20260511_xlab_orders_sync_status.sql adds sync_status/sync_error to
--     xlab_orders and synced_to_opps to xlab_payments - none of that would
--     make sense unless the base tables already existed with roughly this
--     shape). This is a best-effort reconstruction, not a verified copy.
--   - create_checkout_order returns jsonb (not a xlab_orders row) because
--     _activate_client_quote_request_order's real, committed code calls
--     jsonb_populate_record(null::xlab_orders, create_checkout_order(...)),
--     which requires a jsonb argument - confirmed empirically by the exact
--     error Postgres raised when this scaffold first returned a row type
--     instead ("cannot change return type of existing function" led to
--     finding the real error: jsonb_populate_record needs jsonb).
--   - verify_client_portal_access here is DELIBERATELY SIMPLIFIED: it only
--     checks that a public.clients row exists with the given email, and
--     ignores p_order_number entirely. The real function almost certainly
--     also validates the order number belongs to that client. This
--     simplification is sufficient to exercise the OPPS-side
--     approval/awaiting-payment RPCs under test, but it is NOT a faithful
--     reproduction of the real client-portal authentication check and must
--     not be treated as one.
--
-- WHAT THIS FILE DOES NOT CONTAIN:
--   - No production URL, hostname, or connection string of any kind.
--   - No API keys, JWT secrets, service-role keys, or anon keys.
--   - No real customer, client, staff, or order records - it defines
--     schema (tables and functions) only, with zero rows of data. All test
--     data is seeded separately and only by
--     supabase/tests/quote_approval_local_integration.sql, using
--     obviously-fake IDs and @*.invalid email addresses (RFC 2606 reserved
--     TLD, guaranteed never a real deliverable domain).
--   - No production identifiers of any kind (tenant IDs, order numbers,
--     etc.) - the one real-looking identifier this scaffold touches is the
--     'joint-x' tenant slug, which is looked up dynamically at seed time
--     from whatever local tenant already has that slug (created by this
--     repo's own 202606200001_multi_tenant_foundation.sql migration, not
--     hardcoded here) - it is a local disposable stack's copy of that
--     tenant, not a live connection to any production tenant.
--
-- ============================================================================

begin;

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_admin()
returns boolean language sql stable as $$
  select public.is_app_admin();
$$;

create table if not exists public.xlab_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_email text,
  customer_name text,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(12,2) default 0,
  total_amount numeric(12,2) not null default 0,
  special_instructions text,
  status text not null default 'pending_payment'
    check (status in ('pending_payment','paid','in_production','shipped','delivered','cancelled')),
  tenant_id uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.xlab_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.xlab_orders(id) on delete cascade,
  order_number text,
  amount numeric(12,2) not null,
  method text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- Returns jsonb (not a xlab_orders row) - see "WHAT IS APPROXIMATED" above.
create or replace function public.create_checkout_order(order_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  new_row public.xlab_orders;
begin
  insert into public.xlab_orders (
    order_number, customer_email, customer_name, items, subtotal, total_amount, special_instructions
  ) values (
    order_payload->>'order_number',
    order_payload->>'customer_email',
    order_payload->>'customer_name',
    coalesce(order_payload->'items', '[]'::jsonb),
    coalesce((order_payload->>'subtotal')::numeric, 0),
    coalesce((order_payload->>'total_amount')::numeric, 0),
    order_payload->>'special_instructions'
  )
  returning * into new_row;
  return to_jsonb(new_row);
end;
$$;

-- DELIBERATELY SIMPLIFIED - see "WHAT IS APPROXIMATED" above. Email match
-- only; p_order_number is accepted but not validated.
create or replace function public.verify_client_portal_access(p_email text, p_order_number text)
returns public.clients
language plpgsql
as $$
declare
  result public.clients;
begin
  select * into result from public.clients where lower(trim(email)) = lower(trim(p_email));
  if result.id is null then
    raise exception 'No matching account found for that email and order number.';
  end if;
  return result;
end;
$$;

commit;

-- ============================================================================
-- End of disposable test scaffold. Again: local/disposable databases only.
-- ============================================================================
