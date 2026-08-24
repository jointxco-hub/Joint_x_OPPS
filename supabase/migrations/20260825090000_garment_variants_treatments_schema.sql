-- Phase 2B Step 1 — Garment Variants + Production Treatments, SCHEMA ONLY.
-- No duplication RPCs, no UI. Foundational for real repeat-order product
-- families (e.g. SFR T-Shirt: 220/300/330gsm x Black/White/Green/Orange
-- x White/Orange print, where garment colour and print colour vary
-- independently -- no colour->print rule is encoded anywhere here).
--
-- client_products remains the family. Garment variants and treatments
-- are additive, optional per-family concepts: a client_product with zero
-- active garment variants continues through the existing simple-product
-- path completely unchanged (Jai's X1 Crochet, Krysten's JET/JHG). SFR's
-- existing 6 scratch/demo product_components rows are left exactly as
-- they are -- family-level (garment_variant_id/treatment_id both null),
-- untouched by this migration, not silently converted into the new
-- model.
--
-- Four integrity hardenings required on review, before any UI/RPC work:
--   1. Namespace simple vs treatment-scoped artwork so existing Phase 1
--      readiness can never be satisfied by treatment-specific artwork.
--   2. Same-family referential integrity via composite (id,
--      client_product_id) unique constraints + composite FKs -- not
--      left to RPC/UI validation.
--   3. A component cannot be simultaneously variant-scoped and
--      treatment-scoped (CHECK constraint).
--   4. No ON DELETE SET NULL anywhere that could silently convert scoped
--      configuration into family-level configuration -- particularly
--      client_product_artwork.treatment_id, which uses RESTRICT.

begin;

-- ---------------------------------------------------------------------
-- 1. client_product_garment_variants
-- ---------------------------------------------------------------------

create table public.client_product_garment_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  client_product_id uuid not null references public.client_products(id) on delete cascade,
  name text not null,
  -- Preferred garment identity: pins the GSM/blank (weight_gsm lives on
  -- inventory_products itself, confirmed live -- JET's product row has
  -- weight_gsm as a product-level attribute, not per-variant), scoped
  -- to one colour via colour_name matching inventory_variants.colour_name.
  -- Available sizes are DERIVED from inventory_variants at read time,
  -- never stored here -- see manual_available_sizes below for the only
  -- case where a stored list is appropriate.
  inventory_product_id uuid references public.inventory_products(id) on delete set null,
  colour_name text,
  colour_code text,
  -- Fallback ONLY for garment variants not backed by normalized
  -- inventory yet. When inventory_product_id is set, this column is
  -- ignored in favour of the live inventory_variants derivation -- see
  -- the size-precedence note in the accompanying design return.
  manual_available_sizes text[],
  price_override numeric check (price_override is null or price_override >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The composite unique constraint child tables key off of, to prove
  -- "this variant belongs to the same client_product as the row
  -- referencing it" at the database level, not just in application code.
  constraint client_product_garment_variants_id_cp_uidx unique (id, client_product_id)
);

create index client_product_garment_variants_client_product_id_idx
  on public.client_product_garment_variants (client_product_id);
create index client_product_garment_variants_tenant_id_idx
  on public.client_product_garment_variants (tenant_id);
create index client_product_garment_variants_inventory_product_id_idx
  on public.client_product_garment_variants (inventory_product_id)
  where inventory_product_id is not null;

alter table public.client_product_garment_variants enable row level security;

create policy client_product_garment_variants_tenant_read
  on public.client_product_garment_variants for select
  using (public.can_access_tenant(tenant_id));

create policy client_product_garment_variants_reviewer_insert
  on public.client_product_garment_variants for insert
  with check (public.inventory_can_review_tenant(tenant_id));

create policy client_product_garment_variants_reviewer_update
  on public.client_product_garment_variants for update
  using (public.inventory_can_review_tenant(tenant_id))
  with check (public.inventory_can_review_tenant(tenant_id));

-- No delete grant/policy -- matches product_components' own precedent
-- (confirmed live: authenticated has insert/select/update only, no
-- delete). v1 lifecycle is is_active = false, never destructive
-- deletion, consistent with every other reusable-composition concept
-- in this system.
revoke delete on public.client_product_garment_variants from authenticated, anon, public;
grant select, insert, update on public.client_product_garment_variants to authenticated;
revoke all on public.client_product_garment_variants from anon, public;

-- ---------------------------------------------------------------------
-- 2. client_product_treatments
-- ---------------------------------------------------------------------

create table public.client_product_treatments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  client_product_id uuid not null references public.client_products(id) on delete cascade,
  name text not null,
  print_colour text,
  -- Same production_method vocabulary as product_components, for
  -- consistency -- a treatment's method is conceptually the same kind
  -- of value.
  production_method text check (production_method is null or production_method = any (array[
    'dtf','vinyl','screen','embroidery','pressing','tailoring','cropping','labeling','sublimation','mixed','custom'
  ])),
  -- Deliberately NOT a second authoritative required-placement source.
  -- Named primary_placement (not placement) to make explicit it is a
  -- display/default hint only -- the authoritative set of placements a
  -- treatment actually needs comes from its own treatment-scoped
  -- product_components/client_product_artwork rows once those exist,
  -- not from this single field. A treatment needing multiple placements
  -- is expressed as multiple product_components rows under the same
  -- treatment_id, each with its own placement.
  primary_placement text,
  print_size text,
  surcharge numeric not null default 0 check (surcharge >= 0),
  production_instructions text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_product_treatments_id_cp_uidx unique (id, client_product_id)
);

create index client_product_treatments_client_product_id_idx
  on public.client_product_treatments (client_product_id);
create index client_product_treatments_tenant_id_idx
  on public.client_product_treatments (tenant_id);

alter table public.client_product_treatments enable row level security;

create policy client_product_treatments_tenant_read
  on public.client_product_treatments for select
  using (public.can_access_tenant(tenant_id));

create policy client_product_treatments_reviewer_insert
  on public.client_product_treatments for insert
  with check (public.inventory_can_review_tenant(tenant_id));

create policy client_product_treatments_reviewer_update
  on public.client_product_treatments for update
  using (public.inventory_can_review_tenant(tenant_id))
  with check (public.inventory_can_review_tenant(tenant_id));

revoke delete on public.client_product_treatments from authenticated, anon, public;
grant select, insert, update on public.client_product_treatments to authenticated;
revoke all on public.client_product_treatments from anon, public;

-- ---------------------------------------------------------------------
-- 3. client_product_variant_treatments -- the allowed variant<->treatment
-- mapping. client_product_id is stored directly on the mapping row so
-- BOTH composite FKs below can require it to match -- transitively
-- proving the referenced variant and treatment belong to the SAME
-- family as each other, not just each independently to *some* family.
-- ---------------------------------------------------------------------

create table public.client_product_variant_treatments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  client_product_id uuid not null references public.client_products(id) on delete cascade,
  garment_variant_id uuid not null,
  treatment_id uuid not null,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint client_product_variant_treatments_variant_family_fkey
    foreign key (garment_variant_id, client_product_id)
    references public.client_product_garment_variants (id, client_product_id)
    on delete cascade,
  constraint client_product_variant_treatments_treatment_family_fkey
    foreign key (treatment_id, client_product_id)
    references public.client_product_treatments (id, client_product_id)
    on delete cascade,
  -- A join row is meaningless once either endpoint disappears, and
  -- garment variants/treatments have no delete path at the application
  -- layer today (is_active = false is the only lifecycle action) -- so
  -- CASCADE here only ever fires on an administrative hard-delete, and
  -- simply removes the now-meaningless pairing record. This is distinct
  -- from client_product_artwork.treatment_id (below), where the SAME
  -- cascade-style loss would silently convert real, valuable creative
  -- work into ambiguous family-level artwork -- that gets RESTRICT.
  constraint client_product_variant_treatments_unique unique (garment_variant_id, treatment_id)
);

create index client_product_variant_treatments_client_product_id_idx
  on public.client_product_variant_treatments (client_product_id);
create index client_product_variant_treatments_variant_id_idx
  on public.client_product_variant_treatments (garment_variant_id);
create index client_product_variant_treatments_treatment_id_idx
  on public.client_product_variant_treatments (treatment_id);

alter table public.client_product_variant_treatments enable row level security;

create policy client_product_variant_treatments_tenant_read
  on public.client_product_variant_treatments for select
  using (public.can_access_tenant(tenant_id));

create policy client_product_variant_treatments_reviewer_insert
  on public.client_product_variant_treatments for insert
  with check (public.inventory_can_review_tenant(tenant_id));

create policy client_product_variant_treatments_reviewer_update
  on public.client_product_variant_treatments for update
  using (public.inventory_can_review_tenant(tenant_id))
  with check (public.inventory_can_review_tenant(tenant_id));

revoke delete on public.client_product_variant_treatments from authenticated, anon, public;
grant select, insert, update on public.client_product_variant_treatments to authenticated;
revoke all on public.client_product_variant_treatments from anon, public;

-- ---------------------------------------------------------------------
-- 4. product_components -- scoped columns, composite family-integrity
-- FKs, and the mutual-exclusivity CHECK. Both columns default/stay null
-- for every existing row -- their current meaning ("family-level,
-- applies to the whole simple product") is completely unchanged.
-- ---------------------------------------------------------------------

alter table public.product_components
  add column garment_variant_id uuid,
  add column treatment_id uuid;

alter table public.product_components
  add constraint product_components_variant_family_fkey
    foreign key (garment_variant_id, client_product_id)
    references public.client_product_garment_variants (id, client_product_id)
    on delete cascade,
  add constraint product_components_treatment_family_fkey
    foreign key (treatment_id, client_product_id)
    references public.client_product_treatments (id, client_product_id)
    on delete cascade,
  -- A component cannot be simultaneously variant-scoped and
  -- treatment-scoped. Valid: both null (family), variant set only, or
  -- treatment set only. This keeps future order-line composition
  -- deterministic: family components + selected variant's components +
  -- selected treatment's components, with no row that could belong to
  -- two of those three buckets at once.
  add constraint product_components_scope_check
    check (not (garment_variant_id is not null and treatment_id is not null));

create index product_components_garment_variant_id_idx
  on public.product_components (garment_variant_id)
  where garment_variant_id is not null;
create index product_components_treatment_id_idx
  on public.product_components (treatment_id)
  where treatment_id is not null;

-- ---------------------------------------------------------------------
-- 5. client_product_artwork -- treatment namespace (Option A, approved).
-- treatment_id IS NULL means "simple/family artwork" -- today's exact,
-- unchanged meaning for every existing row. RESTRICT (not SET NULL, not
-- CASCADE): a treatment disappearing must never silently promote its
-- artwork into ambiguous family-level artwork, and must never silently
-- delete a real, possibly-approved creative asset either. Both would be
-- worse than simply blocking the treatment delete until the artwork is
-- explicitly reassigned or removed by a human decision -- and there is
-- no delete path for treatments in this phase regardless (is_active =
-- false only), so this is a defensive constraint for the schema's
-- future, not something exercised by any code path added here.
-- ---------------------------------------------------------------------

alter table public.client_product_artwork
  add column treatment_id uuid;

alter table public.client_product_artwork
  add constraint client_product_artwork_treatment_family_fkey
    foreign key (treatment_id, client_product_id)
    references public.client_product_treatments (id, client_product_id)
    on delete restrict;

create index client_product_artwork_treatment_id_idx
  on public.client_product_artwork (treatment_id)
  where treatment_id is not null;

-- ---------------------------------------------------------------------
-- 6. Treatment-aware current-artwork uniqueness. coalesce() to a
-- sentinel UUID is required, not optional: a bare
-- (client_product_id, placement, treatment_id) unique index would stop
-- enforcing "one current row" for treatment_id IS NULL rows entirely,
-- since SQL/Postgres treats NULL <> NULL for uniqueness purposes --
-- multiple simple-product current rows for the same placement could
-- then coexist without violating anything, silently breaking every
-- existing product's Phase 1 readiness guarantee. The coalesce collapses
-- every NULL into one shared sentinel bucket, so "no treatment" behaves
-- as exactly one group again -- identical to today's behavior.
-- ---------------------------------------------------------------------

drop index if exists public.client_product_artwork_current_unique_idx;
create unique index client_product_artwork_current_unique_idx
  on public.client_product_artwork (
    client_product_id, placement, coalesce(treatment_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where is_current;

drop index if exists public.client_product_artwork_current_source_asset_uidx;
create unique index client_product_artwork_current_source_asset_uidx
  on public.client_product_artwork (
    client_product_id, placement, coalesce(treatment_id, '00000000-0000-0000-0000-000000000000'::uuid), source_client_asset_id
  )
  where is_current and source_client_asset_id is not null;

-- ---------------------------------------------------------------------
-- 7. Simple-product readiness explicitly namespaced to treatment_id IS
-- NULL. Same function, same signature, same return shape -- every
-- existing caller (get_client_product_reorder_readiness,
-- admin_get_client_product_artwork_readiness, start_client_product_
-- order) is unaffected in behavior for every current product, since
-- every current client_product_artwork row already has treatment_id
-- NULL. The only behavioral change is that a FUTURE treatment-scoped
-- artwork row can never satisfy simple/family readiness -- exactly the
-- namespacing this hardening requires.
-- ---------------------------------------------------------------------

create or replace function public._compute_artwork_readiness(p_client_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  required text[];
  used_legacy_fallback boolean := false;
  result jsonb;
begin
  select required_artwork_placements into required
  from public.client_products where id = p_client_product_id;

  if required is null then
    select array_agg(distinct placement order by placement) into required
    from public.client_product_artwork
    where client_product_id = p_client_product_id
      and treatment_id is null;
    used_legacy_fallback := true;
  end if;

  required := coalesce(required, '{}'::text[]);

  select jsonb_build_object(
    'ready', not exists (
      select 1 from unnest(required) rp
      where not exists (
        select 1 from public.client_product_artwork a
        where a.client_product_id = p_client_product_id
          and a.placement = rp
          and a.treatment_id is null
          and a.is_current = true
          and a.status = 'approved'
      )
    ),
    'required_placements', to_jsonb(required),
    'legacy_fallback', used_legacy_fallback,
    'artwork', coalesce((
      select jsonb_agg(jsonb_build_object(
        'placement', rp,
        'revision_id', best.id,
        'revision', best.revision,
        'status', coalesce(best.status, 'missing'),
        'is_current', coalesce(best.is_current, false),
        'ready', coalesce(best.status = 'approved' and best.is_current = true, false)
      ) order by rp)
      from unnest(required) rp
      left join lateral (
        select a.id, a.revision, a.status, a.is_current
        from public.client_product_artwork a
        where a.client_product_id = p_client_product_id and a.placement = rp and a.treatment_id is null
        order by a.is_current desc, a.revision desc
        limit 1
      ) best on true
    ), '[]'::jsonb),
    'blocking_reasons', coalesce((
      select jsonb_agg(
        case
          when best.id is null then format('%s: no artwork uploaded yet', rp)
          when best.status = 'pending' then format('%s: production file confirmation pending', rp)
          when best.status = 'rejected' then format('%s: changes requested', rp)
          when best.status = 'superseded' then format('%s: newer revision pending approval', rp)
          when best.is_current is not true then format('%s: not the current revision', rp)
          else format('%s: not ready', rp)
        end
        order by rp
      )
      from unnest(required) rp
      left join lateral (
        select a.id, a.revision, a.status, a.is_current
        from public.client_product_artwork a
        where a.client_product_id = p_client_product_id and a.placement = rp and a.treatment_id is null
        order by a.is_current desc, a.revision desc
        limit 1
      ) best on true
      where coalesce(best.status = 'approved' and best.is_current = true, false) = false
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Legacy/customer artwork read path (My Products' raw
-- getMyClientProductArtwork select, and any other direct-table read
-- through this policy) restricted to treatment_id IS NULL -- until a
-- treatment-aware X LAB surface is deliberately built (a later, separate
-- phase), a customer must never see treatment-scoped current+approved
-- artwork leak through the legacy per-placement view. No X LAB code is
-- touched here -- this is the RLS policy the existing X LAB query
-- already depends on.
-- ---------------------------------------------------------------------

drop policy if exists "Client can view current approved artwork on own products" on public.client_product_artwork;
create policy "Client can view current approved artwork on own products"
  on public.client_product_artwork for select
  to authenticated
  using (
    is_current = true
    and status = 'approved'
    and treatment_id is null
    and exists (
      select 1 from public.client_products cp
      where cp.id = client_product_artwork.client_product_id
        and cp.client_id = public.current_client_id()
        and cp.visible_in_account = true
        and cp.status = any (array['ready_for_client_review','client_changes_requested','client_approved','ready_to_order','active'])
    )
  );

commit;
