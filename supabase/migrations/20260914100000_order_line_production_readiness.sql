-- ORDERS CLIENT-PRODUCT REUSE — PHASE 2: server-side production
-- readiness gate for order lines.
--
-- ── Source audit (see PR description for the full writeup) ───────────
-- Three existing "readiness" concepts were found and are intentionally
-- left untouched by this migration:
--   1. public._compute_artwork_readiness / get_client_product_reorder_
--      readiness / admin_get_client_product_artwork_readiness (X LAB,
--      202608240001) — PRE-ORDER, per-client-product artwork readiness,
--      exact-string placement matching. A different axis (evaluates a
--      client_product in isolation, not a frozen order line).
--   2. public.get_order_production_readiness / order_production_
--      readiness_checks (OPPS, 202605240003) — ORDER-level manual staff
--      checklist (quote approved / files attached / tech pack / balance
--      / contract). A different axis (commercial/compliance, not
--      per-line production feasibility).
--   3. ProductsEditor.jsx's LineProduction component — two ad hoc,
--      unpersisted badges ("composition not attached", "unresolved
--      variant"), no RPC, no structured reasons.
-- No existing function evaluates per-order-line production feasibility
-- against the FROZEN order_line_component_snapshots. This migration
-- adds exactly that, under new names, so it cannot collide with #1/#2.
--
-- ── Frozen-order-truth policy (Phase 2 §5) ────────────────────────────
-- Every production/artwork/variant check below reads ONLY the frozen
-- order_line_component_snapshots row (component_type, production_method,
-- placement, resolved_inventory_variant_id, artwork_revision_ids) — it
-- never re-reads live product_components or re-follows a live
-- client_product_artwork placement match. A later edit to the source
-- client product never silently changes what an existing order line
-- reports as ready/blocked.
-- The one deliberate exception is commercial/approval state
-- (requires_quote / client_price / the client-product's CURRENT
-- revision + approval), which is read LIVE from client_products /
-- client_approvals — Phase 2 §5 explicitly carves this out ("approval
-- validity must still respect whatever revision relationship is
-- canonically required"), and it mirrors exactly what
-- start_client_product_order's own hard gate already does.
--
-- ── Rule matrix — blockers ────────────────────────────────────────────
--   NO_CURRENT_SNAPSHOT        no is_current snapshot rows for this line
--   MISSING_BASE_COMPONENT     snapshots exist but none is component_type
--                              'blank_garment' — a partial/corrupted
--                              attach, not a live-vs-frozen comparison
--   VARIANT_UNRESOLVED         a stock-linked component
--                              (inventory_product_id set) has no
--                              resolved_inventory_variant_id. Covers BOTH
--                              "zero candidates" and "multiple candidates
--                              unresolved" from the spec — nothing is
--                              persisted that distinguishes those two at
--                              read time (that distinction lives only in
--                              the client-side resolver, transiently), so
--                              both collapse to one code. Documented, not
--                              silently merged.
--   PRODUCTION_METHOD_MISSING  a print_service component has no
--                              production_method
--   PLACEMENT_MISSING          a print_service component has no placement
--   ARTWORK_MISSING            a print_service component has a placement
--                              but no frozen artwork_revision_ids
--   ARTWORK_PLACEMENT_AMBIGUOUS two distinct frozen artwork_revision_ids
--                              on the same component canonicalize
--                              (canonical_placement) to the same
--                              placement — the same row, apparently
--                              frozen twice under different spellings
--   ARTWORK_REVISION_INVALID  a frozen artwork_revision_id no longer
--                              exists in client_product_artwork at all
--                              (the row was hard-deleted) — NOT "no
--                              longer current/approved", which is a live-
--                              state fact this migration deliberately
--                              does not re-check (frozen-truth)
--   PRICE_UNRESOLVED           the frozen line has no usable price AND
--                              the source client_product currently has
--                              requires_quote = true or no client_price —
--                              a live check, per the §5 carve-out above
--   CUSTOMER_APPROVAL_MISSING  public._client_product_has_current_
--                              approval(client_product_id, <CURRENT live
--                              revision>) is false. This treats "never
--                              approved" and "approved on a prior
--                              revision" identically, because the
--                              existing canonical helper (reused as-is,
--                              per instruction — never re-derived) already
--                              defines "current approval" that way; it is
--                              the same predicate start_client_product_
--                              order already hard-gates on. Not a new
--                              interpretation introduced by this phase.
--   NOT explicitly implemented: "component explicitly requires review" —
--   no schema column expresses this on product_components or its
--   snapshot today; inventing one is out of scope for this phase.
--
-- ── Rule matrix — warnings (never block) ──────────────────────────────
--   PRODUCTION_NOTES_ABSENT    a 'custom'/'mixed' production_method
--                              component has neither specification nor
--                              production_instructions
--   OPTIONAL_ARTWORK_ABSENT    a non-print_service component has a
--                              placement but no frozen artwork
--   SOURCE_CLIENT_PRODUCT_EDITED  re-deriving the live composed price
--                              breakdown for this client product no
--                              longer matches what was frozen on this
--                              line — informational only, the frozen
--                              content is never rewritten
--
-- ── Status model ───────────────────────────────────────────────────────
-- Per line: blocking_reasons non-empty -> 'blocked'; else warnings
-- non-empty -> 'needs_review'; else 'ready'.
-- Per order (Phase 2 §7): any line 'blocked' -> 'blocked'; else any line
-- 'needs_review' -> 'ready_with_warnings'; else (incl. zero eligible
-- lines) -> 'ready'. setup_fee/breakdown lines and any line with no
-- client_product_id are excluded from evaluation and from the aggregate
-- entirely (mirrors src/features/orders/lineConfiguration.js's existing
-- hasProductionIdentity/isProductionCapableLine gate, narrowed further to
-- client-product-linked lines since that is this system's whole domain).
--
-- STAGING ONLY in this phase — not applied to production.

begin;

-- ---------------------------------------------------------------------
-- 1. Internal computation — no auth check (caller's job). Pure read of
-- frozen snapshot state + a narrow, documented live carve-out for
-- commercial/approval state. Used by both the staff-facing RPC (with its
-- own auth) and the production-transition trigger (already running
-- inside an authorized UPDATE).
-- ---------------------------------------------------------------------

create or replace function public._compute_order_line_production_readiness(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_order public.orders;
  v_line jsonb;
  v_line_id text;
  v_client_product_id uuid;
  cp public.client_products;
  v_snapshots jsonb;
  v_snap jsonb;
  v_blockers jsonb;
  v_warnings jsonb;
  v_status text;
  v_lines jsonb := '[]'::jsonb;
  v_order_readiness text := 'ready';
  v_has_current_approval boolean;
  v_frozen_pb jsonb;
  v_live_pb jsonb;
  v_frozen_qty numeric;
  v_frozen_unit numeric;
  v_component_types text[];
  v_ambiguous boolean;
  v_invalid_artwork boolean;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_READINESS_ORDER_NOT_FOUND';
  end if;

  for v_line in
    select * from jsonb_array_elements(coalesce(v_order.products, '[]'::jsonb))
    where coalesce(nullif(value ->> 'line_role', ''), 'product') = 'product'
      and nullif(value ->> 'client_product_id', '') is not null
  loop
    v_line_id := v_line ->> 'line_id';
    v_client_product_id := (v_line ->> 'client_product_id')::uuid;
    v_blockers := '[]'::jsonb;
    v_warnings := '[]'::jsonb;

    select coalesce(jsonb_agg(to_jsonb(s.*) order by s.sort_order, s.created_at), '[]'::jsonb)
      into v_snapshots
      from public.order_line_component_snapshots s
      where s.order_id = p_order_id and s.line_id = v_line_id and s.is_current;

    if jsonb_array_length(v_snapshots) = 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'NO_CURRENT_SNAPSHOT',
        'message', 'This line has no current production snapshot — attach a composition before it can go into production.'
      ));
    else
      select array_agg(distinct s ->> 'component_type') into v_component_types
        from jsonb_array_elements(v_snapshots) s;

      if not ('blank_garment' = any (v_component_types)) then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'MISSING_BASE_COMPONENT',
          'message', 'No base garment component was found in this line''s frozen composition.'
        ));
      end if;

      for v_snap in select * from jsonb_array_elements(v_snapshots) loop
        -- VARIANT_UNRESOLVED — any stock-linked component with no resolved variant.
        if nullif(v_snap ->> 'inventory_product_id', '') is not null
           and nullif(v_snap ->> 'resolved_inventory_variant_id', '') is null then
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'VARIANT_UNRESOLVED',
            'message', format('%s: no exact stock variant is resolved.', coalesce(v_snap ->> 'label', v_snap ->> 'component_type'))
          ));
        end if;

        if v_snap ->> 'component_type' = 'print_service' then
          if nullif(v_snap ->> 'production_method', '') is null then
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'PRODUCTION_METHOD_MISSING',
              'message', format('%s: no production method set.', coalesce(v_snap ->> 'label', 'Print component'))
            ));
          end if;
          if nullif(v_snap ->> 'placement', '') is null then
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'PLACEMENT_MISSING',
              'message', format('%s: no placement set.', coalesce(v_snap ->> 'label', 'Print component'))
            ));
          end if;

          if jsonb_typeof(coalesce(v_snap -> 'artwork_revision_ids', 'null'::jsonb)) <> 'array'
             or jsonb_array_length(v_snap -> 'artwork_revision_ids') = 0 then
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'ARTWORK_MISSING',
              'message', format('%s: required artwork is missing.', coalesce(v_snap ->> 'label', 'Print component'))
            ));
          else
            -- ARTWORK_REVISION_INVALID — a frozen id that no longer exists at all.
            select exists (
              select 1 from jsonb_array_elements_text(v_snap -> 'artwork_revision_ids') aid
              where not exists (
                select 1 from public.client_product_artwork a where a.id = aid::uuid
              )
            ) into v_invalid_artwork;
            if v_invalid_artwork then
              v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
                'code', 'ARTWORK_REVISION_INVALID',
                'message', format('%s: a frozen artwork revision no longer exists.', coalesce(v_snap ->> 'label', 'Print component'))
              ));
            end if;

            -- ARTWORK_PLACEMENT_AMBIGUOUS — two frozen ids canonicalize to the same placement.
            select exists (
              select 1
              from jsonb_array_elements_text(v_snap -> 'artwork_revision_ids') aid
              join public.client_product_artwork a on a.id = aid::uuid
              group by public.canonical_placement(a.placement)
              having count(*) > 1
            ) into v_ambiguous;
            if v_ambiguous then
              v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
                'code', 'ARTWORK_PLACEMENT_AMBIGUOUS',
                'message', format('%s: more than one frozen artwork revision resolves to the same placement.', coalesce(v_snap ->> 'label', 'Print component'))
              ));
            end if;
          end if;
        elsif v_snap ->> 'component_type' not in ('setup_fee') then
          -- OPTIONAL_ARTWORK_ABSENT — non-print component with a placement but no artwork (warning only).
          if nullif(v_snap ->> 'placement', '') is not null
             and (jsonb_typeof(coalesce(v_snap -> 'artwork_revision_ids', 'null'::jsonb)) <> 'array'
                  or jsonb_array_length(v_snap -> 'artwork_revision_ids') = 0) then
            v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
              'code', 'OPTIONAL_ARTWORK_ABSENT',
              'message', format('%s: no artwork attached (optional for this component type).', coalesce(v_snap ->> 'label', v_snap ->> 'component_type'))
            ));
          end if;
        end if;

        -- PRODUCTION_NOTES_ABSENT — custom/mixed method with no spec/instructions (warning only).
        if v_snap ->> 'production_method' in ('custom', 'mixed')
           and nullif(v_snap ->> 'specification', '') is null
           and nullif(v_snap ->> 'production_instructions', '') is null then
          v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
            'code', 'PRODUCTION_NOTES_ABSENT',
            'message', format('%s: no specification or production instructions on file for a custom/mixed method.', coalesce(v_snap ->> 'label', v_snap ->> 'component_type'))
          ));
        end if;
      end loop;
    end if;

    -- ── Live carve-out: commercial state + approval (Phase 2 §5) ───────
    select * into cp from public.client_products where id = v_client_product_id;
    if found then
      -- PRICE_UNRESOLVED — either sub-condition alone blocks: the source
      -- commercial state still requires a quote, OR neither the source
      -- nor the already-frozen line carries a usable price.
      if cp.requires_quote is true
         or (cp.client_price is null and coalesce((v_line ->> 'price')::numeric, 0) <= 0) then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'PRICE_UNRESOLVED',
          'message', 'This product still requires a quote or has no usable price.'
        ));
      end if;

      v_has_current_approval := public._client_product_has_current_approval(v_client_product_id, cp.revision);
      if not v_has_current_approval then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'CUSTOMER_APPROVAL_MISSING',
          'message', 'The current revision of this product has not been approved by the client.'
        ));
      end if;

      -- SOURCE_CLIENT_PRODUCT_EDITED — informational only; never rewrites the frozen line.
      v_frozen_pb := v_line -> 'price_breakdown';
      if v_frozen_pb is not null and v_frozen_pb ->> 'mode' = 'composed' then
        v_frozen_qty := coalesce((v_line ->> 'quantity')::numeric, 1);
        v_frozen_unit := coalesce(v_frozen_pb ->> 'unit_price', v_line ->> 'price')::numeric;
        v_live_pb := public._xos_freeze_client_product_price_breakdown(v_client_product_id, v_frozen_qty, v_frozen_unit);
        if v_live_pb is null
           or (v_live_pb -> 'per_unit') is distinct from (v_frozen_pb -> 'per_unit') then
          v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
            'code', 'SOURCE_CLIENT_PRODUCT_EDITED',
            'message', 'The source client product has changed since this order line was created; this order keeps its original frozen configuration.'
          ));
        end if;
      end if;
    end if;

    if jsonb_array_length(v_blockers) > 0 then
      v_status := 'blocked';
      v_order_readiness := 'blocked';
    elsif jsonb_array_length(v_warnings) > 0 then
      v_status := 'needs_review';
      if v_order_readiness <> 'blocked' then v_order_readiness := 'ready_with_warnings'; end if;
    else
      v_status := 'ready';
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_id', v_line_id,
      'client_product_id', v_client_product_id,
      'status', v_status,
      'blocking_reasons', v_blockers,
      'warnings', v_warnings,
      'component_count', jsonb_array_length(v_snapshots),
      'evaluated_at', now()
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'order_readiness', v_order_readiness,
    'evaluated_at', now(),
    'lines', v_lines
  );
end;
$$;

revoke all on function public._compute_order_line_production_readiness(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Staff-facing, tenant-safe, batch (order-level) RPC. Section 6/7:
-- one canonical call per order, not N+1 per line.
-- ---------------------------------------------------------------------

create or replace function public.get_order_line_production_readiness(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_order public.orders;
begin
  if not public.is_opps_staff() then
    raise exception using errcode = '42501', message = 'ORDER_READINESS_FORBIDDEN: no staff access';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_READINESS_ORDER_NOT_FOUND';
  end if;
  if v_order.tenant_id is null or not public.can_access_tenant(v_order.tenant_id) then
    raise exception using errcode = '42501', message = 'ORDER_READINESS_TENANT_DENIED';
  end if;

  return public._compute_order_line_production_readiness(p_order_id);
end;
$$;

revoke all on function public.get_order_line_production_readiness(uuid) from public, anon;
grant execute on function public.get_order_line_production_readiness(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Status-transition gate (Section 9). The "Next: In Production"
-- button in OrderDrawer.jsx calls onUpdate(order.id, { status:
-- 'in_production' }) -> a generic PostgREST `update orders set ...`
-- (src/lib/checkedUpdate.js) with NO readiness check anywhere in that
-- path today. That is also the ONLY path any direct-API caller would
-- use — there is no separate "advance to production" RPC to gate
-- instead. A BEFORE UPDATE trigger is therefore the only enforcement
-- point that covers the UI button AND a direct PostgREST/API call
-- alike, matching the exact pattern already used for client_products'
-- own ready_to_order transition guard (202608240001,
-- _enforce_client_product_ready_to_order_artwork_guard).
-- ---------------------------------------------------------------------

create or replace function public._enforce_order_production_readiness_gate()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_readiness jsonb;
  v_reasons text;
begin
  -- Scope: this is a BEFORE UPDATE trigger, gating the transition INTO
  -- 'in_production' from any other status — the actual mutation the
  -- "Next: In Production" button (and any direct API caller) performs.
  -- Not attached to INSERT: no known path creates an order pre-set to
  -- 'in_production' (sync-to-opps always creates orders in an initial
  -- status), and a BEFORE INSERT trigger cannot read `new` back out of
  -- the table to reuse this same read-by-id computation function — doing
  -- that safely would need a second, NEW-row-shaped code path. Reported
  -- as a scope boundary rather than half-implemented.
  if new.status = 'in_production' and old.status is distinct from 'in_production' then
    v_readiness := public._compute_order_line_production_readiness(new.id);
    if v_readiness ->> 'order_readiness' = 'blocked' then
      select string_agg(format('%s: %s', bl.line_id, bl.reason), '; ') into v_reasons
      from (
        select l ->> 'line_id' as line_id, r ->> 'message' as reason
        from jsonb_array_elements(v_readiness -> 'lines') l
        cross join lateral jsonb_array_elements(l -> 'blocking_reasons') r
        where l ->> 'status' = 'blocked'
      ) bl;
      raise exception using errcode = 'P0001',
        message = format('ORDER_NOT_PRODUCTION_READY: this order has blocked production line(s) and cannot move to In Production — %s', coalesce(v_reasons, 'see readiness detail'));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_production_readiness_gate on public.orders;
create trigger orders_production_readiness_gate
  before update on public.orders
  for each row
  execute function public._enforce_order_production_readiness_gate();

commit;
