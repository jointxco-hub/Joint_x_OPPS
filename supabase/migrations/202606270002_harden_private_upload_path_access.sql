-- Phase 2C.1 corrective hardening.
-- The initial helper allowed parser-null paths to fall through to app-admin
-- recovery. That is safe for simple legacy filenames, but unsafe for malformed
-- slash paths. Slash paths must either be tenant-prefixed or denied.

create or replace function public.is_private_upload_path_accessible(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_path text;
  first_segment text;
  path_tenant_id uuid;
begin
  clean_path := btrim(coalesce(p_path, ''));

  if clean_path = ''
    or clean_path like '/%'
    or clean_path ~ '\\'
    or clean_path like '%..%'
    or clean_path like '%//%'
    or clean_path like '%/./%'
    or clean_path in ('.', '..')
  then
    return false;
  end if;

  if position('/' in clean_path) > 0 then
    first_segment := split_part(clean_path, '/', 1);

    if first_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;

    path_tenant_id := first_segment::uuid;
    return public.can_access_tenant(path_tenant_id);
  end if;

  if clean_path !~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,255}$' then
    return false;
  end if;

  return public.is_app_admin();
end;
$$;

revoke execute on function public.is_private_upload_path_accessible(text) from public, anon;
grant execute on function public.is_private_upload_path_accessible(text) to authenticated;
