-- ACCESS-01A: harden the existing XOS admin host gate without changing its
-- signature, body, return contract, SECURITY DEFINER mode, or EXECUTE ACL.
alter function public.resolve_xos_admin_gate(text)
  set search_path = pg_catalog, public;
