-- Run after 202606240001_host_aware_public_tracking.sql in a disposable or linked QA database.
-- Uses only disposable tenant/domain/order fixtures.

do $$
declare
  joint_tenant_id uuid;
  joint_lookup text;
  tenant_a_id uuid;
  tenant_b_id uuid;
  result jsonb;
  unexpected_key text;
begin
  select id into joint_tenant_id
  from public.tenants
  where slug = 'joint-x'
    and status = 'active';

  if joint_tenant_id is null then
    raise exception 'Joint X tenant is required for public tracking host assertions.';
  end if;

  select order_number into joint_lookup
  from public.orders
  where tenant_id = joint_tenant_id
  order by updated_at desc
  limit 1;

  if joint_lookup is null then
    raise exception 'At least one Joint X order is required for public tracking host assertions.';
  end if;

  if public.get_public_order_tracking_for_host(joint_lookup, 'ops.jointx.co.za') is null then
    raise exception 'ops.jointx.co.za did not resolve Joint X public tracking.';
  end if;

  if public.get_public_order_tracking_for_host(joint_lookup, 'xlab.jointx.co.za') is null then
    raise exception 'xlab.jointx.co.za did not resolve mapped Joint X public tracking.';
  end if;

  if public.get_public_order_tracking_for_host(joint_lookup, 'unknown.example.test') is not null then
    raise exception 'Unknown public tracking host returned an order.';
  end if;

  if public.get_public_order_tracking_for_host(joint_lookup, 'https://ops.jointx.co.za/track') is not null
    or public.get_public_order_tracking_for_host(joint_lookup, 'ops.jointx.co.za:443') is not null
    or public.get_public_order_tracking_for_host(joint_lookup, 'ops.jointx.co.za.') is not null
  then
    raise exception 'Malformed public tracking host returned an order.';
  end if;

  delete from public.orders
  where order_number in ('PHASE2-A-ONLY', 'PHASE2-B-ONLY', 'PHASE2-SAME-001')
    or tracking_number in ('PHASE2-A-TRACK', 'PHASE2-B-TRACK');

  delete from public.tenant_domains
  where hostname in ('phase2-a.example.test', 'phase2-b.example.test');

  delete from public.tenants
  where slug in ('phase2-tracking-a', 'phase2-tracking-b');

  insert into public.tenants (slug, name, status)
  values
    ('phase2-tracking-a', 'Phase 2 Tracking Tenant A', 'active'),
    ('phase2-tracking-b', 'Phase 2 Tracking Tenant B', 'active');

  select id into tenant_a_id from public.tenants where slug = 'phase2-tracking-a';
  select id into tenant_b_id from public.tenants where slug = 'phase2-tracking-b';

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at)
  values
    (tenant_a_id, 'phase2-a.example.test', 'public_tracking', 'active', true, now()),
    (tenant_b_id, 'phase2-b.example.test', 'public_tracking', 'active', true, now());

  insert into public.orders (
    tenant_id,
    client_name,
    order_number,
    status,
    pipeline_stage,
    production_method,
    production_detail_stage,
    production_client_update,
    tracking_number,
    invoice_numbers,
    portal_message,
    portal_show_balance,
    total_amount,
    deposit_paid,
    production_internal_note,
    notes
  )
  values
    (
      tenant_a_id,
      'Phase 2 Tenant A Client',
      'PHASE2-A-ONLY',
      'in_production',
      'pressing',
      'dtf',
      'pressing',
      'Tenant A public update',
      'PHASE2-A-TRACK',
      '["PHASE2-A-INV"]'::jsonb,
      'Tenant A portal message',
      true,
      100,
      25,
      'Tenant A internal hold-up note',
      'Tenant A private order note'
    ),
    (
      tenant_b_id,
      'Phase 2 Tenant B Client',
      'PHASE2-B-ONLY',
      'ready',
      'packing',
      'embroidery',
      'packing',
      'Tenant B public update',
      'PHASE2-B-TRACK',
      '["PHASE2-B-INV"]'::jsonb,
      'Tenant B portal message',
      false,
      200,
      50,
      'Tenant B internal hold-up note',
      'Tenant B private order note'
    ),
    (
      tenant_a_id,
      'Phase 2 Tenant A Same Number',
      'PHASE2-SAME-001',
      'confirmed',
      'artwork_check',
      'screen',
      'artwork_check',
      'Tenant A same-number update',
      null,
      '[]'::jsonb,
      null,
      false,
      0,
      0,
      'Tenant A same-number internal note',
      'Tenant A same-number private note'
    ),
    (
      tenant_b_id,
      'Phase 2 Tenant B Same Number',
      'PHASE2-SAME-001',
      'confirmed',
      'artwork_setup',
      'vinyl',
      'artwork_setup',
      'Tenant B same-number update',
      null,
      '[]'::jsonb,
      null,
      false,
      0,
      0,
      'Tenant B same-number internal note',
      'Tenant B same-number private note'
    );

  result := public.get_public_order_tracking_for_host('PHASE2-A-ONLY', 'phase2-a.example.test');
  if result is null or result->>'client_name' <> 'Phase 2 Tenant A Client' then
    raise exception 'Tenant A host did not return Tenant A order.';
  end if;

  if public.get_public_order_tracking_for_host('PHASE2-B-ONLY', 'phase2-a.example.test') is not null then
    raise exception 'Tenant A host returned Tenant B order.';
  end if;

  if public.get_public_order_tracking_for_host('PHASE2-A-ONLY', 'phase2-b.example.test') is not null then
    raise exception 'Tenant B host returned Tenant A order.';
  end if;

  result := public.get_public_order_tracking_for_host('PHASE2-SAME-001', 'phase2-a.example.test');
  if result is null or result->>'client_name' <> 'Phase 2 Tenant A Same Number' then
    raise exception 'Same order number did not resolve to Tenant A by host.';
  end if;

  result := public.get_public_order_tracking_for_host('PHASE2-SAME-001', 'phase2-b.example.test');
  if result is null or result->>'client_name' <> 'Phase 2 Tenant B Same Number' then
    raise exception 'Same order number did not resolve to Tenant B by host.';
  end if;

  if public.get_public_order_tracking_for_host('PHASE2-A-ONLY', 'phase2-a.example.test?tenant_slug=phase2-tracking-b') is not null then
    raise exception 'Query parameters overrode or bypassed host validation.';
  end if;

  if public.get_public_order_tracking('PHASE2-A-ONLY', 'phase2-tracking-a') is not null then
    raise exception 'Legacy public tracking RPC accepted a hostless disposable tenant slug.';
  end if;
  result := public.get_public_order_tracking_for_host('PHASE2-A-TRACK', 'phase2-a.example.test');

  select key into unexpected_key
  from jsonb_object_keys(result) as payload(key)
  where key not in (
    'id',
    'client_name',
    'order_number',
    'status',
    'pipeline_stage',
    'production_method',
    'production_detail_stage',
    'production_client_update',
    'due_date',
    'courier',
    'tracking_number',
    'pep_code',
    'portal_message',
    'portal_attention_items',
    'portal_show_files',
    'portal_show_balance',
    'portal_visible_file_urls',
    'invoice_files',
    'total_amount',
    'deposit_paid'
  )
  limit 1;

  if unexpected_key is not null then
    raise exception 'Public tracking payload exposed unexpected key: %', unexpected_key;
  end if;

  if result ? 'tenant_id'
    or result ? 'tenant_slug'
    or result ? 'membership'
    or result ? 'tenant_domains'
    or result ? 'tasks'
    or result ? 'projects'
    or result ? 'purchase_orders'
    or result ? 'inventory'
    or result ? 'assets'
    or result ? 'invoice_sequence'
    or result ? 'production_internal_note'
    or result ? 'production_hold_reason'
    or result ? 'notes'
  then
    raise exception 'Public tracking payload exposed protected internal fields.';
  end if;
  delete from public.orders
  where order_number in ('PHASE2-A-ONLY', 'PHASE2-B-ONLY', 'PHASE2-SAME-001')
    or tracking_number in ('PHASE2-A-TRACK', 'PHASE2-B-TRACK');

  delete from public.tenant_domains
  where hostname in ('phase2-a.example.test', 'phase2-b.example.test');

  delete from public.tenants
  where slug in ('phase2-tracking-a', 'phase2-tracking-b');
end;
$$;

