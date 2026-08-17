begin;

alter table public.client_file_links
  add column if not exists linked_quote_request_id uuid references public.client_quote_requests(id) on delete cascade,
  add column if not exists request_role text,
  add column if not exists is_request_primary boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.client_file_links'::regclass and conname = 'client_file_links_request_role_check') then
    alter table public.client_file_links add constraint client_file_links_request_role_check check (
      (linked_quote_request_id is null and request_role is null and is_request_primary = false)
      or (linked_quote_request_id is not null and request_role in ('mockup','artwork','print_file','reference','proof','production_photo','other'))
    );
  end if;
end;
$$;

create index if not exists idx_client_file_links_quote_request on public.client_file_links (linked_quote_request_id, created_at);
create unique index if not exists idx_client_file_links_quote_request_url_unique on public.client_file_links (linked_quote_request_id, file_url) where linked_quote_request_id is not null;
create unique index if not exists idx_client_file_links_quote_request_primary_unique on public.client_file_links (linked_quote_request_id) where linked_quote_request_id is not null and is_request_primary = true;

alter table public.orders add column if not exists display_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.opps_invoices'::regclass and conname = 'opps_invoices_source_order_id_fkey') then
    alter table public.opps_invoices add constraint opps_invoices_source_order_id_fkey foreign key (source_order_id) references public.orders(id) on delete set null not valid;
  end if;
end;
$$;
alter table public.opps_invoices validate constraint opps_invoices_source_order_id_fkey;

create or replace function public.submit_client_quote_request_with_assets(p_email text, p_order_number text, p_payload jsonb, p_status text default 'new')
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  client_row public.clients;
  submit_result jsonb;
  request_id uuid;
  files jsonb := coalesce(p_payload->'uploaded_files', '[]'::jsonb);
  file_item jsonb;
  clean_url text;
  clean_role text;
  primary_url text;
  linked_count integer := 0;
begin
  client_row := public.verify_client_portal_access(p_email, p_order_number);
  if jsonb_typeof(files) <> 'array' then raise exception 'Uploaded files must be an array.'; end if;
  if jsonb_array_length(files) > 8 then raise exception 'A maximum of 8 request files is allowed.'; end if;

  submit_result := public.submit_client_portal_item(p_email, p_order_number, 'quote_request', p_payload, p_status);
  request_id := nullif(submit_result->>'id', '')::uuid;
  if request_id is null or not exists (
    select 1 from public.client_quote_requests r where r.id = request_id and r.tenant_id = client_row.tenant_id
      and (r.client_id = client_row.id or lower(trim(r.client_email)) = lower(trim(client_row.email)))
  ) then raise exception 'The created request could not be verified.'; end if;

  select item->>'url' into primary_url
  from jsonb_array_elements(files) with ordinality as f(item, position)
  where coalesce((item->>'is_primary')::boolean, false)
    and (lower(coalesce(item->>'type','')) like 'image/%' or lower(coalesce(item->>'url','')) ~ '\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$')
  order by position limit 1;
  if primary_url is null then
    select item->>'url' into primary_url
    from jsonb_array_elements(files) with ordinality as f(item, position)
    where lower(coalesce(item->>'type','')) like 'image/%' or lower(coalesce(item->>'url','')) ~ '\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$'
    order by position limit 1;
  end if;

  for file_item in select value from jsonb_array_elements(files) loop
    clean_url := trim(coalesce(file_item->>'url',''));
    if clean_url = '' then continue; end if;
    if length(clean_url) > 4000 then raise exception 'A request file URL is too long.'; end if;
    if not public.xlab_bridge_file_ref_matches_tenant(clean_url, client_row.tenant_id) then raise exception 'A request file reference is not valid for this tenant.'; end if;
    clean_role := case lower(trim(coalesce(file_item->>'role', file_item->>'category', 'reference')))
      when 'mockups' then 'mockup' when 'mockup' then 'mockup'
      when 'artwork / graphic files' then 'artwork' when 'artwork' then 'artwork'
      when 'brand assets' then 'reference' when 'references' then 'reference' when 'reference' then 'reference'
      when 'production documents' then 'print_file' when 'print file' then 'print_file' when 'print_file' then 'print_file'
      when 'invoices & quotes' then 'proof' when 'proof' then 'proof'
      when 'production photo' then 'production_photo' when 'production_photo' then 'production_photo'
      else 'other' end;
    insert into public.client_file_links (
      client_id, client_email, file_url, file_name, file_type, file_size,
      linked_quote_request_id, request_role, is_request_primary, uploaded_by_type, source_app, tenant_id
    ) values (
      client_row.id, lower(trim(client_row.email)), clean_url,
      left(coalesce(nullif(trim(file_item->>'name'),''),'Request file'),240),
      nullif(left(trim(coalesce(file_item->>'type','')),120),''),
      case when coalesce(file_item->>'size','') ~ '^\d+$' then (file_item->>'size')::bigint else null end,
      request_id, clean_role, clean_url = primary_url, 'client', 'xlab', client_row.tenant_id
    ) on conflict (linked_quote_request_id, file_url) where linked_quote_request_id is not null
    do update set file_name=excluded.file_name, file_type=excluded.file_type, file_size=excluded.file_size,
      request_role=excluded.request_role, is_request_primary=excluded.is_request_primary, updated_at=now();
    linked_count := linked_count + 1;
  end loop;
  return submit_result || jsonb_build_object('linked_file_count', linked_count);
end;
$$;
revoke all on function public.submit_client_quote_request_with_assets(text,text,jsonb,text) from public;
grant execute on function public.submit_client_quote_request_with_assets(text,text,jsonb,text) to anon, authenticated;

create or replace function public.get_internal_client_request_assets(p_request_id uuid)
returns setof public.client_file_links language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_internal_client_requests() then raise exception 'Not authorised to view request assets.'; end if;
  if not exists (select 1 from public.client_quote_requests r where r.id=p_request_id and r.tenant_id in (select public.current_user_tenant_ids())) then
    raise exception 'Request was not found in your tenant.';
  end if;
  return query select l.* from public.client_file_links l
    where l.linked_quote_request_id=p_request_id and l.tenant_id in (select public.current_user_tenant_ids())
    order by l.is_request_primary desc, l.created_at asc;
end;
$$;
revoke all on function public.get_internal_client_request_assets(uuid) from public, anon;
grant execute on function public.get_internal_client_request_assets(uuid) to authenticated;

-- p_set_primary and p_clear_primary are deliberately separate flags rather
-- than overloading p_set_primary=false to mean "clear" — the JS wrapper
-- already sends an explicit p_set_primary:false on every plain role-only
-- update (its own default parameter coerces to false before the call), so
-- reusing that value to mean "clear the cover" would silently clear the
-- cover on every role change. A distinct flag keeps "leave primary alone"
-- (both flags false/omitted), "set as cover", and "clear the cover"
-- unambiguous at the call site.
create or replace function public.update_internal_client_request_asset(p_request_id uuid, p_file_link_id uuid, p_role text default null, p_set_primary boolean default false, p_clear_primary boolean default false)
returns public.client_file_links language plpgsql security definer set search_path = public
as $$
declare request_row public.client_quote_requests; asset_row public.client_file_links; clean_role text := nullif(lower(trim(coalesce(p_role,''))),'');
begin
  if not public.can_manage_internal_client_requests() then raise exception 'Not authorised to manage request assets.'; end if;
  if p_set_primary and p_clear_primary then raise exception 'Cannot set and clear the request cover in the same call.'; end if;
  select * into request_row from public.client_quote_requests r where r.id=p_request_id and r.tenant_id in (select public.current_user_tenant_ids());
  if request_row.id is null then raise exception 'Request was not found in your tenant.'; end if;
  select * into asset_row from public.client_file_links l where l.id=p_file_link_id and l.linked_quote_request_id=request_row.id and l.tenant_id=request_row.tenant_id;
  if asset_row.id is null then raise exception 'Request asset was not found in your tenant.'; end if;
  if clean_role is not null and clean_role not in ('mockup','artwork','print_file','reference','proof','production_photo','other') then raise exception 'Unsupported request asset role.'; end if;
  if p_set_primary and not (lower(coalesce(asset_row.file_type,'')) like 'image/%' or lower(asset_row.file_url) ~ '\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$') then
    raise exception 'Only an image can be used as the request cover.';
  end if;
  if p_set_primary then
    update public.client_file_links set is_request_primary=false, updated_at=now()
      where linked_quote_request_id=request_row.id and tenant_id=request_row.tenant_id and is_request_primary=true;
  end if;
  update public.client_file_links set request_role=coalesce(clean_role,request_role),
    is_request_primary=case when p_set_primary then true when p_clear_primary then false else is_request_primary end,
    updated_at=now()
    where id=asset_row.id and linked_quote_request_id=request_row.id and tenant_id=request_row.tenant_id returning * into asset_row;
  return asset_row;
end;
$$;
revoke all on function public.update_internal_client_request_asset(uuid,uuid,text,boolean,boolean) from public, anon;
grant execute on function public.update_internal_client_request_asset(uuid,uuid,text,boolean,boolean) to authenticated;

create or replace function public._activate_client_quote_request_order(p_request_id uuid, p_items jsonb, p_total_amount numeric, p_note text default null, p_activated_by text default 'staff')
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  request_row public.client_quote_requests;
  order_payload jsonb;
  effective_items jsonb;
  new_order public.xlab_orders;
  new_order_number text;
  message_body text;
  request_file_urls text[] := '{}'::text[];
  primary_file_url text;
begin
  select * into request_row from public.client_quote_requests where id=p_request_id;
  if request_row.id is null then raise exception 'Quote request not found.'; end if;
  if exists (select 1 from public.xlab_orders where source_quote_request_id=p_request_id) then raise exception 'This request has already been activated for payment.'; end if;
  if coalesce(p_total_amount,0) <= 0 then raise exception 'Total amount must be greater than zero.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one item is required.'; end if;

  select coalesce(array_agg(l.file_url order by l.is_request_primary desc,l.created_at asc),'{}'::text[]),
    (array_agg(l.file_url order by l.is_request_primary desc,l.created_at asc) filter (where l.is_request_primary))[1]
  into request_file_urls,primary_file_url from public.client_file_links l
  where l.linked_quote_request_id=request_row.id and l.tenant_id=request_row.tenant_id;

  effective_items:=p_items;
  if primary_file_url is not null and coalesce(effective_items->0->>'image_url','')='' then
    effective_items:=jsonb_set(effective_items,'{0,image_url}',to_jsonb(primary_file_url),true);
  end if;
  new_order_number:=public._generate_xlab_order_number();
  order_payload:=jsonb_build_object('order_number',new_order_number,'customer_email',request_row.client_email,
    'customer_name',coalesce(request_row.client_name,request_row.client_email),'items',effective_items,'subtotal',p_total_amount,
    'total_amount',p_total_amount,'file_urls',to_jsonb(request_file_urls),'special_instructions',p_note);
  new_order:=jsonb_populate_record(null::public.xlab_orders,public.create_checkout_order(order_payload));
  update public.xlab_orders set source_quote_request_id=p_request_id,tenant_id=coalesce(tenant_id,public._joint_x_tenant_id()) where id=new_order.id;
  update public.client_file_links set linked_xlab_order_id=new_order.id,updated_at=now()
    where linked_quote_request_id=request_row.id and tenant_id=request_row.tenant_id;
  insert into public.xlab_payments(order_id,order_number,amount,method,status) values(new_order.id,new_order.order_number,p_total_amount,'payfast','pending');
  update public.client_quote_requests set status='actioned',tenant_id=coalesce(tenant_id,public._joint_x_tenant_id()) where id=p_request_id;
  message_body:=case when p_activated_by='auto_repeat' then
    'Good news, your repeat order ('||new_order.order_number||') is set up and ready for payment. Total: R'||to_char(p_total_amount,'FM999,999,990.00')||'. Open your account any time to pay.'
    else 'Your order request has been approved. Order '||new_order.order_number||' is ready for payment. Total: R'||to_char(p_total_amount,'FM999,999,990.00')||'. Open your account any time to pay.' end;
  insert into public.client_messages(client_id,client_email,xlab_order_id,subject,message,sender_type,is_internal,status,source_app)
    values(request_row.client_id,request_row.client_email,new_order.id,'Your order is ready for payment',message_body,
      case when p_activated_by='auto_repeat' then 'system' else 'staff' end,false,'new','xlab');
  return jsonb_build_object('ok',true,'order_id',new_order.id,'order_number',new_order.order_number,'total_amount',p_total_amount,
    'client_email',request_row.client_email,'client_id',request_row.client_id,'linked_file_count',cardinality(request_file_urls),'primary_file_url',primary_file_url);
end;
$$;
revoke all on function public._activate_client_quote_request_order(uuid,jsonb,numeric,text,text) from public, anon, authenticated;

commit;
