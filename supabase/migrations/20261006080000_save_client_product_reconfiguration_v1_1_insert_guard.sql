-- CLIENT PRODUCT RECONFIGURATION — SAVE V1.1 SLICE 2 (backend guard only).
--
-- V1.1 Slice 2 teaches the frontend to send action: "insert" (already
-- fully supported, validated, and audited by the Save V1 RPC shipped in
-- 20261004090000 - see that migration's component loop: insert was
-- always implemented, just never exercised because the frontend
-- unconditionally skipped isNew rows). This migration adds exactly one
-- new rule, scoped to insert only: a brand-new family-level component may
-- only be one of the four canonical commercial types the resolver prices
-- directly (blank_garment, print_service, setup_fee, addon). Reclassifying
-- an EXISTING component via action: "update" is completely unaffected -
-- it keeps the full 8-type set it always had, since legitimate legacy
-- production/BOM rows (material, packaging, labour, other) must remain
-- editable/reclassifiable, only never freshly created through this path
-- (that stays true to V1.1's own explicit scope: commercial composition
-- only, not a general production-component authoring tool).
--
-- Nothing else in save_client_product_reconfiguration changes: same
-- authorization chain, same fingerprint check, same in-transaction
-- resolver call before any commit, same audit/activity writes, same
-- rollback-on-exception guarantee. _xos_client_product_configuration_
-- fingerprint, resolve_client_product_price, and
-- _xos_freeze_client_product_price_breakdown are not touched by this
-- migration at all.

begin;

create or replace function public.save_client_product_reconfiguration(
  p_client_product_id uuid,
  p_expected_fingerprint text,
  p_agreed_price_action text,           -- 'keep' | 'set'  (no 'clear' in V1)
  p_new_agreed_price numeric default null,
  p_components jsonb default '[]'::jsonb,
  p_classification text default null,
  p_divergence_reason text default null,
  p_divergence_note text default null,
  p_incomplete_acknowledged boolean default false,
  p_context text default 'reconfiguration_draft_v1'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  cp                  public.client_products;
  v_actor_uid         uuid;
  v_actor_email       text;
  v_actor_name        text;
  v_pre_fp            text;
  v_post_fp           text;
  v_previous_agreed   numeric;
  v_previous_canonical jsonb;
  v_canonical         jsonb;
  v_new_agreed        numeric;
  v_status            text;
  v_price_changed      boolean;
  v_reason_required    boolean;
  v_entry             jsonb;
  v_action            text;
  v_source_id         uuid;
  v_component_type    text;
  v_billing_mode      text;
  v_qty               numeric;
  v_price             numeric;
  v_label             text;
  v_comp              public.product_components;
  v_new_id            uuid;
  v_added             jsonb := '[]'::jsonb;
  v_removed           jsonb := '[]'::jsonb;
  v_modified          jsonb := '[]'::jsonb;
  v_audit_id          uuid;
  v_event_id          uuid;
begin
  -- ── Authenticated staff actor, resolved server-side only — same
  -- pattern as duplicate_product_composition. Never trust a
  -- client-supplied identity. ─────────────────────────────────────────
  v_actor_uid := auth.uid();
  select u.user_email, u.full_name into v_actor_email, v_actor_name
  from public.users u
  where u.auth_user_id = v_actor_uid and coalesce(u.is_active, true)
  order by u.created_at asc
  limit 1;
  if v_actor_email is null then
    raise exception using errcode = '42501',
      message = 'SAVE_ACTOR_UNRESOLVED: authenticated user does not resolve to a valid OPPS staff identity';
  end if;

  -- ── Lock the target product for the whole transaction. ─────────────
  select * into cp from public.client_products where id = p_client_product_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SAVE_NOT_FOUND: client product does not exist';
  end if;

  -- ── Authorization: the strictest of the two tables' own real RLS
  -- gates, reused verbatim, nothing invented. is_opps_staff() alone is
  -- not tenant-scoped (same precedent resolve_client_product_price
  -- itself follows); inventory_can_review_tenant() is required because
  -- product_components' own INSERT/UPDATE RLS already demands it, and a
  -- SECURITY DEFINER function bypasses that RLS for its own statements,
  -- so this function must reimplement at least as strict a check. ─────
  if not public.is_opps_staff() then
    raise exception using errcode = '42501', message = 'SAVE_FORBIDDEN';
  end if;
  if cp.tenant_id is null or not public.can_access_tenant(cp.tenant_id) then
    raise exception using errcode = '42501', message = 'SAVE_TENANT_DENIED';
  end if;
  if not public.inventory_can_review_tenant(cp.tenant_id) then
    raise exception using errcode = '42501', message = 'SAVE_FORBIDDEN: reviewer access required';
  end if;

  -- ── X LAB commercial guard. Zero real rows carry this link today
  -- (re-verified live during the audit); refusing outright costs
  -- nothing and closes the risk completely rather than attempting a
  -- weaker equality check against a storefront price this system has no
  -- live read path to anyway. ─────────────────────────────────────────
  if cp.xlab_product_id is not null then
    raise exception using errcode = '42501', message = 'SAVE_BLOCKED_XLAB_COMMERCIAL';
  end if;

  -- ── Classification guard: Historical Only / Test-Stale may never
  -- mutate configuration through this RPC — Draft v1 already early-stops
  -- these in the UI; this is the server-side backstop. ────────────────
  if p_classification in ('HISTORICAL_ONLY', 'TEST_STALE') then
    raise exception using errcode = '42501', message = 'SAVE_BLOCKED_CLASSIFICATION';
  end if;

  -- ── Stale-draft fingerprint check, BEFORE any mutation. ─────────────
  v_pre_fp := public._xos_client_product_configuration_fingerprint(p_client_product_id);
  if v_pre_fp is distinct from p_expected_fingerprint then
    raise exception using errcode = '40001', message = 'SAVE_STALE_FINGERPRINT';
  end if;

  v_previous_agreed := cp.client_price;
  v_previous_canonical := public.resolve_client_product_price(p_client_product_id);

  -- ── Agreed-price payload validation. NULL/"clear" is explicitly not
  -- supported in V1 — reject rather than silently inherit the existing
  -- StatusTab clear-price no-op bug. ──────────────────────────────────
  if p_agreed_price_action = 'set' then
    if p_new_agreed_price is null then
      raise exception using errcode = '22023', message = 'SAVE_NULL_PRICE_NOT_SUPPORTED';
    end if;
    if p_new_agreed_price < 0 then
      raise exception using errcode = '22023', message = 'SAVE_NEGATIVE_PRICE';
    end if;
  elsif p_agreed_price_action is distinct from 'keep' then
    raise exception using errcode = '22023', message = 'SAVE_INVALID_PRICE_ACTION';
  end if;

  -- ── Component payload validation + mutation. One entry at a time,
  -- each independently ownership-checked. ─────────────────────────────
  for v_entry in select * from jsonb_array_elements(coalesce(p_components, '[]'::jsonb))
  loop
    v_action := v_entry ->> 'action';

    if v_entry ->> 'source_id' is not null
       and v_entry ->> 'source_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then
      raise exception using errcode = '22023', message = 'SAVE_INVALID_COMPONENT_ID: malformed source_id';
    end if;
    v_source_id := (v_entry ->> 'source_id')::uuid;

    if v_action in ('update', 'remove') then
      if v_source_id is null then
        raise exception using errcode = '22023', message = 'SAVE_COMPONENT_NOT_FOUND: source_id required';
      end if;
      select * into v_comp from public.product_components where id = v_source_id for update;
      if not found or v_comp.client_product_id is distinct from p_client_product_id then
        raise exception using errcode = '42501', message = 'SAVE_CROSS_PRODUCT_COMPONENT';
      end if;
    elsif v_action = 'insert' and v_source_id is not null then
      raise exception using errcode = '22023', message = 'SAVE_INVALID_COMPONENT_ACTION: insert must not supply source_id';
    end if;

    if v_action = 'remove' then
      update public.product_components
        set is_active = false, updated_at = now()
        where id = v_source_id;
      v_removed := v_removed || jsonb_build_array(jsonb_build_object('id', v_source_id));

    elsif v_action in ('update', 'insert') then
      v_component_type := v_entry ->> 'component_type';
      v_billing_mode := coalesce(v_entry ->> 'billing_mode', 'per_unit');
      v_qty := (v_entry ->> 'quantity_per_unit')::numeric;
      v_price := case when v_entry ->> 'default_sell_price' is null then null
                      else (v_entry ->> 'default_sell_price')::numeric end;
      v_label := v_entry ->> 'label';

      if v_component_type not in
         ('blank_garment','print_service','material','packaging','labour','setup_fee','addon','other')
      then
        raise exception using errcode = '22023', message = 'SAVE_INVALID_COMPONENT_TYPE';
      end if;
      -- ── V1.1 Slice 2: a brand-new row may only be one of the four
      -- canonical commercial types - reclassifying an EXISTING row via
      -- 'update' keeps the full set above unchanged. This is the one
      -- new rule this migration adds. ──────────────────────────────
      if v_action = 'insert' and v_component_type not in
         ('blank_garment','print_service','setup_fee','addon')
      then
        raise exception using errcode = '22023', message = 'SAVE_INVALID_NEW_COMPONENT_TYPE';
      end if;
      -- A brand-new row must carry a real label - existing legacy rows
      -- with a null/blank label (confirmed live on both JET and JHG
      -- before their cleanups) may still be reclassified via 'update'
      -- without ever being forced to backfill one; only a FRESH insert
      -- is held to this bar, since the entire point of V1.1 is replacing
      -- anonymous backfilled rows with real, labeled composition.
      if v_action = 'insert' and (v_label is null or btrim(v_label) = '') then
        raise exception using errcode = '22023', message = 'SAVE_COMPONENT_LABEL_REQUIRED';
      end if;
      if v_billing_mode not in ('per_unit', 'once_per_order') then
        raise exception using errcode = '22023', message = 'SAVE_INVALID_BILLING_MODE';
      end if;
      if v_qty is null or v_qty <= 0 then
        raise exception using errcode = '22023', message = 'SAVE_INVALID_QUANTITY';
      end if;
      if v_price is not null and v_price < 0 then
        raise exception using errcode = '22023', message = 'SAVE_NEGATIVE_COMPONENT_PRICE';
      end if;

      if v_action = 'update' then
        update public.product_components
          set component_type = v_component_type,
              billing_mode = v_billing_mode,
              default_sell_price = v_price,
              quantity_per_unit = v_qty,
              label = v_label,
              updated_at = now()
          where id = v_source_id;
        v_modified := v_modified || jsonb_build_array(jsonb_build_object('id', v_source_id));
      else
        insert into public.product_components (
          tenant_id, client_product_id, component_type, billing_mode,
          default_sell_price, quantity_per_unit, label,
          garment_variant_id, treatment_id, created_by
        ) values (
          cp.tenant_id, p_client_product_id, v_component_type, v_billing_mode,
          v_price, v_qty, v_label,
          null, null, v_actor_uid
        )
        returning id into v_new_id;
        v_added := v_added || jsonb_build_array(jsonb_build_object('id', v_new_id));
      end if;
    else
      raise exception using errcode = '22023', message = 'SAVE_INVALID_COMPONENT_ACTION';
    end if;
  end loop;

  -- ── Apply the agreed-price change, if any. ──────────────────────────
  if p_agreed_price_action = 'set' then
    update public.client_products
      set client_price = p_new_agreed_price, updated_by = v_actor_email
      where id = p_client_product_id;
  end if;

  -- ── Canonical verification: the EXISTING, unmodified resolver, called
  -- inside this same transaction so it sees the tentative rows above.
  -- No arithmetic is duplicated here — whatever it returns is final. ──
  v_canonical := public.resolve_client_product_price(p_client_product_id);
  v_new_agreed := (v_canonical ->> 'agreed_unit_price')::numeric;
  v_status := v_canonical ->> 'reconciliation_status';

  -- ── Authoritative divergence/incomplete rules, derived ONLY from the
  -- resolver's honest post-mutation output — never from client claims.
  -- Acknowledging incompleteness never converts 'unresolved_components'
  -- into 'reconciled'; the returned canonical state says exactly what
  -- the resolver says, always. ────────────────────────────────────────
  v_price_changed := (v_previous_agreed is distinct from v_new_agreed);
  v_reason_required := v_price_changed or (v_status = 'diverged');

  if v_reason_required and (p_divergence_reason is null or btrim(p_divergence_reason) = '') then
    raise exception using errcode = '22023', message = 'SAVE_DIVERGENCE_REASON_REQUIRED';
  end if;
  if v_status = 'unresolved_components' and not p_incomplete_acknowledged then
    raise exception using errcode = '22023', message = 'SAVE_INCOMPLETE_UNACKNOWLEDGED';
  end if;

  v_post_fp := public._xos_client_product_configuration_fingerprint(p_client_product_id);

  -- ── Audit: one structured row, then one companion activity-feed
  -- event, same transaction. If either insert fails, the whole save
  -- rolls back — there is no path where a mutation commits without its
  -- audit trail. ──────────────────────────────────────────────────────
  insert into public.client_product_reconfiguration_events (
    tenant_id, client_product_id, actor_auth_user_id, actor_email, actor_name,
    context, classification, divergence_reason, divergence_note, incomplete_acknowledged,
    previous_agreed_price, new_agreed_price,
    previous_canonical_status, new_canonical_status,
    components_added, components_removed, components_modified,
    pre_fingerprint, post_fingerprint
  ) values (
    cp.tenant_id, p_client_product_id, v_actor_uid, v_actor_email, v_actor_name,
    p_context, p_classification, p_divergence_reason, p_divergence_note, p_incomplete_acknowledged,
    v_previous_agreed, v_new_agreed,
    v_previous_canonical ->> 'reconciliation_status', v_status,
    v_added, v_removed, v_modified,
    v_pre_fp, v_post_fp
  )
  returning id into v_audit_id;

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    cp.tenant_id, v_actor_email, v_actor_name, 'client_product_reconfigured', 'client_products', p_client_product_id,
    format('%s reconfigured %s (%s added, %s removed, %s modified)',
      coalesce(v_actor_name, 'Staff'), cp.client_facing_name,
      jsonb_array_length(v_added), jsonb_array_length(v_removed), jsonb_array_length(v_modified)),
    jsonb_build_object(
      'reconfiguration_event_id', v_audit_id,
      'previous_agreed_price', v_previous_agreed,
      'new_agreed_price', v_new_agreed,
      'previous_canonical_status', v_previous_canonical ->> 'reconciliation_status',
      'new_canonical_status', v_status
    )
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'client_product_id', p_client_product_id,
    'agreed_price', v_new_agreed,
    'canonical', v_canonical,
    'new_fingerprint', v_post_fp,
    'components_added', v_added,
    'components_removed', v_removed,
    'components_modified', v_modified,
    'audit_event_id', v_audit_id,
    'activity_event_id', v_event_id
  );
end;
$function$;

revoke all on function public.save_client_product_reconfiguration(
  uuid, text, text, numeric, jsonb, text, text, text, boolean, text
) from public, anon;
grant execute on function public.save_client_product_reconfiguration(
  uuid, text, text, numeric, jsonb, text, text, text, boolean, text
) to authenticated;

commit;
