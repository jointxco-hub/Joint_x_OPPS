-- Run after 202606270008_tenant_storefront_catalog_backend.sql.
-- Uses disposable tenants, storefront hosts, and product rows.

do $$
declare
  tenant_a_id uuid;
  tenant_b_id uuid;
  result jsonb;
  product_row jsonb;
  unexpected_key text;
begin
  delete from public.products
  where code like 'PHASE5B-%';

  delete from public.tenant_domains
  where hostname in (
    'phase5b-catalog-a.xlab.jointx.co.za',
    'phase5b-catalog-b.xlab.jointx.co.za',
    'phase5b-catalog-a.xos.jointx.co.za',
    'phase5b-catalog-a-track.xlab.jointx.co.za'
  );

  delete from public.tenants
  where slug in ('phase5b-catalog-a', 'phase5b-catalog-b');

  insert into public.tenants (slug, name, status)
  values
    ('phase5b-catalog-a', 'Phase 5B Catalog Tenant A', 'active'),
    ('phase5b-catalog-b', 'Phase 5B Catalog Tenant B', 'active');

  select id into tenant_a_id from public.tenants where slug = 'phase5b-catalog-a';
  select id into tenant_b_id from public.tenants where slug = 'phase5b-catalog-b';

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at)
  values
    (tenant_a_id, 'phase5b-catalog-a.xlab.jointx.co.za', 'storefront', 'active', true, now()),
    (tenant_b_id, 'phase5b-catalog-b.xlab.jointx.co.za', 'storefront', 'active', true, now()),
    (tenant_a_id, 'phase5b-catalog-a.xos.jointx.co.za', 'xos_admin', 'active', false, now()),
    (tenant_a_id, 'phase5b-catalog-a-track.xlab.jointx.co.za', 'public_tracking', 'active', false, now());

  insert into public.products (
    tenant_id,
    name,
    description,
    category,
    price,
    image_url,
    images,
    status,
    store_visible,
    is_archived,
    display_order,
    code,
    gsm,
    material,
    addons,
    print_options
  )
  values
    (
      tenant_a_id,
      'PHASE5B Shared Product',
      'Tenant A storefront product',
      'tshirts',
      101,
      'https://example.test/a-product.jpg',
      jsonb_build_array('https://example.test/a-gallery.jpg', 'private-upload://uploads/' || tenant_a_id::text || '/hidden-private.png'),
      'active',
      true,
      false,
      1,
      'PHASE5B-A-SHARED',
      '180gsm',
      'Cotton',
      '[{"name":"Public addon","price":10,"cost":1,"margin":9}]'::jsonb,
      '[{"name":"Public print","type":"dtf","price":20,"cost":2,"locations":["Front"],"supplier":"Hidden Supplier"}]'::jsonb
    ),
    (
      tenant_b_id,
      'PHASE5B Shared Product',
      'Tenant B storefront product',
      'hoodies',
      202,
      'https://example.test/b-product.jpg',
      '[]'::jsonb,
      'active',
      true,
      false,
      1,
      'PHASE5B-B-SHARED',
      '320gsm',
      'Fleece',
      '[]'::jsonb,
      '[]'::jsonb
    ),
    (
      tenant_a_id,
      'PHASE5B Hidden Product',
      'Should not be visible',
      'hidden',
      303,
      'https://example.test/hidden.jpg',
      '[]'::jsonb,
      'active',
      false,
      false,
      2,
      'PHASE5B-A-HIDDEN',
      null,
      null,
      '[]'::jsonb,
      '[]'::jsonb
    ),
    (
      tenant_a_id,
      'PHASE5B Draft Product',
      'Should not be visible',
      'draft',
      404,
      'https://example.test/draft.jpg',
      '[]'::jsonb,
      'draft',
      true,
      false,
      3,
      'PHASE5B-A-DRAFT',
      null,
      null,
      '[]'::jsonb,
      '[]'::jsonb
    ),
    (
      tenant_a_id,
      'PHASE5B Archived Product',
      'Should not be visible',
      'archived',
      505,
      'https://example.test/archived.jpg',
      '[]'::jsonb,
      'active',
      true,
      true,
      4,
      'PHASE5B-A-ARCHIVED',
      null,
      null,
      '[]'::jsonb,
      '[]'::jsonb
    ),
    (
      tenant_a_id,
      'PHASE5B Private Image Product',
      'Private image should be stripped',
      'files',
      606,
      'private-upload://uploads/' || tenant_a_id::text || '/private-product.png',
      jsonb_build_array('private-upload://uploads/' || tenant_a_id::text || '/private-gallery.png'),
      'active',
      true,
      false,
      5,
      'PHASE5B-A-PRIVATE-IMAGE',
      null,
      null,
      '[]'::jsonb,
      '[]'::jsonb
    );

  result := public.get_storefront_catalog_for_host('phase5b-catalog-a.xlab.jointx.co.za', 20);
  if jsonb_array_length(result) <> 2 then
    raise exception 'Tenant A storefront catalog should return exactly two visible products, got %.', jsonb_array_length(result);
  end if;

  if result::text like '%Tenant B storefront product%'
    or result::text like '%PHASE5B-B-SHARED%'
    or result::text like '%Hidden Product%'
    or result::text like '%Draft Product%'
    or result::text like '%Archived Product%'
  then
    raise exception 'Tenant A storefront catalog exposed cross-tenant or non-visible products.';
  end if;

  result := public.get_storefront_catalog_for_host('phase5b-catalog-b.xlab.jointx.co.za', 20);
  if jsonb_array_length(result) <> 1
    or result->0->>'description' <> 'Tenant B storefront product'
  then
    raise exception 'Same product name did not resolve according to Tenant B host.';
  end if;

  if jsonb_array_length(public.get_storefront_catalog_for_host('unknown.example.test', 20)) <> 0
    or jsonb_array_length(public.get_storefront_catalog_for_host('https://phase5b-catalog-a.xlab.jointx.co.za/shop', 20)) <> 0
    or jsonb_array_length(public.get_storefront_catalog_for_host('phase5b-catalog-a.xlab.jointx.co.za:443', 20)) <> 0
    or jsonb_array_length(public.get_storefront_catalog_for_host('phase5b-catalog-a.xlab.jointx.co.za.', 20)) <> 0
    or jsonb_array_length(public.get_storefront_catalog_for_host('phase5b-catalog-a.xlab.jointx.co.za?tenant_slug=phase5b-catalog-b', 20)) <> 0
  then
    raise exception 'Unknown or malformed storefront host returned catalog rows.';
  end if;

  if jsonb_array_length(public.get_storefront_catalog_for_host('phase5b-catalog-a.xos.jointx.co.za', 20)) <> 0
    or jsonb_array_length(public.get_storefront_catalog_for_host('phase5b-catalog-a-track.xlab.jointx.co.za', 20)) <> 0
  then
    raise exception 'Non-storefront surface returned storefront catalog rows.';
  end if;

  result := public.get_storefront_catalog_for_host('phase5b-catalog-a.xlab.jointx.co.za', 20);

  select key into unexpected_key
  from jsonb_array_elements(result) product_item(value)
  cross join lateral jsonb_object_keys(product_item.value) payload(key)
  where key not in (
    'id',
    'name',
    'description',
    'category',
    'price',
    'image_url',
    'images',
    'code',
    'gsm',
    'material',
    'videos',
    'addons',
    'print_options',
    'display_order'
  )
  limit 1;

  if unexpected_key is not null then
    raise exception 'Storefront catalog payload exposed unexpected key: %', unexpected_key;
  end if;

  if result::text like '%tenant_id%'
    or result::text like '%supplier%'
    or result::text like '%cost%'
    or result::text like '%margin%'
    or result::text like '%purchase%'
    or result::text like '%inventory%'
    or result::text like '%opps%'
    or result::text like '%notes%'
    or result::text like '%private-upload://%'
    or result::text like '%/storage/v1/object/sign/uploads/%'
  then
    raise exception 'Storefront catalog payload exposed protected internal fields or private paths.';
  end if;

  for product_row in select value from jsonb_array_elements(result)
  loop
    if product_row ? 'tenant_id' then
      raise exception 'Storefront catalog product exposed tenant_id.';
    end if;
  end loop;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'products'
      and roles::text like '%anon%'
  ) then
    raise exception 'Products still have an anonymous direct select policy.';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'products'
      and qual = 'true'
  ) then
    raise exception 'Products still have a broad true RLS policy.';
  end if;

  if not has_function_privilege('anon', 'public.get_storefront_catalog_for_host(text,int)', 'execute') then
    raise exception 'Anon cannot execute host-aware storefront catalog RPC.';
  end if;

  if pg_get_function_arguments('public.get_storefront_catalog_for_host(text,int)'::regprocedure) like '%tenant%' then
    raise exception 'Storefront catalog RPC must not accept browser-supplied tenant parameters.';
  end if;

  delete from public.products
  where code like 'PHASE5B-%';

  delete from public.tenant_domains
  where hostname in (
    'phase5b-catalog-a.xlab.jointx.co.za',
    'phase5b-catalog-b.xlab.jointx.co.za',
    'phase5b-catalog-a.xos.jointx.co.za',
    'phase5b-catalog-a-track.xlab.jointx.co.za'
  );

  delete from public.tenants
  where slug in ('phase5b-catalog-a', 'phase5b-catalog-b');
end;
$$;
