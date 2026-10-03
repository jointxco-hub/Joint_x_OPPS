-- Canonical Price Resolution v1 -- a new, additive, read-only diagnostic RPC.
--
-- Purely additive. Creates exactly ONE new function. Does NOT alter
-- client_products, product_components, _xos_freeze_client_product_price_breakdown,
-- admin_get_client_product_price_composition, xos_add_composed_client_product_to_order,
-- any quote/invoice/checkout function, or any frontend file. Confirmed via
-- hash comparison (see companion verification) that all of the above are
-- byte-identical before and after this migration.
--
-- Built on the "Canonical Product & Pricing Audit" and the follow-on
-- "Canonical Price Resolution V1 -- Design" document, with these product
-- decisions locked before this migration was written:
--
--   1. Auth: BOTH is_opps_staff() AND can_access_tenant(client_product.tenant_id)
--      are required -- copying public.admin_get_client_product_price_composition's
--      exact precedent. is_opps_staff() alone is NOT tenant-scoped (it is
--      true for e.g. any joint-x member regardless of which tenant's
--      client_product is being queried) -- verified by reading its live
--      source. No new app-admin cross-tenant bypass is added:
--      can_access_tenant() itself has none (it is pure active-membership
--      lookup, verified by reading its live source), and this function
--      must not invent one the precedent doesn't have.
--   2. client_products.client_price remains the persisted agreed
--      commercial price -- not touched, not renamed, not deprecated.
--   3. client_price = 0 is a VALID agreed price, not treated as unset.
--      Live proof this matters: client_product 'JET T-Shirt'
--      (ad8b43b1-31d3-4370-ada3-431238a6a59e) has client_price = 0 against
--      a real component sum of 393 -- this resolver must report that as
--      agreed_unit_price = 0, effective_unit_price = 0, price_source =
--      'agreed', reconciliation_status = 'diverged', not silently treat
--      the 0 as if it were NULL.
--   4. No computed-price fallback in v1. Effective-price precedence is
--      exactly override -> agreed client_price -> 0, matching
--      xos_add_composed_client_product_to_order's live
--      coalesce(p_unit_price, cp.client_price, 0) rule exactly. Computed
--      component price is diagnostic-only; it never becomes the
--      commercial price in this slice.
--   5. price_source is one of 'override' | 'agreed' | 'default_zero'.
--      'computed' is deliberately never emitted in v1 -- reserved
--      conceptually for a future v2 fallback mode, not implemented here.
--   6. override = 0 is valid; a negative override is rejected outright
--      (the existing mutating RPC has no such guard at all -- this is a
--      new, stricter rule for this new read-only surface, not a change
--      to that RPC).
--   7. quantity must be a positive, finite number. Explicit NULL, zero,
--      negative, or NaN is rejected -- never silently coalesced to 1 the
--      way the mutating RPC coalesces its own quantity. The default of 1
--      applies only when the argument is OMITTED, via ordinary Postgres
--      default-parameter semantics (an explicitly-passed NULL still
--      reaches the function body as NULL and is rejected).
--   8. Diagnostic only: requires_quote = true still returns full pricing/
--      composition information. Never creates or modifies anything.
--      Transactional enforcement of requires_quote stays entirely outside
--      this function, exactly as today.
--   9. garment_variants.price_override and treatments.surcharge are
--      deliberately NOT read anywhere in this function -- they remain
--      orphaned/preview-only pending a later, separate product decision.
--  10. Component scope/type filtering is reused byte-for-byte from
--      _xos_freeze_client_product_price_breakdown (family-scope only;
--      blank_garment/print_service/setup_fee/addon only). material/
--      packaging/labour/other remain excluded in v1 -- no normalization
--      of component_role happens in this migration.
--  11. No canonical order-total field. Returns unit pricing, quantity,
--      the component breakdown, and once-per-order fee information only --
--      no effective_unit_total, no once_fee_total, no order total.
--  12. No artwork, production geometry, placement coordinates, machine
--      settings, production templates, or print-ready output -- confirmed
--      absent from this function's inputs, outputs, and table reads.
--
-- computed_unit_price derivation -- proved, not assumed:
-- _xos_freeze_client_product_price_breakdown computes
-- `difference := round(v_unit - v_per_s, 2)`, where v_unit is whatever
-- price is passed in as p_agreed_unit_price and v_per_s (the component
-- sum) is computed purely from product_components, independent of
-- v_unit. Passing the EFFECTIVE price as v_unit (exactly as both existing
-- callers already do) therefore makes `computed_unit_price :=
-- effective_unit_price - difference` an exact algebraic identity, not an
-- approximation. Verified empirically against two real production rows
-- before this migration was written (read-only, no data changed):
--   'JET T-Shirt' (ad8b43b1-...): effective=0,  difference=-393.00 -> derived computed=393.00 (matches real component sum)
--   'Kids Tee'    (09ed5ef0-...): effective=180, difference=-9.00  -> derived computed=189.00 (matches real component sum)
-- No component-price arithmetic is reimplemented anywhere in this function.

CREATE OR REPLACE FUNCTION public.resolve_client_product_price(
  p_client_product_id uuid,
  p_quantity numeric DEFAULT 1,
  p_override_unit_price numeric DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  cp             public.client_products;
  v_qty          numeric := p_quantity;
  v_override     numeric := p_override_unit_price;
  v_agreed       numeric;
  v_effective    numeric;
  v_price_source text;
  v_pb           jsonb;
  v_computed     numeric;
  v_status       text;
begin
  -- ── Input validation: explicit bad input is rejected outright, never
  -- silently normalized (product decisions 6/7 above). ──────────────────
  if v_qty is null or v_qty <= 0 or v_qty = 'NaN'::numeric then
    raise exception using errcode = '22023',
      message = 'RESOLVE_PRICE_INVALID_QUANTITY: quantity must be a positive, finite number';
  end if;

  if v_override is not null and v_override < 0 then
    raise exception using errcode = '22023',
      message = 'RESOLVE_PRICE_INVALID_OVERRIDE: override price cannot be negative';
  end if;

  select * into cp from public.client_products where id = p_client_product_id;
  if not found then
    raise exception using errcode = 'P0001',
      message = 'RESOLVE_PRICE_CLIENT_PRODUCT_NOT_FOUND';
  end if;

  -- ── Tenant safety: copies admin_get_client_product_price_composition's
  -- exact precedent -- is_opps_staff() alone is not tenant-scoped, so an
  -- explicit can_access_tenant() check on THIS client_product's own
  -- tenant_id is required too. Cross-tenant staff fail here even though
  -- is_opps_staff() itself returned true. No app-admin bypass is added --
  -- can_access_tenant() has none, and this function must not invent one
  -- the precedent doesn't have (product decision 1). ────────────────────
  if not public.is_opps_staff() then
    raise exception using errcode = '42501',
      message = 'RESOLVE_PRICE_FORBIDDEN';
  end if;
  if cp.tenant_id is null or not public.can_access_tenant(cp.tenant_id) then
    raise exception using errcode = '42501',
      message = 'RESOLVE_PRICE_TENANT_DENIED';
  end if;

  v_agreed := cp.client_price;

  -- ── Effective-price precedence: override -> agreed -> 0 (product
  -- decisions 3/4/5). client_price = 0 is a real, valid agreed price --
  -- it is read via `v_agreed is not null`, not `v_agreed > 0`, so an
  -- explicit zero takes the 'agreed' branch, never the 'default_zero'
  -- branch. ───────────────────────────────────────────────────────────
  if v_override is not null then
    v_effective := v_override;
    v_price_source := 'override';
  elsif v_agreed is not null then
    v_effective := v_agreed;
    v_price_source := 'agreed';
  else
    v_effective := 0;
    v_price_source := 'default_zero';
  end if;

  -- ── Reuse the existing composition primitive unchanged, passing the
  -- EFFECTIVE price as its own agreed-price parameter -- exactly what
  -- admin_get_client_product_price_composition and
  -- xos_add_composed_client_product_to_order already do. This is the
  -- ONLY interaction this function has with
  -- _xos_freeze_client_product_price_breakdown; nothing from it is
  -- duplicated. ──────────────────────────────────────────────────────
  v_pb := public._xos_freeze_client_product_price_breakdown(p_client_product_id, v_qty, v_effective);

  if v_pb is null then
    v_status := 'no_composition';
    v_computed := null;
  else
    -- Proved identity (see migration header): computed = effective - difference.
    v_computed := round(v_effective - (v_pb ->> 'difference')::numeric, 2);

    -- Deterministic priority, matching how xos_add_composed_client_product_to_order
    -- itself orders these same two conditions: an unresolved component
    -- always takes priority over the reconciled/diverged distinction,
    -- since a sum missing a price can't be trusted either way.
    if jsonb_array_length(coalesce(v_pb -> 'unresolved_components', '[]'::jsonb)) > 0 then
      v_status := 'unresolved_components';
    elsif (v_pb ->> 'reconciled')::boolean then
      v_status := 'reconciled';
    else
      v_status := 'diverged';
    end if;
  end if;

  return jsonb_build_object(
    'client_product_id',     p_client_product_id,
    'quantity',               v_qty,
    'computed_unit_price',    v_computed,
    'agreed_unit_price',      v_agreed,
    'override_unit_price',    v_override,
    'effective_unit_price',   v_effective,
    'price_source',           v_price_source,
    'reconciliation_status',  v_status,
    'requires_quote',         cp.requires_quote,
    'unresolved_components',  coalesce(v_pb -> 'unresolved_components', '[]'::jsonb),
    'per_unit_components',    coalesce(v_pb -> 'per_unit', '[]'::jsonb),
    'once_per_order_fees',    coalesce(v_pb -> 'once_per_order_fees', '[]'::jsonb),
    'breakdown',              v_pb
  );
end;
$function$;

-- ACL mirrors admin_get_client_product_price_composition exactly: no
-- public/anon execution, staff-only via is_opps_staff() inside the body.
revoke all on function public.resolve_client_product_price(uuid, numeric, numeric) from public;
grant execute on function public.resolve_client_product_price(uuid, numeric, numeric) to authenticated, service_role;
