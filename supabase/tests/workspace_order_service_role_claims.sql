-- Run only against the isolated staging project. Every write rolls back.
begin;
do $test$
declare v_id uuid; v_tenant uuid; v_denied boolean; v_role text;
begin
 select id into v_tenant from public.tenants where slug='joint-x';
 select id into v_id from public.orders where tenant_id=v_tenant limit 1;
 if v_id is null then raise exception 'Missing staging fixture'; end if;
 perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 update public.orders set current_tags=current_tags where id=v_id;
 insert into public.orders(order_number,client_name,tenant_id,total_amount,deposit_paid,source,status,priority,is_archived,products)
 values ('SYNC-GUARD-ROLLBACK-'||gen_random_uuid(),'Sync guard rollback test',v_tenant,0,0,'xlab','confirmed','normal',false,'[]');
 perform set_config('request.jwt.claim.role','service_role',true);
 perform set_config('request.jwt.claims','{}',true);
 update public.orders set current_tags=current_tags where id=v_id;
 foreach v_role in array array['authenticated','anon',''] loop
  perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('role',v_role,'sub',gen_random_uuid(),'user_metadata',jsonb_build_object('role','service_role'))::text,true);
  v_denied:=false;
  begin
   update public.orders set current_tags=current_tags where id=v_id;
  exception when insufficient_privilege then v_denied:=true;
  end;
  if not v_denied then raise exception 'Unauthorized role % passed guard',v_role; end if;
 end loop;
end $test$;
rollback;
