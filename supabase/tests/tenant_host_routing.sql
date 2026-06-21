-- Run after 202606210008_tenant_host_routing.sql in a disposable or linked QA database.
-- Read-only assertions. This does not change current public application behavior.

do $$
begin
  if public.normalize_tenant_hostname('OPS.JOINTX.CO.ZA') <> 'ops.jointx.co.za' then
    raise exception 'Hostname normalization failed.';
  end if;

  if public.normalize_tenant_hostname('https://ops.jointx.co.za/track') is not null
    or public.normalize_tenant_hostname('ops.jointx.co.za:443') is not null
    or public.normalize_tenant_hostname('ops.jointx.co.za.') is not null
  then
    raise exception 'Hostname validation accepted an unsafe input.';
  end if;

  if not exists (
    select 1
    from public.resolve_public_tracking_tenant('OPS.JOINTX.CO.ZA')
    where tenant_slug = 'joint-x'
      and hostname = 'ops.jointx.co.za'
  ) then
    raise exception 'Joint X public tracking mapping was not resolved.';
  end if;

  if exists (
    select 1
    from public.resolve_public_tracking_tenant('unknown.example.test')
  ) then
    raise exception 'Unknown hostname resolved to a tenant.';
  end if;
end;
$$;
