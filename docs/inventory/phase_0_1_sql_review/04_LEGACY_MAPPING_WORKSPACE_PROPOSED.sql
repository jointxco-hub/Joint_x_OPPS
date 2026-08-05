-- PROPOSED ONLY - DO NOT RUN WITHOUT THE REVIEW/AUTHORIZATION CHECKLIST.
-- Additive identity-review workspace. It snapshots public.inventory but never
-- updates public.inventory/current_stock and never posts stock or movements.

begin;

create table public.inventory_legacy_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  legacy_inventory_id uuid not null,

  -- Immutable source snapshot. No FK is used for the original supplier so an
  -- orphaned historical reference can still be preserved and reviewed.
  original_name text not null,
  original_sku text,
  original_supplier_id uuid,
  original_supplier_name text,
  original_category text,
  original_sizes text[] not null default '{}',
  original_colours text[] not null default '{}',
  original_location text,
  original_unit text,
  original_recorded_quantity numeric(14, 3),

  proposed_inventory_product_id uuid,
  proposed_inventory_variant_id uuid,
  proposed_supplier_product_id uuid,
  proposed_supplier_variant_id uuid,

  confidence numeric(5, 4),
  evidence jsonb not null default '[]'::jsonb,
  ambiguity_codes text[] not null default '{}',
  parser_version text not null,
  review_status text not null default 'suggested',
  reviewer_auth_user_id uuid references auth.users(id) on delete set null,
  reviewer_email text,
  review_notes text,
  mapping_version integer not null default 1,
  batch_id uuid not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,

  constraint inventory_legacy_mappings_tenant_id_id_key unique (tenant_id, id),
  constraint inventory_legacy_mappings_source_version_uq unique (tenant_id, legacy_inventory_id, mapping_version),
  constraint inventory_legacy_mappings_idempotency_uq unique (tenant_id, idempotency_key),
  constraint inventory_legacy_mappings_internal_product_tenant_fk
    foreign key (tenant_id, proposed_inventory_product_id)
    references public.inventory_products (tenant_id, id) on delete restrict,
  constraint inventory_legacy_mappings_internal_variant_tenant_fk
    foreign key (tenant_id, proposed_inventory_variant_id)
    references public.inventory_variants (tenant_id, id) on delete restrict,
  constraint inventory_legacy_mappings_supplier_product_tenant_fk
    foreign key (tenant_id, proposed_supplier_product_id)
    references public.inventory_supplier_products (tenant_id, id) on delete restrict,
  constraint inventory_legacy_mappings_supplier_variant_tenant_fk
    foreign key (tenant_id, proposed_supplier_variant_id)
    references public.inventory_supplier_variants (tenant_id, id) on delete restrict,
  constraint inventory_legacy_mappings_original_name_not_blank check (btrim(original_name) <> ''),
  constraint inventory_legacy_mappings_parser_version_not_blank check (btrim(parser_version) <> ''),
  constraint inventory_legacy_mappings_idempotency_not_blank check (btrim(idempotency_key) <> ''),
  constraint inventory_legacy_mappings_confidence_range check (confidence is null or confidence between 0 and 1),
  constraint inventory_legacy_mappings_evidence_array check (jsonb_typeof(evidence) = 'array'),
  constraint inventory_legacy_mappings_version_positive check (mapping_version > 0),
  constraint inventory_legacy_mappings_status_check check (
    review_status in ('suggested', 'approved', 'rejected', 'deferred')
  ),
  constraint inventory_legacy_mappings_review_fields_check check (
    (review_status = 'suggested' and reviewer_auth_user_id is null and reviewed_at is null)
    or
    (review_status in ('approved', 'rejected', 'deferred')
      and reviewer_auth_user_id is not null
      and reviewed_at is not null)
  ),
  constraint inventory_legacy_mappings_approval_targets_check check (
    review_status <> 'approved'
    or (
      proposed_inventory_product_id is not null
      and proposed_inventory_variant_id is not null
      and proposed_supplier_product_id is not null
      and proposed_supplier_variant_id is not null
    )
  )
);

comment on table public.inventory_legacy_mappings is
  'Versioned, human-reviewed identity mappings for immutable legacy inventory snapshots. Approval does not change stock.';
comment on column public.inventory_legacy_mappings.original_recorded_quantity is
  'Audit snapshot of public.inventory.current_stock at staging time; never a new authoritative balance.';

create index inventory_legacy_mappings_review_queue_idx
  on public.inventory_legacy_mappings (tenant_id, review_status, created_at, id);
create index inventory_legacy_mappings_batch_idx
  on public.inventory_legacy_mappings (tenant_id, batch_id, review_status);
create index inventory_legacy_mappings_internal_proposal_idx
  on public.inventory_legacy_mappings (tenant_id, proposed_inventory_product_id, proposed_inventory_variant_id);
create index inventory_legacy_mappings_supplier_proposal_idx
  on public.inventory_legacy_mappings (tenant_id, proposed_supplier_product_id, proposed_supplier_variant_id);
create index inventory_legacy_mappings_ambiguity_gin_idx
  on public.inventory_legacy_mappings using gin (ambiguity_codes);

create or replace function public.inventory_phase1_protect_mapping_history()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Legacy mapping history is append-preserved; deletion is not allowed.' using errcode = '55000';
  end if;

  if old.review_status = 'approved' then
    raise exception 'Approved mappings are immutable; create a new mapping version.' using errcode = '55000';
  end if;

  if row(
    new.tenant_id, new.legacy_inventory_id, new.original_name, new.original_sku,
    new.original_supplier_id, new.original_supplier_name, new.original_category,
    new.original_sizes, new.original_colours, new.original_location,
    new.original_unit, new.original_recorded_quantity, new.mapping_version,
    new.batch_id, new.idempotency_key, new.created_at
  ) is distinct from row(
    old.tenant_id, old.legacy_inventory_id, old.original_name, old.original_sku,
    old.original_supplier_id, old.original_supplier_name, old.original_category,
    old.original_sizes, old.original_colours, old.original_location,
    old.original_unit, old.original_recorded_quantity, old.mapping_version,
    old.batch_id, old.idempotency_key, old.created_at
  ) then
    raise exception 'Legacy source snapshots and version identity are immutable.' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.inventory_phase1_protect_mapping_history() from public, anon, authenticated;

create trigger inventory_legacy_mappings_protect_history
before update or delete on public.inventory_legacy_mappings
for each row execute function public.inventory_phase1_protect_mapping_history();

-- Service/import staging function. It snapshots one existing legacy row and
-- validates tenant, batch, source ID, proposed parent IDs (through FKs), and
-- idempotency. It has no UPDATE statement against public.inventory.
create or replace function public.inventory_stage_legacy_mapping(
  p_tenant_id uuid,
  p_legacy_inventory_id uuid,
  p_batch_id uuid,
  p_parser_version text,
  p_idempotency_key text,
  p_confidence numeric default null,
  p_evidence jsonb default '[]'::jsonb,
  p_ambiguity_codes text[] default '{}',
  p_proposed_inventory_product_id uuid default null,
  p_proposed_inventory_variant_id uuid default null,
  p_proposed_supplier_product_id uuid default null,
  p_proposed_supplier_variant_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inventory public.inventory%rowtype;
  v_supplier_name text;
  v_mapping_id uuid;
begin
  if p_tenant_id is null or p_batch_id is null or p_legacy_inventory_id is null then
    raise exception 'tenant_id, batch_id, and legacy_inventory_id are required.' using errcode = '22004';
  end if;
  if nullif(btrim(p_parser_version), '') is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'parser_version and idempotency_key are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) <> 'array' then
    raise exception 'evidence must be a JSON array.' using errcode = '22023';
  end if;

  select * into v_inventory
  from public.inventory
  where id = p_legacy_inventory_id
    and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Legacy inventory source does not exist in the supplied tenant.' using errcode = '23503';
  end if;

  if v_inventory.preferred_supplier_id is not null then
    select coalesce(to_jsonb(s)->>'name', to_jsonb(s)->>'vendor')
      into v_supplier_name
    from public.suppliers s
    where s.id = v_inventory.preferred_supplier_id
      and s.tenant_id = p_tenant_id;
  end if;

  insert into public.inventory_legacy_mappings (
    tenant_id, legacy_inventory_id,
    original_name, original_sku, original_supplier_id, original_supplier_name,
    original_category, original_sizes, original_colours, original_location,
    original_unit, original_recorded_quantity,
    proposed_inventory_product_id, proposed_inventory_variant_id,
    proposed_supplier_product_id, proposed_supplier_variant_id,
    confidence, evidence, ambiguity_codes, parser_version,
    mapping_version, batch_id, idempotency_key
  ) values (
    p_tenant_id, v_inventory.id,
    v_inventory.name, v_inventory.sku, v_inventory.preferred_supplier_id, v_supplier_name,
    v_inventory.category, coalesce(v_inventory.sizes_available, '{}'),
    coalesce(v_inventory.colors_available, '{}'), v_inventory.location,
    v_inventory.unit, v_inventory.current_stock,
    p_proposed_inventory_product_id, p_proposed_inventory_variant_id,
    p_proposed_supplier_product_id, p_proposed_supplier_variant_id,
    p_confidence, coalesce(p_evidence, '[]'::jsonb), coalesce(p_ambiguity_codes, '{}'),
    p_parser_version,
    coalesce((
      select max(m.mapping_version) + 1
      from public.inventory_legacy_mappings m
      where m.tenant_id = p_tenant_id
        and m.legacy_inventory_id = p_legacy_inventory_id
    ), 1),
    p_batch_id, p_idempotency_key
  )
  returning id into v_mapping_id;

  return v_mapping_id;
end;
$$;

revoke all on function public.inventory_stage_legacy_mapping(
  uuid, uuid, uuid, text, text, numeric, jsonb, text[], uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.inventory_stage_legacy_mapping(
  uuid, uuid, uuid, text, text, numeric, jsonb, text[], uuid, uuid, uuid, uuid
) to service_role;

alter table public.inventory_legacy_mappings enable row level security;
revoke all on table public.inventory_legacy_mappings from public, anon, authenticated;

commit;
