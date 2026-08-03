-- PROPOSED, EXECUTABLE TEST - DO NOT RUN WITHOUT OWNER AUTHORIZATION.
-- Run only in a disposable database after proposed files 03-06.
-- Catalog assertions plus read-only legacy invariants; no persistent changes.

begin;
set transaction read only;
set local statement_timeout = '60s';

do $$
declare
  v_legacy_rows_before bigint;
  v_legacy_quantity_before numeric;
  v_legacy_rows_after bigint;
  v_legacy_quantity_after numeric;
begin
  select count(*), coalesce(sum(current_stock), 0)
    into v_legacy_rows_before, v_legacy_quantity_before
  from public.inventory;

  -- Required columns and NOT NULL rules.
  if exists (
    select 1
    from (values
      ('inventory_products', 'tenant_id'),
      ('inventory_products', 'internal_code'),
      ('inventory_products', 'internal_name'),
      ('inventory_variants', 'tenant_id'),
      ('inventory_variants', 'inventory_product_id'),
      ('inventory_variants', 'internal_sku'),
      ('inventory_supplier_products', 'tenant_id'),
      ('inventory_supplier_products', 'supplier_id'),
      ('inventory_supplier_variants', 'tenant_id'),
      ('inventory_supplier_variants', 'supplier_sku'),
      ('inventory_legacy_mappings', 'tenant_id'),
      ('inventory_legacy_mappings', 'legacy_inventory_id'),
      ('inventory_legacy_mappings', 'original_name'),
      ('inventory_legacy_mappings', 'mapping_version'),
      ('inventory_legacy_mappings', 'batch_id'),
      ('inventory_legacy_mappings', 'idempotency_key')
    ) required(table_name, column_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = required.table_name
        and c.column_name = required.column_name
        and c.is_nullable = 'NO'
    )
  ) then
    raise exception 'One or more required Phase 1 fields are missing or nullable.';
  end if;

  -- Internal identity objects must never acquire physical balance fields.
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('inventory_products', 'inventory_variants')
      and c.column_name ~* '(current_stock|on_hand|available|reserved|quantity|balance)'
  ) then
    raise exception 'Internal product/variant table contains a prohibited physical balance field.';
  end if;

  -- Internal and supplier SKU identities are structurally separate.
  if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'inventory_variants' and column_name = 'internal_sku'
    )
    or exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'inventory_variants' and column_name = 'supplier_sku'
    )
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'inventory_supplier_variants' and column_name = 'supplier_sku'
    )
    or exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'inventory_supplier_variants' and column_name = 'internal_sku'
    ) then
    raise exception 'Internal and supplier SKU storage is not separated.';
  end if;

  -- Every proposed parent FK on Phase 1 tables must include tenant_id.
  if exists (
    select 1
    from pg_constraint con
    join pg_class child on child.oid = con.conrelid
    join pg_namespace n on n.oid = child.relnamespace
    where n.nspname = 'public'
      and child.relname in (
        'inventory_variants', 'inventory_supplier_products',
        'inventory_supplier_variants', 'inventory_legacy_mappings'
      )
      and con.contype = 'f'
      and not exists (
        select 1
        from unnest(con.conkey) child_key(attnum)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = child_key.attnum
        where a.attname = 'tenant_id'
      )
      and pg_get_constraintdef(con.oid) ~ 'inventory_(products|variants|supplier_products|supplier_variants)'
  ) then
    raise exception 'A Phase 1 parent relationship is not tenant-safe.';
  end if;

  -- Case-insensitive uniqueness indexes must exist for key identities.
  if not exists (
      select 1 from pg_indexes where schemaname = 'public'
        and indexname = 'inventory_products_tenant_internal_code_uq'
        and indexdef ilike '%unique%lower%internal_code%'
    )
    or not exists (
      select 1 from pg_indexes where schemaname = 'public'
        and indexname = 'inventory_variants_tenant_internal_sku_uq'
        and indexdef ilike '%unique%lower%internal_sku%'
    )
    or not exists (
      select 1 from pg_indexes where schemaname = 'public'
        and indexname = 'inventory_supplier_variants_supplier_sku_uq'
        and indexdef ilike '%unique%lower%supplier_sku%'
    ) then
    raise exception 'Required case-insensitive identity uniqueness is missing.';
  end if;

  -- Mapping approval, status, version, and source-history protections exist.
  if not exists (
      select 1 from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      where c.oid = 'public.inventory_legacy_mappings'::regclass
        and con.conname = 'inventory_legacy_mappings_approval_targets_check'
    )
    or not exists (
      select 1 from pg_constraint con
      where con.conrelid = 'public.inventory_legacy_mappings'::regclass
        and con.conname = 'inventory_legacy_mappings_source_version_uq'
    )
    or not exists (
      select 1 from pg_trigger
      where tgrelid = 'public.inventory_legacy_mappings'::regclass
        and tgname = 'inventory_legacy_mappings_protect_history'
        and not tgisinternal
    ) then
    raise exception 'Mapping approval/version/history protection is incomplete.';
  end if;

  -- Internal Phase 1 functions must not inherit EXECUTE through PUBLIC, and
  -- anonymous users must not be able to execute them through any grant path.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where n.nspname = 'public'
      and p.proname in (
        'inventory_phase1_touch_updated_at',
        'inventory_phase1_validate_supplier_product',
        'inventory_phase1_validate_supplier_variant',
        'inventory_phase1_protect_mapping_history',
        'inventory_stage_legacy_mapping',
        'search_inventory_phase1',
        'inventory_can_review_tenant',
        'inventory_decide_legacy_mapping',
        'inventory_create_mapping_revision'
      )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) or exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'inventory_phase1_touch_updated_at',
        'inventory_phase1_validate_supplier_product',
        'inventory_phase1_validate_supplier_variant',
        'inventory_phase1_protect_mapping_history',
        'inventory_stage_legacy_mapping',
        'search_inventory_phase1',
        'inventory_can_review_tenant',
        'inventory_decide_legacy_mapping',
        'inventory_create_mapping_revision'
      )
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'PUBLIC or anon can execute an internal Phase 1 function.';
  end if;
  -- RLS is mandatory on every proposed base table.
  if exists (
    select 1
    from (values
      ('inventory_products'), ('inventory_variants'),
      ('inventory_supplier_products'), ('inventory_supplier_variants'),
      ('inventory_legacy_mappings')
    ) expected(table_name)
    left join pg_class c on c.oid = to_regclass('public.' || expected.table_name)
    where c.oid is null or not c.relrowsecurity
  ) then
    raise exception 'RLS is missing from one or more Phase 1 tables.';
  end if;

  -- No Phase 1 trigger may have been attached to the legacy inventory table.
  if exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.inventory'::regclass
      and not t.tgisinternal
      and p.proname like 'inventory_phase1%'
  ) then
    raise exception 'A Phase 1 trigger was attached to public.inventory.';
  end if;

  -- Compatibility model must be a separate read model and retain current_stock
  -- as a column selected from public.inventory.
  if to_regclass('public.inventory_legacy_compat_v') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'inventory_legacy_compat_v'
         and column_name = 'current_stock'
     ) then
    raise exception 'Legacy compatibility comparison model is missing.';
  end if;

  select count(*), coalesce(sum(current_stock), 0)
    into v_legacy_rows_after, v_legacy_quantity_after
  from public.inventory;

  if v_legacy_rows_after <> v_legacy_rows_before
     or v_legacy_quantity_after is distinct from v_legacy_quantity_before then
    raise exception 'Legacy inventory row count or current_stock total changed during integrity checks.';
  end if;
end;
$$;

rollback;
