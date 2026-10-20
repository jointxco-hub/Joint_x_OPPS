-- Narrow additive patch: preserve the currently installed permission rules.
-- Staging may include payment-projection protections absent in production.
-- Never replace the whole function using a stale environment's definition.
DO $migration$
DECLARE
  existing_ddl text;
  anchor text := '  if public.has_tenant_permission(old.tenant_id,''orders.write'') then';
  tag_exception text := $patch$
  -- Permit only the verified derived order-tag cache refresh (including no-op
  -- trigger updates). All other order columns must remain byte-for-byte equal.
  if (to_jsonb(new) - 'current_tags') = (to_jsonb(old) - 'current_tags')
     and new.current_tags = (
       select coalesce(jsonb_agg(distinct role_key), '[]'::jsonb)
       from public.order_tags
       where order_id = old.id and resolved_at is null
     )
  then
    return new;
  end if;

$patch$;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO existing_ddl
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'enforce_workspace_order_update_scope'
      AND pg_get_function_identity_arguments(p.oid) = '';

  IF existing_ddl IS NULL THEN
    RAISE EXCEPTION 'enforce_workspace_order_update_scope is missing; migration aborted';
  END IF;
  IF position('Permit only the verified derived order-tag cache refresh' in existing_ddl) > 0
     OR position('Allow only a verified cache refresh of derived order tags' in existing_ddl) > 0 THEN
    -- Already applied on staging; do not remove newer protections.
    RETURN;
  END IF;
  IF length(existing_ddl) - length(replace(existing_ddl, anchor, ''))
     <> length(anchor) THEN
    RAISE EXCEPTION 'Permission-function structure changed; patch manually before deploying';
  END IF;
  EXECUTE replace(existing_ddl, anchor, tag_exception || anchor);
END
$migration$;
