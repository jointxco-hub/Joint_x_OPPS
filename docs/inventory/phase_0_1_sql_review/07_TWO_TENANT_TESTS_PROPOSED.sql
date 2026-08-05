-- PROPOSED, EXECUTABLE TEST - DO NOT RUN WITHOUT OWNER AUTHORIZATION.
-- Run only in a disposable Supabase database after proposed files 03-06.
-- This follows the repository pattern: disposable auth users/tenants, JWT claim
-- switching, DO assertions, and explicit role checks. The transaction rolls back.
-- Confirmed remote requirement: suppliers requires type in addition to id, tenant_id, and name.

begin;
set local statement_timeout = '120s';

-- Fixed disposable identifiers make assertions readable. Abort on collision.
do $$
declare
  v_ids uuid[] := array[
    '91000000-0000-4000-8000-000000000001'::uuid,
    '91000000-0000-4000-8000-000000000002'::uuid,
    '91000000-0000-4000-8000-000000000011'::uuid,
    '91000000-0000-4000-8000-000000000012'::uuid,
    '91000000-0000-4000-8000-000000000013'::uuid
  ];
begin
  if exists (select 1 from public.tenants where id = any(v_ids))
     or exists (select 1 from auth.users where id = any(v_ids)) then
    raise exception 'Disposable Phase 1 test IDs already exist.';
  end if;
end;
$$;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'inventory-phase1-owner-a@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('91000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'inventory-phase1-member-a@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('91000000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'inventory-phase1-owner-b@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.tenants (id, slug, name, status) values
  ('91000000-0000-4000-8000-000000000001', 'inventory-phase1-a', 'Inventory Phase 1 Tenant A', 'active'),
  ('91000000-0000-4000-8000-000000000002', 'inventory-phase1-b', 'Inventory Phase 1 Tenant B', 'active');

insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status) values
  ('91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', 'owner', 'active'),
  ('91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000012', 'member', 'active'),
  ('91000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000013', 'owner', 'active');

insert into public.suppliers (id, tenant_id, name, type) values
  ('91000000-0000-4000-8000-000000000101', '91000000-0000-4000-8000-000000000001', 'Phase 1 Supplier A', 'blanks'),
  ('91000000-0000-4000-8000-000000000102', '91000000-0000-4000-8000-000000000002', 'Phase 1 Supplier B', 'blanks');

insert into public.inventory (
  id, tenant_id, name, sku, category, current_stock, unit,
  sizes_available, colors_available, cost_price, preferred_supplier_id, location
) values
  ('91000000-0000-4000-8000-000000000201', '91000000-0000-4000-8000-000000000001',
   'Daniel Slaves 220gsm Tee Black XL', 'PHASE1-LEGACY-A', 'tees', 12, 'pieces',
   array['XL'], array['Black'], 110, '91000000-0000-4000-8000-000000000101', 'Main'),
  ('91000000-0000-4000-8000-000000000202', '91000000-0000-4000-8000-000000000002',
   'Tenant B 220gsm Tee Black XL', 'PHASE1-LEGACY-B', 'tees', 9, 'pieces',
   array['XL'], array['Black'], 120, '91000000-0000-4000-8000-000000000102', 'Main');

-- Tenant A owner creates Tenant A identity rows through proposed grants/RLS.
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claim.email', 'inventory-phase1-owner-a@example.test', true);

insert into public.inventory_products (id, tenant_id, internal_code, internal_name, garment_type, weight_gsm)
values ('91000000-0000-4000-8000-000000000301', '91000000-0000-4000-8000-000000000001', 'JET', 'Joint X Essential Tee', 'tee', 220);

insert into public.inventory_variants (
  id, tenant_id, inventory_product_id, internal_sku, colour_name, size_name
) values (
  '91000000-0000-4000-8000-000000000401', '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000301', 'JET-BLK-XL', 'Black', 'XL'
);

insert into public.inventory_supplier_products (
  id, tenant_id, inventory_product_id, supplier_id,
  official_product_code, official_product_name, compatibility_status
) values (
  '91000000-0000-4000-8000-000000000501', '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000301', '91000000-0000-4000-8000-000000000101',
  'DS-220', 'Daniel Slaves 220gsm Tee', 'exact'
);

insert into public.inventory_supplier_variants (
  id, tenant_id, inventory_supplier_product_id, inventory_variant_id,
  supplier_sku, official_colour_name, official_size_name, unit_cost
) values (
  '91000000-0000-4000-8000-000000000601', '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000501', '91000000-0000-4000-8000-000000000401',
  'DS-220-BLK-XL', 'Black', 'XL', 110
);

-- Same internal code and same supplier SKU text are independently valid in B.
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000013', true);
select set_config('request.jwt.claim.email', 'inventory-phase1-owner-b@example.test', true);

insert into public.inventory_products (id, tenant_id, internal_code, internal_name, garment_type, weight_gsm)
values ('91000000-0000-4000-8000-000000000302', '91000000-0000-4000-8000-000000000002', 'JET', 'Tenant B Essential Tee', 'tee', 220);

insert into public.inventory_variants (
  id, tenant_id, inventory_product_id, internal_sku, colour_name, size_name
) values (
  '91000000-0000-4000-8000-000000000402', '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000302', 'JET-BLK-XL', 'Black', 'XL'
);

insert into public.inventory_supplier_products (
  id, tenant_id, inventory_product_id, supplier_id,
  official_product_code, official_product_name, compatibility_status
) values (
  '91000000-0000-4000-8000-000000000502', '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000302', '91000000-0000-4000-8000-000000000102',
  'DS-220', 'Tenant B 220gsm Tee', 'exact'
);

insert into public.inventory_supplier_variants (
  id, tenant_id, inventory_supplier_product_id, inventory_variant_id,
  supplier_sku, official_colour_name, official_size_name, unit_cost
) values (
  '91000000-0000-4000-8000-000000000602', '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000502', '91000000-0000-4000-8000-000000000402',
  'DS-220-BLK-XL', 'Black', 'XL', 120
);

-- Tenant A direct reads and search cannot see B.
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claim.email', 'inventory-phase1-owner-a@example.test', true);

do $$
begin
  if (select count(*) from public.inventory_products) <> 1
     or exists (select 1 from public.inventory_products where id = '91000000-0000-4000-8000-000000000302') then
    raise exception 'Tenant A product isolation failed.';
  end if;
  if (select count(*) from public.inventory_variants) <> 1
     or exists (select 1 from public.inventory_variants where id = '91000000-0000-4000-8000-000000000402') then
    raise exception 'Tenant A variant isolation failed.';
  end if;
  if (select count(*) from public.inventory_supplier_products) <> 1
     or exists (select 1 from public.inventory_supplier_products where id = '91000000-0000-4000-8000-000000000502') then
    raise exception 'Tenant A supplier-product isolation failed.';
  end if;
  if (select count(*) from public.inventory_supplier_variants) <> 1
     or exists (select 1 from public.inventory_supplier_variants where id = '91000000-0000-4000-8000-000000000602') then
    raise exception 'Tenant A supplier-variant isolation failed.';
  end if;
  if not exists (select 1 from public.search_inventory_phase1('91000000-0000-4000-8000-000000000001', 'JET', 100))
     or exists (
       select 1 from public.search_inventory_phase1('91000000-0000-4000-8000-000000000002', 'JET', 100)
     ) then
    raise exception 'Tenant-scoped search isolation failed.';
  end if;
end;
$$;

-- Cross-tenant parents and within-tenant duplicate internal codes are rejected.
do $$
begin
  begin
    insert into public.inventory_variants (
      tenant_id, inventory_product_id, internal_sku, colour_name, size_name
    ) values (
      '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000302',
      'PHASE1-CROSS-PARENT', 'Black', 'M'
    );
    raise exception 'Cross-tenant internal product parent was accepted.';
  exception when foreign_key_violation or insufficient_privilege or check_violation then
    null;
  end;

  begin
    insert into public.inventory_products (tenant_id, internal_code, internal_name)
    values ('91000000-0000-4000-8000-000000000001', 'jet', 'Duplicate JET');
    raise exception 'Case-insensitive JET duplicate was accepted within Tenant A.';
  exception when unique_violation then
    null;
  end;

  begin
    insert into public.inventory_supplier_variants (
      tenant_id, inventory_supplier_product_id, inventory_variant_id,
      supplier_sku, official_colour_name, official_size_name
    ) values (
      '91000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000501',
      '91000000-0000-4000-8000-000000000401',
      'ds-220-blk-xl', 'Black', 'XL'
    );
    raise exception 'Case-insensitive supplier SKU duplicate was accepted in one supplier product.';
  exception when unique_violation then
    null;
  end;
end;
$$;

-- Stage mappings through the service/import boundary and test validation.
reset role;
set local role service_role;

do $$
begin
  begin
    perform public.inventory_stage_legacy_mapping(
      null, '91000000-0000-4000-8000-000000000201',
      '91000000-0000-4000-8000-000000000701', 'test-v1', 'missing-tenant'
    );
    raise exception 'Service/import function accepted a missing tenant.';
  exception when not_null_violation or null_value_not_allowed then
    null;
  end;
end;
$$;

select public.inventory_stage_legacy_mapping(
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000201',
  '91000000-0000-4000-8000-000000000701',
  'test-v1', 'phase1-map-a', 0.95,
  '[{"source":"test"}]'::jsonb, '{}',
  '91000000-0000-4000-8000-000000000301',
  '91000000-0000-4000-8000-000000000401',
  '91000000-0000-4000-8000-000000000501',
  '91000000-0000-4000-8000-000000000601'
);

select public.inventory_stage_legacy_mapping(
  '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000202',
  '91000000-0000-4000-8000-000000000702',
  'test-v1', 'phase1-map-b', 0.95,
  '[{"source":"test"}]'::jsonb, '{}',
  '91000000-0000-4000-8000-000000000302',
  '91000000-0000-4000-8000-000000000402',
  '91000000-0000-4000-8000-000000000502',
  '91000000-0000-4000-8000-000000000602'
);

do $$
begin
  begin
    perform public.inventory_stage_legacy_mapping(
      '91000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000201',
      '91000000-0000-4000-8000-000000000701',
      'test-v1', 'phase1-map-a'
    );
    raise exception 'Duplicate mapping idempotency key was accepted.';
  exception when unique_violation then
    null;
  end;
end;
$$;

-- Ordinary Tenant A member can read A mapping but cannot approve it.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000012', true);
select set_config('request.jwt.claim.email', 'inventory-phase1-member-a@example.test', true);

do $$
declare v_mapping_id uuid;
begin
  select id into v_mapping_id from public.inventory_legacy_mappings where idempotency_key = 'phase1-map-a';
  if v_mapping_id is null or exists (select 1 from public.inventory_legacy_mappings where idempotency_key = 'phase1-map-b') then
    raise exception 'Mapping-review read isolation failed.';
  end if;
  begin
    perform public.inventory_decide_legacy_mapping(
      '91000000-0000-4000-8000-000000000001', v_mapping_id, 'approved', 'unauthorized',
      '91000000-0000-4000-8000-000000000301',
      '91000000-0000-4000-8000-000000000401',
      '91000000-0000-4000-8000-000000000501',
      '91000000-0000-4000-8000-000000000601'
    );
    raise exception 'Ordinary member approved a mapping.';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- Tenant A owner approves A but cannot decide B.
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claim.email', 'inventory-phase1-owner-a@example.test', true);

do $$
declare v_a uuid;
begin
  select id into v_a from public.inventory_legacy_mappings where idempotency_key = 'phase1-map-a';
  perform public.inventory_decide_legacy_mapping(
    '91000000-0000-4000-8000-000000000001', v_a, 'approved', 'reviewed test mapping',
    '91000000-0000-4000-8000-000000000301',
    '91000000-0000-4000-8000-000000000401',
    '91000000-0000-4000-8000-000000000501',
    '91000000-0000-4000-8000-000000000601'
  );
  if not exists (select 1 from public.inventory_legacy_mappings where id = v_a and review_status = 'approved') then
    raise exception 'Authorized Tenant A owner could not approve Tenant A mapping.';
  end if;

  begin
    perform public.inventory_decide_legacy_mapping(
      '91000000-0000-4000-8000-000000000002',
      '91000000-0000-4000-8000-000000000999',
      'deferred', 'cross-tenant attempt'
    );
    raise exception 'Tenant A owner decided Tenant B mapping.';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- Approved mappings cannot be overwritten; a correction becomes version 2.
select public.inventory_create_mapping_revision(
  '91000000-0000-4000-8000-000000000001',
  (select id from public.inventory_legacy_mappings where idempotency_key = 'phase1-map-a'),
  '91000000-0000-4000-8000-000000000703',
  'phase1-map-a-revision'
);

do $$
declare v_original record; v_revision record;
begin
  select * into v_original
  from public.inventory_legacy_mappings
  where idempotency_key = 'phase1-map-a';

  select * into v_revision
  from public.inventory_legacy_mappings
  where idempotency_key = 'phase1-map-a-revision';

  if v_revision.mapping_version <> 2
     or v_revision.review_status <> 'suggested'
     or v_revision.original_name is distinct from v_original.original_name
     or v_revision.original_recorded_quantity is distinct from v_original.original_recorded_quantity then
    raise exception 'Mapping revision did not preserve source history as a new suggested version.';
  end if;
end;
$$;

reset role;

do $$
begin
  begin
    update public.inventory_legacy_mappings
    set original_name = 'ILLEGAL SOURCE REWRITE'
    where idempotency_key = 'phase1-map-a';
    raise exception 'Approved source snapshot was overwritten.';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  if (select current_stock from public.inventory where id = '91000000-0000-4000-8000-000000000201') <> 12
     or (select current_stock from public.inventory where id = '91000000-0000-4000-8000-000000000202') <> 9 then
    raise exception 'Mapping review changed legacy current_stock.';
  end if;
end;
$$;

reset role;
-- Anonymous role has neither table nor search-function access.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.email', '', true);

do $$
begin
  begin
    perform count(*) from public.inventory_products;
    raise exception 'Anonymous role read internal products.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.search_inventory_phase1('91000000-0000-4000-8000-000000000001', 'JET', 10);
    raise exception 'Anonymous role executed internal inventory search.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;
