-- PROPOSED ONLY - DO NOT RUN WITHOUT THE REVIEW/AUTHORIZATION CHECKLIST.
-- Explicit tenant RLS, reviewer authorization, decision RPCs, and grants.

begin;

-- An app admin is not globally operational by default. The caller must also
-- have access to the explicitly named tenant. Tenant owner/admin memberships
-- are independently authorized reviewers for their own tenant.
create or replace function public.inventory_can_review_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_tenant_id is not null
     and public.can_access_tenant(p_tenant_id)
     and (
       public.is_app_admin()
       or exists (
         select 1
         from public.tenant_memberships tm
         where tm.tenant_id = p_tenant_id
           and tm.auth_user_id = auth.uid()
           and tm.status = 'active'
           and tm.tenant_role in ('owner', 'admin')
       )
     );
$$;

revoke all on function public.inventory_can_review_tenant(uuid) from public, anon;
grant execute on function public.inventory_can_review_tenant(uuid) to authenticated;

alter table public.inventory_products enable row level security;
alter table public.inventory_variants enable row level security;
alter table public.inventory_supplier_products enable row level security;
alter table public.inventory_supplier_variants enable row level security;
alter table public.inventory_legacy_mappings enable row level security;

-- Readable only inside an accessible tenant.
create policy inventory_products_tenant_read
on public.inventory_products for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy inventory_variants_tenant_read
on public.inventory_variants for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy inventory_supplier_products_tenant_read
on public.inventory_supplier_products for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy inventory_supplier_variants_tenant_read
on public.inventory_supplier_variants for select to authenticated
using (public.can_access_tenant(tenant_id));

create policy inventory_legacy_mappings_tenant_read
on public.inventory_legacy_mappings for select to authenticated
using (public.can_access_tenant(tenant_id));

-- Identity administration requires reviewer authority plus explicit tenant
-- access. No authenticated DELETE policy/grant is proposed; deactivate/version.
create policy inventory_products_reviewer_insert
on public.inventory_products for insert to authenticated
with check (public.inventory_can_review_tenant(tenant_id));
create policy inventory_products_reviewer_update
on public.inventory_products for update to authenticated
using (public.inventory_can_review_tenant(tenant_id))
with check (public.inventory_can_review_tenant(tenant_id));

create policy inventory_variants_reviewer_insert
on public.inventory_variants for insert to authenticated
with check (public.inventory_can_review_tenant(tenant_id));
create policy inventory_variants_reviewer_update
on public.inventory_variants for update to authenticated
using (public.inventory_can_review_tenant(tenant_id))
with check (public.inventory_can_review_tenant(tenant_id));

create policy inventory_supplier_products_reviewer_insert
on public.inventory_supplier_products for insert to authenticated
with check (public.inventory_can_review_tenant(tenant_id));
create policy inventory_supplier_products_reviewer_update
on public.inventory_supplier_products for update to authenticated
using (public.inventory_can_review_tenant(tenant_id))
with check (public.inventory_can_review_tenant(tenant_id));

create policy inventory_supplier_variants_reviewer_insert
on public.inventory_supplier_variants for insert to authenticated
with check (public.inventory_can_review_tenant(tenant_id));
create policy inventory_supplier_variants_reviewer_update
on public.inventory_supplier_variants for update to authenticated
using (public.inventory_can_review_tenant(tenant_id))
with check (public.inventory_can_review_tenant(tenant_id));

-- No authenticated INSERT/UPDATE/DELETE policy is created on mapping history.
-- Decisions happen through this narrowly scoped function.
create or replace function public.inventory_decide_legacy_mapping(
  p_tenant_id uuid,
  p_mapping_id uuid,
  p_review_status text,
  p_review_notes text,
  p_proposed_inventory_product_id uuid default null,
  p_proposed_inventory_variant_id uuid default null,
  p_proposed_supplier_product_id uuid default null,
  p_proposed_supplier_variant_id uuid default null
)
returns public.inventory_legacy_mappings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_mapping public.inventory_legacy_mappings%rowtype;
  v_internal_variant_product uuid;
  v_supplier_product_internal_product uuid;
  v_supplier_variant_internal_variant uuid;
begin
  if not public.inventory_can_review_tenant(p_tenant_id) then
    raise exception 'Not authorized to review mappings for this tenant.' using errcode = '42501';
  end if;
  if p_review_status not in ('approved', 'rejected', 'deferred') then
    raise exception 'Decision must be approved, rejected, or deferred.' using errcode = '22023';
  end if;

  select * into v_mapping
  from public.inventory_legacy_mappings
  where tenant_id = p_tenant_id and id = p_mapping_id
  for update;

  if not found then
    raise exception 'Mapping does not exist in the supplied tenant.' using errcode = 'P0002';
  end if;
  if v_mapping.review_status <> 'suggested' then
    raise exception 'Only a suggested mapping may receive a decision; create a new version for an approved mapping.' using errcode = '55000';
  end if;

  if p_review_status = 'approved' then
    if p_proposed_inventory_product_id is null
      or p_proposed_inventory_variant_id is null
      or p_proposed_supplier_product_id is null
      or p_proposed_supplier_variant_id is null then
      raise exception 'Approved mappings require all four proposed identities.' using errcode = '23514';
    end if;

    select inventory_product_id into v_internal_variant_product
    from public.inventory_variants
    where tenant_id = p_tenant_id and id = p_proposed_inventory_variant_id;

    select inventory_product_id into v_supplier_product_internal_product
    from public.inventory_supplier_products
    where tenant_id = p_tenant_id and id = p_proposed_supplier_product_id;

    select inventory_variant_id into v_supplier_variant_internal_variant
    from public.inventory_supplier_variants
    where tenant_id = p_tenant_id
      and id = p_proposed_supplier_variant_id
      and inventory_supplier_product_id = p_proposed_supplier_product_id;

    if v_internal_variant_product is distinct from p_proposed_inventory_product_id
      or v_supplier_product_internal_product is distinct from p_proposed_inventory_product_id
      or v_supplier_variant_internal_variant is distinct from p_proposed_inventory_variant_id then
      raise exception 'Approved internal and supplier identities are not one compatible hierarchy.' using errcode = '23514';
    end if;
  end if;

  update public.inventory_legacy_mappings
  set review_status = p_review_status,
      review_notes = p_review_notes,
      proposed_inventory_product_id = case when p_review_status = 'approved' then p_proposed_inventory_product_id else proposed_inventory_product_id end,
      proposed_inventory_variant_id = case when p_review_status = 'approved' then p_proposed_inventory_variant_id else proposed_inventory_variant_id end,
      proposed_supplier_product_id = case when p_review_status = 'approved' then p_proposed_supplier_product_id else proposed_supplier_product_id end,
      proposed_supplier_variant_id = case when p_review_status = 'approved' then p_proposed_supplier_variant_id else proposed_supplier_variant_id end,
      reviewer_auth_user_id = auth.uid(),
      reviewer_email = auth.jwt() ->> 'email',
      reviewed_at = now()
  where tenant_id = p_tenant_id and id = p_mapping_id
  returning * into v_mapping;

  return v_mapping;
end;
$$;

revoke all on function public.inventory_decide_legacy_mapping(uuid, uuid, text, text, uuid, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.inventory_decide_legacy_mapping(uuid, uuid, text, text, uuid, uuid, uuid, uuid)
  to authenticated;

-- Approved history is never overwritten. This function creates a new suggested
-- version with the same immutable source snapshot for a fresh review.
create or replace function public.inventory_create_mapping_revision(
  p_tenant_id uuid,
  p_mapping_id uuid,
  p_batch_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_source public.inventory_legacy_mappings%rowtype;
  v_new_id uuid;
begin
  if not public.inventory_can_review_tenant(p_tenant_id) then
    raise exception 'Not authorized to revise mappings for this tenant.' using errcode = '42501';
  end if;
  if p_batch_id is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'batch_id and idempotency_key are required.' using errcode = '22023';
  end if;

  select * into v_source
  from public.inventory_legacy_mappings
  where tenant_id = p_tenant_id and id = p_mapping_id;

  if not found or v_source.review_status <> 'approved' then
    raise exception 'Only an approved mapping in the supplied tenant can be revised.' using errcode = '55000';
  end if;

  insert into public.inventory_legacy_mappings (
    tenant_id, legacy_inventory_id,
    original_name, original_sku, original_supplier_id, original_supplier_name,
    original_category, original_sizes, original_colours, original_location,
    original_unit, original_recorded_quantity,
    proposed_inventory_product_id, proposed_inventory_variant_id,
    proposed_supplier_product_id, proposed_supplier_variant_id,
    confidence, evidence, ambiguity_codes, parser_version,
    review_status, mapping_version, batch_id, idempotency_key
  ) values (
    v_source.tenant_id, v_source.legacy_inventory_id,
    v_source.original_name, v_source.original_sku, v_source.original_supplier_id, v_source.original_supplier_name,
    v_source.original_category, v_source.original_sizes, v_source.original_colours, v_source.original_location,
    v_source.original_unit, v_source.original_recorded_quantity,
    v_source.proposed_inventory_product_id, v_source.proposed_inventory_variant_id,
    v_source.proposed_supplier_product_id, v_source.proposed_supplier_variant_id,
    v_source.confidence, v_source.evidence, v_source.ambiguity_codes, v_source.parser_version,
    'suggested', v_source.mapping_version + 1, p_batch_id, p_idempotency_key
  ) returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.inventory_create_mapping_revision(uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.inventory_create_mapping_revision(uuid, uuid, uuid, text)
  to authenticated;

-- Base-table grants remain narrower than RLS. Mapping writes are RPC-only.
grant select, insert, update on public.inventory_products to authenticated;
grant select, insert, update on public.inventory_variants to authenticated;
grant select, insert, update on public.inventory_supplier_products to authenticated;
grant select, insert, update on public.inventory_supplier_variants to authenticated;
grant select on public.inventory_legacy_mappings to authenticated;

grant select on public.inventory_identity_v to authenticated;
grant select on public.inventory_supplier_mapping_v to authenticated;
grant select on public.inventory_legacy_mapping_review_v to authenticated;
grant select on public.inventory_legacy_compat_v to authenticated;
grant execute on function public.search_inventory_phase1(uuid, text, integer) to authenticated;

revoke all on table public.inventory_products from anon;
revoke all on table public.inventory_variants from anon;
revoke all on table public.inventory_supplier_products from anon;
revoke all on table public.inventory_supplier_variants from anon;
revoke all on table public.inventory_legacy_mappings from anon;
revoke all on table public.inventory_identity_v from anon;
revoke all on table public.inventory_supplier_mapping_v from anon;
revoke all on table public.inventory_legacy_mapping_review_v from anon;
revoke all on table public.inventory_legacy_compat_v from anon;
revoke execute on function public.search_inventory_phase1(uuid, text, integer) from anon;

commit;
