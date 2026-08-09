-- ═══════════════════════════════════════════════════════════════════
--  MANUAL BACKFILL — NOT A MIGRATION. DO NOT MOVE THIS FILE INTO
--  supabase/migrations/. Anything under supabase/migrations is eligible
--  to run automatically via normal migration replay / db push; this
--  script is one-time, historical-data-touching, and must only ever be
--  run deliberately, by a human, against a specific target database,
--  after the impact estimate below has been reviewed for that target.
--
--  How to run (controlled, not automatic):
--    psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/backfills/client_file_library_historical_backfill.sql
--
--  RUN ORDER: 202608080002 (migration) -> restructure -> verify ->
--  separately approve -> THIS SCRIPT. Run
--  supabase/backfills/client_file_library_restructure.sql BEFORE this one.
--  This backfill get-or-creates client roots by client_id and expects any
--  pre-existing manually-built client folder (created before folder_kind
--  existed, client_id originally null) to already be ADOPTED — the
--  restructure script is what performs that adoption; this script only
--  reuses folders that already carry client_id, it does not adopt new
--  ones itself.
--
--  An existing direct category folder whose own client_id/tenant_id
--  conflicts with the client currently being processed raises
--  FOLDER_CATEGORY_IDENTITY_CONFLICT and aborts (this whole script is one
--  implicit transaction — a raised exception here rolls back everything
--  the run has done so far) rather than inserting a ClientAsset into a
--  folder owned by another client.
-- ═══════════════════════════════════════════════════════════════════
--
-- Supersedes supabase/backfills/client_order_asset_folder_backfill.sql
-- (Phase 1A), which targeted the now-obsolete
-- "<Client Root>/Orders/<order_number>/<category>" physical hierarchy and
-- created one client_assets row per (order, file_url). That file has been
-- removed from the repo rather than left as a future foot-gun — running it
-- today would create competing folders and duplicate-per-order rows
-- against the Phase 1A.1 canonical model.
--
-- This backfill mirrors existing orders.file_urls into the canonical
-- "All Files -> Clients -> <Client> -> <category>" structure (RPCs in
-- 202608080001, redefined for client-first semantics by 202608080002), with
-- exactly ONE client_assets row per (client_id, file_url) — not per order.
-- If the same file was ever pasted into two different orders for the same
-- client before this backfill runs, both are collapsed into the one
-- canonical row (order_id on that row is whichever order this backfill
-- processes first for that file — legacy/origin metadata only, never used
-- to determine which orders currently reference the file; that's always
-- orders.file_urls, which this script never writes).
--
-- No order folders are created — orders are metadata only in the Phase
-- 1A.1 model. Category is resolved from order_file_folders where
-- available (mockups -> Mockups, artwork -> Artwork, brand_assets ->
-- Brand Assets, references -> References, production -> Production,
-- qc_finished -> QC / Finished, delivery -> Delivery, general/anything
-- else -> General; order.invoice_files is a separate array, out of scope
-- here exactly as it was for the Phase 1A backfill).
--
-- ═════════════════════ READ-ONLY IMPACT ESTIMATE ═════════════════════
-- Run this first, against the actual target, and have it reviewed.
--
--   select
--     count(distinct o.client_id)                          as affected_clients,
--     count(distinct o.id)                                 as affected_orders,
--     sum(coalesce(array_length(o.file_urls, 1), 0))        as total_file_url_refs,
--     count(distinct (o.client_id, url))
--       filter (where not exists (
--         select 1 from public.client_assets ca
--         where ca.client_id = o.client_id and ca.file_url = url
--       ))                                                   as distinct_client_files_needing_backfill,
--     count(distinct o.client_id)
--       filter (where not exists (
--         select 1 from public.folders f
--         where f.client_id = o.client_id
--           and (f.parent_id is null or f.folder_kind = 'client_root')
--       ))                                                   as clients_needing_new_root
--   from public.orders o
--   cross join lateral unnest(o.file_urls) as url
--   where o.client_id is not null
--     and o.file_urls is not null
--     and array_length(o.file_urls, 1) > 0;
--
-- Expected new folder rows ~= clients_needing_new_root (client roots,
--   reusing any existing legacy or new-style root first) + 1 Clients root
--   per newly-touched tenant + up to 9 category folders per newly-touched
--   client (only the categories actually used).
-- Expected new client_assets rows = distinct_client_files_needing_backfill
--   exactly (one per genuinely new (client_id, file_url) pair; already
--   covered pairs, from either this or the old superseded backfill, are
--   skipped).
-- ═══════════════════════════════════════════════════════════════════

do $$
declare
  order_row record;
  url text;
  folder_key text;
  category text;
  clients_root_id uuid;
  clients_root_candidate_count int;
  root_id uuid;
  category_id uuid;
  file_name text;
  client_display_name text;
  client_label text;
  client_suffix text;
  client_insert_attempt int;
  file_ext text;
begin
  for order_row in
    select
      o.id, o.client_id, o.client_name, o.tenant_id, o.file_urls,
      coalesce(nullif(o.order_file_folders -> 'fileFolders', 'null'::jsonb), '{}'::jsonb) as file_folders
    from public.orders o
    where o.client_id is not null
      and o.file_urls is not null
      and array_length(o.file_urls, 1) > 0
    order by o.created_at asc
  loop
    for url in select unnest(order_row.file_urls)
    loop
      continue when url is null or btrim(url) = '';
      -- Canonical dedup key: (client_id, file_url), NOT (order_id, file_url)
      -- — this is what makes the same file reused across many historical
      -- orders collapse into one row.
      continue when exists (
        select 1 from public.client_assets ca
        where ca.client_id = order_row.client_id and ca.file_url = url
      );

      -- Get-or-create this client's root (owner-privileged direct logic,
      -- same reuse-first rule as the redefined RPC: an existing legacy
      -- Phase 1A root, a new-style client_root, or a folder the manual
      -- restructure script already adopted for this client is always
      -- reused, never duplicated). Run
      -- supabase/backfills/client_file_library_restructure.sql BEFORE
      -- this script so any pre-existing manually-built client folder
      -- (client_id originally null) is already adopted and reusable here
      -- — this backfill does not itself perform folder ADOPTION, only
      -- get-or-create against folders that already carry client_id.
      root_id := null;
      select id into root_id
      from public.folders
      where client_id = order_row.client_id
        and (parent_id is null or folder_kind = 'client_root')
      order by created_at asc
      limit 1;

      if root_id is null then
        -- Resolve this tenant's Clients root the same legacy-aware way
        -- as get_or_create_clients_root (202608080002) and the
        -- restructure script: prefer canonical, else reuse exactly one
        -- compatible manually-created "Clients" folder, else create
        -- fresh. More than one compatible legacy candidate is a genuine
        -- ambiguity this script refuses to guess through.
        clients_root_id := null;
        select id into clients_root_id
        from public.folders
        where tenant_id = order_row.tenant_id and folder_kind = 'clients_root'
        limit 1;

        if clients_root_id is null then
          select count(*) into clients_root_candidate_count
          from public.folders
          where tenant_id = order_row.tenant_id
            and parent_id is null
            and client_id is null
            and lower(btrim(name)) = 'clients'
            and coalesce(is_archived, false) = false
            and coalesce(folder_kind, '') <> 'clients_root';

          if clients_root_candidate_count > 1 then
            raise exception using errcode = 'P0001',
              message = format('FOLDER_CLIENTS_ROOT_AMBIGUOUS_TENANT_%s', order_row.tenant_id);
          elsif clients_root_candidate_count = 1 then
            select id into clients_root_id
            from public.folders
            where tenant_id = order_row.tenant_id
              and parent_id is null
              and client_id is null
              and lower(btrim(name)) = 'clients'
              and coalesce(is_archived, false) = false
              and coalesce(folder_kind, '') <> 'clients_root';
            update public.folders
            set folder_kind = 'clients_root'
            where id = clients_root_id and coalesce(folder_kind, '') <> 'clients_root';
          end if;
        end if;

        if clients_root_id is null then
          insert into public.folders (name, parent_id, tenant_id, folder_kind, color)
          values ('Clients', null, order_row.tenant_id, 'clients_root', 'blue')
          returning id into clients_root_id;
        end if;

        -- Same client display-name collision handling as
        -- get_or_create_client_asset_folder: a short, human-readable
        -- client-id suffix, only applied when actually needed.
        client_display_name := coalesce(nullif(btrim(order_row.client_name), ''), 'Client');
        client_label := client_display_name;
        if exists (
          select 1 from public.folders
          where parent_id = clients_root_id and lower(btrim(name)) = lower(client_label)
        ) then
          client_suffix := lower(substr(replace(order_row.client_id::text, '-', ''), 1, 4));
          client_label := client_display_name || ' · ' || client_suffix;
        end if;

        root_id := null;
        client_insert_attempt := 0;
        loop
          client_insert_attempt := client_insert_attempt + 1;
          begin
            insert into public.folders (name, client_id, parent_id, tenant_id, folder_kind, color)
            values (client_label, order_row.client_id, clients_root_id, order_row.tenant_id, 'client_root', 'blue')
            returning id into root_id;
            exit;
          exception when unique_violation then
            select id into root_id from public.folders where client_id = order_row.client_id and folder_kind = 'client_root' limit 1;
            if root_id is not null then
              exit;
            end if;
            if client_insert_attempt >= 3 then
              raise;
            end if;
            client_label := client_display_name || ' · ' || lower(substr(replace(order_row.client_id::text, '-', ''), 1, 4 + client_insert_attempt));
          end;
        end loop;
      end if;

      folder_key := lower(coalesce(order_row.file_folders ->> url, ''));
      category := case folder_key
        when 'mockups' then 'Mockups'
        when 'artwork' then 'Artwork'
        when 'brand_assets' then 'Brand Assets'
        when 'references' then 'References'
        when 'production' then 'Production'
        when 'qc_finished' then 'QC / Finished'
        when 'delivery' then 'Delivery'
        when 'general' then 'General'
        else 'General'
      end;

      category_id := null;
      select id into category_id
      from public.folders
      where parent_id = root_id and lower(btrim(name)) = lower(category)
      limit 1;
      if category_id is null then
        insert into public.folders (name, client_id, parent_id, tenant_id, folder_kind, color)
        values (category, order_row.client_id, root_id, order_row.tenant_id, 'client_category', 'slate')
        returning id into category_id;
      else
        -- An existing direct category folder (e.g. adopted by the
        -- restructure script, or manually created before folder_kind
        -- existed) is normalized in place — but only if its own identity
        -- doesn't already disagree with this client/tenant. A genuine
        -- conflict must never merely be "left unmodified" while still
        -- being used as the insert destination below — no historical
        -- ClientAsset may ever land in a folder owned by another client,
        -- even within the same tenant. Raise and abort BEFORE the insert.
        if exists (
          select 1 from public.folders
          where id = category_id
            and ((client_id is not null and client_id <> order_row.client_id)
              or (tenant_id is not null and tenant_id <> order_row.tenant_id))
        ) then
          raise exception using errcode = 'P0001',
            message = format(
              'FOLDER_CATEGORY_IDENTITY_CONFLICT client=%s root=%s category=%s folder=%s',
              order_row.client_id, root_id, category, category_id
            );
        end if;
        update public.folders
        set client_id = order_row.client_id, tenant_id = order_row.tenant_id, folder_kind = 'client_category'
        where id = category_id and coalesce(folder_kind, '') <> 'client_category';
      end if;

      file_name := regexp_replace(split_part(url, '?', 1), '^.*/', '');
      if file_name is null or btrim(file_name) = '' then
        file_name := 'File';
      end if;
      file_ext := lower(regexp_replace(file_name, '^.*\.', ''));
      if file_ext = file_name then
        file_ext := 'file';
      end if;

      begin
        insert into public.client_assets (title, file_url, file_type, folder_id, client_id, order_id)
        values (file_name, url, file_ext, category_id, order_row.client_id, order_row.id);
      exception when unique_violation then
        null; -- already backfilled by a concurrent run or a prior partial pass
      end;
    end loop;
  end loop;
end $$;
