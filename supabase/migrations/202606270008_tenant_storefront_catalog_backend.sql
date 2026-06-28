-- Phase 5B tenant-aware storefront catalog backend.
-- Public storefront catalog reads resolve tenant from hostname only.

create or replace function public.resolve_public_storefront_tenant(p_hostname text)
returns table (
  tenant_slug text,
  tenant_name text,
  hostname text
)
language sql
security definer
stable
set search_path = public
as $$
  select tenant.slug, tenant.name, domain_row.hostname
  from public.tenant_domains domain_row
  join public.tenants tenant on tenant.id = domain_row.tenant_id
  where domain_row.hostname = public.normalize_tenant_hostname(p_hostname)
    and domain_row.surface = 'storefront'
    and domain_row.status = 'active'
    and tenant.status = 'active'
  limit 1;
$$;

create or replace function public.get_storefront_catalog_for_host(
  p_hostname text,
  p_limit int default 100
)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with limit_input as (
    select least(greatest(coalesce(p_limit, 100), 1), 100) as row_limit
  ),
  resolved_tenant as (
    select domain_row.tenant_id
    from public.tenant_domains domain_row
    join public.tenants tenant on tenant.id = domain_row.tenant_id
    where domain_row.hostname = public.normalize_tenant_hostname(p_hostname)
      and domain_row.surface = 'storefront'
      and domain_row.status = 'active'
      and tenant.status = 'active'
    limit 1
  ),
  storefront_products as (
    select p.*
    from resolved_tenant
    join public.products p on p.tenant_id = resolved_tenant.tenant_id
    where coalesce(p.is_archived, false) = false
      and coalesce(p.store_visible, true) = true
      and lower(coalesce(p.status, 'active')) in ('active', 'published')
    order by coalesce(p.display_order, 2147483647), lower(p.name), p.created_at desc
    limit (select row_limit from limit_input)
  )
  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', product_row.id,
      'name', product_row.name,
      'description', product_row.description,
      'category', product_row.category,
      'price', product_row.price,
      'image_url',
        case
          when product_row.image_url ilike 'private-upload://%' then null
          when product_row.image_url ilike '%/storage/v1/object/sign/uploads/%' then null
          else product_row.image_url
        end,
      'images',
        coalesce((
          select jsonb_agg(image_item.value)
          from jsonb_array_elements(coalesce(product_row.images, '[]'::jsonb)) as image_item(value)
          where image_item.value::text not ilike '%private-upload://%'
            and image_item.value::text not ilike '%/storage/v1/object/sign/uploads/%'
        ), '[]'::jsonb),
      'code', product_row.code,
      'gsm', product_row.gsm,
      'material', product_row.material,
      'videos', coalesce(product_row.videos, '[]'::jsonb),
      'addons',
        coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'name', addon_item.value->>'name',
            'price',
              case
                when (addon_item.value->>'price') ~ '^-?[0-9]+(\.[0-9]+)?$'
                  then (addon_item.value->>'price')::numeric
                else null
              end
          )))
          from jsonb_array_elements(coalesce(product_row.addons, '[]'::jsonb)) as addon_item(value)
          where addon_item.value ? 'name'
        ), '[]'::jsonb),
      'print_options',
        coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'name', print_item.value->>'name',
            'type', print_item.value->>'type',
            'price',
              case
                when (print_item.value->>'price') ~ '^-?[0-9]+(\.[0-9]+)?$'
                  then (print_item.value->>'price')::numeric
                else null
              end,
            'locations', coalesce(print_item.value->'locations', '[]'::jsonb)
          )))
          from jsonb_array_elements(coalesce(product_row.print_options, '[]'::jsonb)) as print_item(value)
          where print_item.value ? 'name'
        ), '[]'::jsonb),
      'display_order', product_row.display_order
    ))
  ), '[]'::jsonb)
  from storefront_products product_row;
$$;

revoke all on function public.resolve_public_storefront_tenant(text) from public, anon, authenticated;
revoke all on function public.get_storefront_catalog_for_host(text, int) from public, anon, authenticated;
grant execute on function public.resolve_public_storefront_tenant(text) to anon, authenticated;
grant execute on function public.get_storefront_catalog_for_host(text, int) to anon, authenticated;

alter table public.products enable row level security;

drop policy if exists "Public can select products" on public.products;
drop policy if exists "Authenticated can select products" on public.products;
drop policy if exists "Authenticated can insert products" on public.products;
drop policy if exists "Authenticated can update products" on public.products;
drop policy if exists "Authenticated can delete products" on public.products;
drop policy if exists tenant_manage_products on public.products;

create policy tenant_manage_products
  on public.products
  for all
  to authenticated
  using (public.is_app_admin() or public.can_access_tenant(tenant_id))
  with check (public.is_app_admin() or public.can_access_tenant(tenant_id));

do $$
declare
  demo_tenant_id uuid;
begin
  select id into demo_tenant_id
  from public.tenants
  where slug = 'demo-xos';

  if demo_tenant_id is null then
    insert into public.tenants (slug, name, status)
    values ('demo-xos', 'DEMO-XOS Workspace', 'active')
    returning id into demo_tenant_id;
  end if;

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at)
  values (demo_tenant_id, 'demo.xlab.jointx.co.za', 'storefront', 'active', true, now())
  on conflict (hostname, surface) do update
  set tenant_id = excluded.tenant_id,
      status = excluded.status,
      is_primary = excluded.is_primary,
      verified_at = coalesce(public.tenant_domains.verified_at, excluded.verified_at);

  delete from public.products
  where tenant_id = demo_tenant_id
    and code in ('DEMO-XOS-TEE', 'DEMO-XOS-HOODIE', 'DEMO-XOS-CAP', 'DEMO-XOS-TOTE');

  insert into public.products (
    tenant_id,
    name,
    description,
    category,
    price,
    image_url,
    status,
    store_visible,
    display_order,
    code,
    gsm,
    material,
    addons,
    print_options
  )
  values
    (
      demo_tenant_id,
      'DEMO-XOS Launch Tee',
      'Disposable demo storefront T-shirt for tenant-scoped catalog testing.',
      'tshirts',
      180,
      'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800',
      'active',
      true,
      10,
      'DEMO-XOS-TEE',
      '180gsm',
      'Cotton',
      '[{"name":"Neck label","price":20}]'::jsonb,
      '[{"name":"DTF Front","type":"dtf","price":120,"locations":["Front"]}]'::jsonb
    ),
    (
      demo_tenant_id,
      'DEMO-XOS Studio Hoodie',
      'Disposable demo storefront hoodie for tenant-scoped catalog testing.',
      'hoodies',
      420,
      'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=800',
      'active',
      true,
      20,
      'DEMO-XOS-HOODIE',
      '320gsm',
      'Cotton fleece',
      '[{"name":"Swing tag","price":15}]'::jsonb,
      '[{"name":"Embroidery","type":"embroidery","price":150,"locations":["Left Chest"]}]'::jsonb
    ),
    (
      demo_tenant_id,
      'DEMO-XOS Campaign Cap',
      'Disposable demo storefront cap for tenant-scoped catalog testing.',
      'hats',
      140,
      'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=800',
      'active',
      true,
      30,
      'DEMO-XOS-CAP',
      null,
      'Cotton twill',
      '[]'::jsonb,
      '[{"name":"Embroidery","type":"embroidery","price":95,"locations":["Front"]}]'::jsonb
    ),
    (
      demo_tenant_id,
      'DEMO-XOS Event Tote',
      'Disposable demo storefront tote bag for tenant-scoped catalog testing.',
      'bags',
      95,
      'https://images.unsplash.com/photo-1597484662317-9bd7bdda2907?w=800',
      'published',
      true,
      40,
      'DEMO-XOS-TOTE',
      null,
      'Canvas',
      '[]'::jsonb,
      '[{"name":"Screen Print","type":"screen","price":80,"locations":["Front"]}]'::jsonb
    );
end;
$$;
