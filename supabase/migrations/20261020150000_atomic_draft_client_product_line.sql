-- Atomic and idempotent preparation-only append for an unconfigured client product.
-- RLS bypass of SECURITY DEFINER is counterbalanced by explicit tenant/orders.write
-- checks, matching order/client ownership and no-active-component assertion.
CREATE OR REPLACE FUNCTION public.opps_add_draft_client_product_line(
  p_order_id uuid,
  p_client_product_id uuid,
  p_line_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_size text DEFAULT '',
  p_color text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_product public.client_products%ROWTYPE;
  v_line jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='You must sign in to add order products.';
  END IF;
  IF p_line_id IS NULL OR p_quantity IS NULL OR p_quantity <= 0
     OR p_unit_price IS NULL OR p_unit_price <= 0
     OR p_quantity > 100000 OR p_unit_price > 100000000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A valid quantity, positive price, and line identifier are required.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Order not found.';
  END IF;
  IF NOT public.has_tenant_permission(v_order.tenant_id,'orders.write') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='This workspace role cannot edit orders.';
  END IF;
  IF v_order.is_archived THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Archived orders cannot be edited.';
  END IF;
  SELECT * INTO v_product FROM public.client_products
    WHERE id=p_client_product_id AND client_id=v_order.client_id AND tenant_id=v_order.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='This client product does not belong to the order client.';
  END IF;

  -- Repeated requests with the SAME ID never create another line.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_order.products,'[]'::jsonb)) AS item
             WHERE item->>'line_id'=p_line_id::text) THEN
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(v_order.products,'[]'::jsonb)) AS item
      WHERE item->>'line_id'=p_line_id::text
        AND item->>'client_product_id'=p_client_product_id::text
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Order line identifier is already assigned to a different product.';
    END IF;
    RETURN jsonb_build_object('line_id',p_line_id,'replayed',true);
  END IF;

  IF EXISTS (SELECT 1 FROM public.product_components
             WHERE client_product_id=p_client_product_id AND is_active=true) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='This product has active components; use the composed-product workflow.';
  END IF;

  v_line := jsonb_build_object(
    'line_id',p_line_id::text,
    'name',v_product.client_facing_name,
    'client_product_id',p_client_product_id::text,
    'source','client_product',
    'line_role','product',
    'quantity',p_quantity,
    'price',p_unit_price,
    'line_total',round(p_quantity*p_unit_price,2),
    'size',coalesce(p_size,''),
    'color',coalesce(p_color,'')
  );
  UPDATE public.orders SET products=coalesce(v_order.products,'[]'::jsonb)||jsonb_build_array(v_line)
    WHERE id=p_order_id;
  RETURN jsonb_build_object('line_id',p_line_id,'replayed',false);
END
$function$;

REVOKE ALL ON FUNCTION public.opps_add_draft_client_product_line(uuid,uuid,uuid,numeric,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.opps_add_draft_client_product_line(uuid,uuid,uuid,numeric,numeric,text,text) TO authenticated;
