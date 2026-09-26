-- CAFE-ACCESS-01 Phase 2: introduce the smallest reusable, role-derived
-- tenant capability primitive and apply it to one Cafe operations boundary.
--
-- public.tenant_capabilities is intentionally not used here: that table
-- enables modules for a tenant; it does not grant authority to an actor.

do $preflight$
begin
  if to_regprocedure('public.admin_list_quick_solution_opps_handoffs(text)') is null then
    raise exception
      'CAFE_ACCESS_01_MIGRATION_PRECONDITION: admin_list_quick_solution_opps_handoffs(text) does not exist';
  end if;
end
$preflight$;

create or replace function public.has_tenant_capability(
  p_tenant_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and p_tenant_id is not null
    and p_capability = 'cafe.operations.manage'
    and exists (
      select 1
      from public.tenant_memberships membership
      join public.tenants tenant
        on tenant.id = membership.tenant_id
       and tenant.status = 'active'
      where membership.tenant_id = p_tenant_id
        and membership.auth_user_id = auth.uid()
        and membership.status = 'active'
        and membership.tenant_role in ('owner', 'admin')
    );
$$;

comment on function public.has_tenant_capability(uuid, text) is
  'Role-derived tenant authorization primitive. CAFE-ACCESS-01 initially recognizes cafe.operations.manage for active owner/admin memberships; unknown capabilities fail closed. Explicit actor grants can be incorporated behind this contract later.';

revoke all on function public.has_tenant_capability(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.has_tenant_capability(uuid, text)
  to authenticated;

create or replace function public.admin_list_quick_solution_opps_handoffs(
  p_tenant_slug text default 'quick-solution'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='Staff sign-in is required.';
  end if;

  select t.id into v_tenant_id
  from public.tenants t
  where t.slug=lower(trim(p_tenant_slug))
    and t.status='active'
  limit 1;

  if v_tenant_id is null then
    raise exception using errcode='22023', message='Quick Solution tenant was not found.';
  end if;

  if not public.has_tenant_capability(v_tenant_id, 'cafe.operations.manage') then
    raise exception using errcode='42501', message='You do not have access to Quick Solution handoffs.';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'serviceOrderId', so.id,
        'orderNumber', so.order_number,
        'customerName', so.customer_name,
        'totalAmount', so.total_amount,
        'paymentStatus', so.payment_status,
        'serviceStatus', so.status,
        'submittedAt', so.submitted_at,
        'oppsOrderId', so.opps_order_id,
        'handoffStatus', coalesce(h.status,'not_previewed'),
        'mappingVersion', h.mapping_version,
        'lastPreviewedAt', h.last_previewed_at,
        'sentAt', h.sent_at,
        'blockers', coalesce(h.blockers,'[]'::jsonb),
        'warnings', coalesce(h.warnings,'[]'::jsonb),
        'previewPayload',
          case
            when h.id is null then null
            else h.preview_payload
          end
      )
      order by so.submitted_at desc
    )
    from commerce.service_orders so
    left join commerce.service_order_handoffs h
      on h.service_order_id=so.id
    where so.tenant_id=v_tenant_id
  ), '[]'::jsonb);
end
$$;

-- The browser calls this RPC directly. Its only intended executable API role
-- remains authenticated; trusted backend roles do not need this list RPC.
revoke all on function public.admin_list_quick_solution_opps_handoffs(text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_quick_solution_opps_handoffs(text)
  to authenticated;
