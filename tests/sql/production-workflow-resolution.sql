-- Execute after the proposed migration inside one transaction, then ROLLBACK.
-- Uses the existing staging-only UAT Catalogue Tee fixture. Never production.
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_id from public.admin_users where lower(coalesce(role,'admin')) in ('admin','owner','super_admin','xlab_admin','x1_admin') limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_order uuid := '5700ee2e-ddab-4513-9796-eff1bee9e83f';
  v_line text := '0cca4328-2215-44ca-b2d7-a15e79d83bf6';
  v_product uuid := '8b260236-2d84-45dd-bacc-1b472031ac23';
  v_artwork uuid := '073d3802-5362-4c6e-9b41-e57b09fcd522';
  v_snapshot uuid := '9de317d0-1c4f-4c09-82fd-ef342c6cb348';
  v_readiness jsonb;
  v_rev integer;
  v_count integer;
begin
  perform public.set_order_line_production_scope(v_order,v_line,'garment_and_print');
  v_readiness := public.get_order_line_production_readiness(v_order);
  if not v_readiness::text like '%MISSING_BASE_COMPONENT%' then raise exception 'DEFAULT_SCOPE_MUST_REQUIRE_BASE'; end if;
  perform public.set_order_line_production_scope(v_order,v_line,'print_only');
  v_readiness := public.get_order_line_production_readiness(v_order);
  if v_readiness::text like '%MISSING_BASE_COMPONENT%' then raise exception 'PRINT_ONLY_MUST_NOT_REQUIRE_BASE'; end if;
  if not v_readiness::text like '%ARTWORK_FILE_UNCONFIRMED%' then raise exception 'PENDING_FILE_MUST_BLOCK'; end if;
  if not v_readiness::text like '%CUSTOMER_APPROVAL_MISSING%' then raise exception 'LIFECYCLE_MUST_NOT_APPROVE'; end if;
  begin
    perform public.get_print_prep_handoff(v_order,v_line,v_snapshot);
    raise exception 'HANDOFF_MUST_BLOCK';
  exception when others then
    if sqlerrm not like '%PRINT_PREP_HANDOFF_BLOCKED%' then raise; end if;
  end;
  begin
    perform public.confirm_client_product_production_file(v_artwork,999999);
    raise exception 'STALE_FILE_MUST_FAIL';
  exception when others then
    if sqlerrm not like '%PRODUCTION_FILE_STALE_OR_UNAVAILABLE%' then raise; end if;
  end;
  select revision into v_rev from public.client_product_artwork where id=v_artwork;
  perform public.confirm_client_product_production_file(v_artwork,v_rev);
  v_readiness := public.get_order_line_production_readiness(v_order);
  if v_readiness::text like '%ARTWORK_FILE_UNCONFIRMED%' then raise exception 'CONFIRMED_FILE_STILL_BLOCKED'; end if;
  if not v_readiness::text like '%CUSTOMER_APPROVAL_MISSING%' then raise exception 'FILE_CONFIRMATION_MUST_NOT_APPROVE_CUSTOMER'; end if;
  select revision into v_rev from public.client_products where id=v_product;
  begin
    perform public.record_client_product_approval_on_behalf(v_product,v_rev,'whatsapp','');
    raise exception 'EMPTY_EVIDENCE_MUST_FAIL';
  exception when others then
    if sqlerrm not like '%CLIENT_PRODUCT_APPROVAL_EVIDENCE_REQUIRED%' then raise; end if;
  end;
  begin
    perform public.record_client_product_approval_on_behalf(v_product,v_rev+1,'whatsapp','Rollback test');
    raise exception 'STALE_APPROVAL_MUST_FAIL';
  exception when others then
    if sqlerrm not like '%CLIENT_PRODUCT_REVISION_STALE%' then raise; end if;
  end;
  perform public.record_client_product_approval_on_behalf(v_product,v_rev,'whatsapp','AUTOMATED ROLLBACK TEST ONLY');
  select count(*) into v_count from public.client_approvals where related_id=v_product and revision=v_rev and status='approved';
  perform public.record_client_product_approval_on_behalf(v_product,v_rev,'whatsapp','AUTOMATED RETRY TEST ONLY');
  if (select count(*) from public.client_approvals where related_id=v_product and revision=v_rev and status='approved') <> v_count then raise exception 'APPROVAL_RETRY_DUPLICATED'; end if;
  v_readiness := public.get_order_line_production_readiness(v_order);
  if v_readiness::text like '%CUSTOMER_APPROVAL_MISSING%' then raise exception 'APPROVAL_NOT_RECOGNISED'; end if;
  perform public.get_print_prep_handoff(v_order,v_line,v_snapshot);
end;
$$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
begin
  begin
    perform public.record_client_product_approval_on_behalf('8b260236-2d84-45dd-bacc-1b472031ac23',1,'whatsapp','DENIAL TEST');
    raise exception 'NON_ADMIN_MUST_FAIL';
  exception when others then
    if sqlerrm not like '%CLIENT_PRODUCT_APPROVAL_DENIED%' then raise; end if;
  end;
  begin
    perform public.set_order_line_production_scope('5700ee2e-ddab-4513-9796-eff1bee9e83f','0cca4328-2215-44ca-b2d7-a15e79d83bf6','print_only');
    raise exception 'NON_STAFF_MUST_FAIL';
  exception when others then
    if sqlerrm not like '%PRODUCTION_SCOPE_DENIED%' then raise; end if;
  end;
end;
$$;
reset role;
select 'production workflow behavioural checks passed; transaction will roll back' as result;
