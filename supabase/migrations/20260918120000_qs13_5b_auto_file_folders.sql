-- QS-13.5B â€” automatically classify Quick Solution handoff files in OPPS.
-- Scope:
--   * Document Printing (a4-print) uploads -> Production Documents
--   * preserves private-upload:// storage references
--   * preserves any existing/manual order file-folder assignments
--   * unknown Quick Solution product types stay unsorted
--   * backfills existing Quick Solution OPPS orders safely

create or replace function public.qs_merge_quick_solution_file_folders(
  p_service_order_id uuid,
  p_existing jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing jsonb;
  v_existing_file_folders jsonb;
  v_auto_file_folders jsonb;
begin
  v_existing :=
    case
      when jsonb_typeof(p_existing) = 'object' then p_existing
      when jsonb_typeof(p_existing) = 'array' then jsonb_build_object('folders', p_existing)
      else '{}'::jsonb
    end;

  v_existing_file_folders :=
    case
      when jsonb_typeof(v_existing->'fileFolders') = 'object'
        then v_existing->'fileFolders'
      else '{}'::jsonb
    end;

  select coalesce(
    jsonb_object_agg(
      'private-upload://' || sof.storage_bucket || '/' || sof.storage_path,
      to_jsonb('production'::text)
    ),
    '{}'::jsonb
  )
  into v_auto_file_folders
  from commerce.service_order_files sof
  join commerce.service_order_items soi
    on soi.id = sof.order_item_id
   and soi.order_id = sof.order_id
  where sof.order_id = p_service_order_id
    and sof.status = 'uploaded'
    and soi.product_key = 'a4-print';

  -- Automatic values are defaults only. If staff already moved a file,
  -- the existing/manual folder assignment wins.
  return jsonb_set(
    v_existing,
    '{fileFolders}',
    v_auto_file_folders || v_existing_file_folders,
    true
  );
end
$function$;

create or replace function public.qs_assign_opps_order_file_folders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_service_order_id_text text;
  v_service_order_id uuid;
begin
  if new.source is distinct from 'quick_solution' then
    return new;
  end if;

  v_service_order_id_text :=
    nullif(new.source_metadata->'quick_solution'->>'service_order_id', '');

  if v_service_order_id_text is null then
    return new;
  end if;

  begin
    v_service_order_id := v_service_order_id_text::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  new.order_file_folders :=
    public.qs_merge_quick_solution_file_folders(
      v_service_order_id,
      new.order_file_folders
    );

  return new;
end
$function$;

drop trigger if exists trg_qs_assign_opps_order_file_folders on public.orders;

create trigger trg_qs_assign_opps_order_file_folders
before insert or update of file_urls, source_metadata on public.orders
for each row
when (new.source = 'quick_solution')
execute function public.qs_assign_opps_order_file_folders();

-- Backfill existing Quick Solution OPPS orders so current staging test orders
-- immediately get the same Production Documents organization. Existing manual
-- fileFolders assignments are preserved by the merge helper.
select set_config('request.jwt.claim.role','service_role', true);
update public.orders o
set order_file_folders = public.qs_merge_quick_solution_file_folders(
  (o.source_metadata->'quick_solution'->>'service_order_id')::uuid,
  o.order_file_folders
)
where o.source = 'quick_solution'
  and nullif(o.source_metadata->'quick_solution'->>'service_order_id', '') is not null
  and (o.source_metadata->'quick_solution'->>'service_order_id')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

select set_config('request.jwt.claim.role','', true);

revoke all on function public.qs_merge_quick_solution_file_folders(uuid, jsonb) from public;
revoke all on function public.qs_assign_opps_order_file_folders() from public;
