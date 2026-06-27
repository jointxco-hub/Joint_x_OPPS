-- Revoke default PUBLIC execute privileges from legacy unscoped X LAB bridge RPCs.
-- The tenant-scoped wrappers remain the only authenticated entry points.

do $$
begin
  if to_regprocedure('public.get_internal_client_requests_unscoped(text,text,text,text,int)') is not null then
    revoke execute on function public.get_internal_client_requests_unscoped(text, text, text, text, int)
      from public, anon, authenticated;
  end if;

  if to_regprocedure('public.update_internal_client_request_status_unscoped(text,uuid,text)') is not null then
    revoke execute on function public.update_internal_client_request_status_unscoped(text, uuid, text)
      from public, anon, authenticated;
  end if;
end;
$$;