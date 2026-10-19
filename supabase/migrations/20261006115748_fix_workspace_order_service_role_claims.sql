-- Backend requests carry the verified role in request.jwt.claims on current PostgREST.
-- Preserve staff/café authorization and support older individual-claim settings.
do $migration$
declare
  v_definition text := pg_get_functiondef('public.enforce_workspace_order_update_scope()'::regprocedure);
  v_old text := $$coalesce(current_setting('request.jwt.claim.role', true),'')='service_role'$$;
  v_new text := $$coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      auth.jwt()->>'role',
      ''
    )='service_role'$$;
begin
  if position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  elsif position(v_new in v_definition) = 0 then
    raise exception 'Workspace order guard changed; inspect before applying this migration';
  end if;
end $migration$;
