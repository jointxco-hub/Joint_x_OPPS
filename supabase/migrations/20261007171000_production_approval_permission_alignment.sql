-- Align approval with existing tenant production-management authority.
-- No membership, role, RLS or customer approval data is changed.
begin;
create or replace function public.record_client_product_approval_on_behalf(
  p_client_product_id uuid, p_expected_revision integer,
  p_approval_source text, p_approval_reference text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog', 'public' as $$
declare cp public.client_products; v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'CLIENT_PRODUCT_APPROVAL_DENIED';
  end if;
  select * into cp from public.client_products where id = p_client_product_id for update;
  if not found or cp.tenant_id is null or not public.inventory_can_review_tenant(cp.tenant_id) then
    raise exception 'CLIENT_PRODUCT_APPROVAL_DENIED';
  end if;
  if cp.revision is distinct from p_expected_revision then raise exception 'CLIENT_PRODUCT_REVISION_STALE'; end if;
  if p_approval_source is null or p_approval_source not in ('whatsapp', 'email', 'in_person', 'phone')
     or nullif(trim(p_approval_reference), '') is null or length(p_approval_reference) > 2000 then
    raise exception 'CLIENT_PRODUCT_APPROVAL_EVIDENCE_REQUIRED';
  end if;
  select id into v_id from public.client_approvals
  where related_table = 'client_products' and related_id = cp.id
    and approval_type = 'client_product_concept' and revision = cp.revision and status = 'approved'
  order by approved_at desc limit 1;
  if v_id is null then
    insert into public.client_approvals
      (client_id, approval_type, related_table, related_id, status, approved_at,
       revision, approval_source, approval_reference, recorded_by)
    values (cp.client_id, 'client_product_concept', 'client_products', cp.id, 'approved', now(),
      cp.revision, p_approval_source, trim(p_approval_reference), auth.uid()) returning id into v_id;
  end if;
  return jsonb_build_object('approval_id', v_id, 'revision', cp.revision);
end;
$$;
revoke all on function public.record_client_product_approval_on_behalf(uuid, integer, text, text) from public, anon;
grant execute on function public.record_client_product_approval_on_behalf(uuid, integer, text, text) to authenticated;

commit;
