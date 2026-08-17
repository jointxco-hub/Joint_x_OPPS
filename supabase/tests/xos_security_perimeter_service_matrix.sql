\set ON_ERROR_STOP on
set role service_role;
do $$
begin
  if (select count(*) from public.orders) <> 3 then
    raise exception 'service_role did not preserve full order access';
  end if;
  if not has_function_privilege('service_role','public.upsert_opps_conversation(uuid,text,text,text,text)','EXECUTE') then
    raise exception 'service_role lost backend helper execution';
  end if;
  if has_function_privilege('authenticated','public.upsert_opps_conversation(uuid,text,text,text,text)','EXECUTE') then
    raise exception 'authenticated retained backend helper execution';
  end if;
end
$$;
reset role;
select 'XOS_SECURITY_PERIMETER_SERVICE_MATRIX_OK' as result;
