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
--
--  BROWSER-SESSION BLOB URLS (blob:...) are excluded BEFORE any side
--  effect. A `blob:` URL is a browser-local object reference tied to one
--  page session — it is never a persistent, fetchable, or re-servable
--  file, so it can never back a canonical ClientAsset row. It is simply
--  skipped: never deleted or rewritten in orders.file_urls (that array is
--  never written by this script at all), never converted, never fetched,
--  never given a placeholder row. A client/order whose ONLY historical
--  references are blob: URLs gets no root, no category, and no asset
--  created on its account — the exclusion happens in the source CTE
--  below, before any client/category resolution ever sees that row.
--
--  CATEGORY RESOLUTION ACROSS MULTIPLE HISTORICAL ORDERS: earlier
--  versions of this script resolved category per (order, url) as it was
--  encountered and let "first order processed wins" decide the category
--  for the whole (client_id, file_url) pair — so a file first pasted into
--  a general-purpose order and only later re-linked into a Mockups-
--  categorized order stayed miscategorized as General forever. This
--  version gathers EVERY historical occurrence of a (client_id, file_url)
--  pair first, across every order that ever referenced it, and only then
--  decides:
--    - resolved category: if every occurrence maps to General, use
--      General; otherwise prefer a non-General category, taking the
--      EARLIEST (order.created_at asc, order.id asc) non-General
--      occurrence when more than one distinct non-General category
--      exists across occurrences (never an invented business-priority
--      order between category names).
--    - origin order_id: always the EARLIEST occurrence overall
--      (order.created_at asc, order.id asc), regardless of which
--      occurrence supplied the resolved category. client_assets.order_id
--      remains legacy/origin metadata only — it is never what determines
--      which orders currently reference the file; that is always
--      orders.file_urls, which this script never writes.
--  A pair with more than one distinct non-General category across its
--  historical occurrences is a genuine "multi-specific-category conflict"
--  — resolved deterministically as above, and surfaced via a NOTICE
--  during the run and via multi_specific_category_conflicts in the
--  impact estimate below, for operator review. It is not an abort
--  condition; the earliest-non-General tie-break gives a defined answer.
--
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
-- canonical row (order_id on that row is the EARLIEST order referencing
-- it — see above — legacy/origin metadata only, never used to determine
-- which orders currently reference the file; that's always
-- orders.file_urls, which this script never writes).
--
-- No order folders are created — orders are metadata only in the Phase
-- 1A.1 model. Category is resolved from order_file_folders where
-- available (mockups -> Mockups, artwork -> Artwork, brand_assets ->
-- Brand Assets, references -> References, production -> Production,
-- qc_finished -> QC / Finished, delivery -> Delivery, general/anything
-- else -> General; order.invoice_files is a separate array, out of scope
-- here exactly as it was for the Phase 1A backfill) across ALL historical
-- occurrences of a (client_id, file_url) pair, per the preference rule
-- above — not just the occurrence on whichever order happens to be
-- processed first.
--
-- Storage/URL safety: this script never rewrites, transforms, or
-- normalizes a stored file_url. A private-upload://... reference stays
-- exactly that; a https://.../storage/v1/object/public/... reference
-- stays exactly that. It only ever copies the existing string verbatim
-- into client_assets.file_url. No binary is ever uploaded, copied, or
-- fetched by this script.
--
-- ═════════════════════ READ-ONLY IMPACT ESTIMATE ═════════════════════
-- Run this first, against the actual target, and have it reviewed. Uses
-- the exact same blob-exclusion and category-preference rules as the
-- backfill below — never a simplified approximation, so the numbers here
-- are what the backfill will actually do.
--
--   with candidate_refs as (
--     select
--       o.id as order_id, o.client_id, o.client_name, o.tenant_id,
--       o.created_at as order_created_at, url as file_url,
--       case lower(coalesce(
--         (coalesce(nullif(o.order_file_folders -> 'fileFolders', 'null'::jsonb), '{}'::jsonb) ->> url), ''
--       ))
--         when 'mockups' then 'Mockups' when 'artwork' then 'Artwork'
--         when 'brand_assets' then 'Brand Assets' when 'references' then 'References'
--         when 'production' then 'Production' when 'qc_finished' then 'QC / Finished'
--         when 'delivery' then 'Delivery' when 'general' then 'General' else 'General'
--       end as occurrence_category,
--       (lower(btrim(coalesce(url, ''))) like 'blob:%') as is_blob
--     from public.orders o
--     cross join lateral unnest(o.file_urls) as url
--     where o.client_id is not null and o.file_urls is not null and array_length(o.file_urls, 1) > 0
--       and url is not null and btrim(url) <> ''
--   ),
--   valid_refs as (
--     select * from candidate_refs where not is_blob
--   ),
--   pairs as (
--     select distinct client_id, file_url from valid_refs
--   ),
--   already_canonical as (
--     select p.client_id, p.file_url from pairs p
--     where exists (select 1 from public.client_assets ca where ca.client_id = p.client_id and ca.file_url = p.file_url)
--   ),
--   needing_backfill as (
--     select p.client_id, p.file_url from pairs p
--     where not exists (select 1 from public.client_assets ca where ca.client_id = p.client_id and ca.file_url = p.file_url)
--   ),
--   category_pick as (
--     select distinct on (client_id, file_url) client_id, file_url, occurrence_category as resolved_category
--     from valid_refs
--     order by client_id, file_url, (occurrence_category = 'General') asc, order_created_at asc, order_id asc
--   ),
--   conflict_counts as (
--     select client_id, file_url, count(distinct occurrence_category) as distinct_non_general
--     from valid_refs where occurrence_category <> 'General' group by client_id, file_url
--   )
--   select
--     (select count(distinct client_id) from candidate_refs)                    as affected_clients,
--     (select count(distinct order_id) from candidate_refs)                     as affected_orders,
--     (select count(*) from candidate_refs)                                     as total_nonblank_refs,
--     (select count(*) from candidate_refs where is_blob)                       as blob_refs_skipped,
--     (select count(*) from pairs)                                              as distinct_client_file_pairs,
--     (select count(*) from already_canonical)                                  as already_canonical_pairs,
--     (select count(*) from needing_backfill)                                   as valid_pairs_needing_backfill,
--     (select count(distinct nb.client_id) from needing_backfill nb
--       where not exists (
--         select 1 from public.folders f
--         where f.client_id = nb.client_id and (f.parent_id is null or f.folder_kind = 'client_root')
--       ))                                                                       as clients_needing_new_root,
--     (select count(*) from needing_backfill nb join category_pick cp using (client_id, file_url) where cp.resolved_category = 'General')       as category_general_count,
--     (select count(*) from needing_backfill nb join category_pick cp using (client_id, file_url) where cp.resolved_category = 'Mockups')        as category_mockups_count,
--     (select count(*) from needing_backfill nb join category_pick cp using (client_id, file_url) where cp.resolved_category = 'Artwork')        as category_artwork_count,
--     (select count(*) from needing_backfill nb join category_pick cp using (client_id, file_url) where cp.resolved_category = 'Brand Assets')   as category_brand_assets_count,
--     (select count(*) from needing_backfill nb join category_pick cp using (client_id, file_url) where cp.resolved_category = 'References')     as category_references_count,
--     (select count(*) from needing_backfill nb join category_pick cp using (client_id, file_url) where cp.resolved_category = 'Production')     as category_production_count,
--     (select count(*) from needing_backfill nb join category_pick cp using (client_id, file_url) where cp.resolved_category = 'QC / Finished')  as category_qc_finished_count,
--     (select count(*) from needing_backfill nb join category_pick cp using (client_id, file_url) where cp.resolved_category = 'Delivery')       as category_delivery_count,
--     (select count(*) from needing_backfill nb join conflict_counts cc using (client_id, file_url) where cc.distinct_non_general > 1)
--                                                                                as multi_specific_category_conflicts
--   ;
--
-- Expected new folder rows ~= clients_needing_new_root (client roots,
--   reusing any existing legacy or new-style root first) + 1 Clients root
--   per newly-touched tenant + up to 9 category folders per newly-touched
--   client (only the categories actually used, after preferred-category
--   resolution).
-- Expected new client_assets rows = valid_pairs_needing_backfill exactly
--   (one per genuinely new (client_id, file_url) pair; already-canonical
--   pairs are skipped; blob: refs are excluded before they are ever
--   counted as a pair at all).
-- ═══════════════════════════════════════════════════════════════════

do $$
declare
  pair_row record;
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
  for pair_row in
    with candidate_refs as (
      -- Every (order, url) occurrence across every order with a client,
      -- excluding blank and browser-session blob: refs BEFORE any
      -- downstream root/category/asset side effect ever sees them.
      select
        o.id as order_id,
        o.client_id,
        o.client_name,
        o.tenant_id,
        o.created_at as order_created_at,
        url as file_url,
        case lower(coalesce(
          (coalesce(nullif(o.order_file_folders -> 'fileFolders', 'null'::jsonb), '{}'::jsonb) ->> url), ''
        ))
          when 'mockups' then 'Mockups'
          when 'artwork' then 'Artwork'
          when 'brand_assets' then 'Brand Assets'
          when 'references' then 'References'
          when 'production' then 'Production'
          when 'qc_finished' then 'QC / Finished'
          when 'delivery' then 'Delivery'
          when 'general' then 'General'
          else 'General'
        end as occurrence_category
      from public.orders o
      cross join lateral unnest(o.file_urls) as url
      where o.client_id is not null
        and o.file_urls is not null
        and array_length(o.file_urls, 1) > 0
        and url is not null
        and btrim(url) <> ''
        and lower(btrim(url)) not like 'blob:%'
    ),
    pairs as (
      select distinct client_id, file_url from candidate_refs
    ),
    -- Origin order: always the EARLIEST occurrence overall, independent
    -- of which occurrence supplies the resolved category.
    origin_pick as (
      select distinct on (client_id, file_url)
        client_id, file_url, order_id as origin_order_id,
        client_name as origin_client_name, tenant_id
      from candidate_refs
      order by client_id, file_url, order_created_at asc, order_id asc
    ),
    -- Resolved category: prefer any non-General occurrence; among
    -- multiple distinct non-General occurrences, the earliest one wins
    -- (boolean false < true, so a non-General row is always ordered
    -- ahead of a General row within the same pair).
    category_pick as (
      select distinct on (client_id, file_url)
        client_id, file_url, occurrence_category as resolved_category
      from candidate_refs
      order by client_id, file_url, (occurrence_category = 'General') asc, order_created_at asc, order_id asc
    ),
    conflict_counts as (
      select client_id, file_url, count(distinct occurrence_category) as distinct_non_general
      from candidate_refs
      where occurrence_category <> 'General'
      group by client_id, file_url
    )
    select
      p.client_id,
      p.file_url,
      op.origin_order_id,
      op.origin_client_name,
      op.tenant_id,
      cp.resolved_category,
      coalesce(cc.distinct_non_general, 0) as distinct_non_general_count
    from pairs p
    join origin_pick op using (client_id, file_url)
    join category_pick cp using (client_id, file_url)
    left join conflict_counts cc using (client_id, file_url)
    where not exists (
      -- Canonical dedup key: (client_id, file_url), NOT (order_id,
      -- file_url) — already-covered pairs are skipped entirely, never
      -- re-evaluated or duplicated.
      select 1 from public.client_assets ca
      where ca.client_id = p.client_id and ca.file_url = p.file_url
    )
  loop
    if pair_row.distinct_non_general_count > 1 then
      raise notice 'MULTI_SPECIFIC_CATEGORY_CONFLICT client=% file_url=% distinct_non_general_categories=% resolved_category=%',
        pair_row.client_id, pair_row.file_url, pair_row.distinct_non_general_count, pair_row.resolved_category;
    end if;

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
    where client_id = pair_row.client_id
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
      where tenant_id = pair_row.tenant_id and folder_kind = 'clients_root'
      limit 1;

      if clients_root_id is null then
        select count(*) into clients_root_candidate_count
        from public.folders
        where tenant_id = pair_row.tenant_id
          and parent_id is null
          and client_id is null
          and lower(btrim(name)) = 'clients'
          and coalesce(is_archived, false) = false
          and coalesce(folder_kind, '') <> 'clients_root';

        if clients_root_candidate_count > 1 then
          raise exception using errcode = 'P0001',
            message = format('FOLDER_CLIENTS_ROOT_AMBIGUOUS_TENANT_%s', pair_row.tenant_id);
        elsif clients_root_candidate_count = 1 then
          select id into clients_root_id
          from public.folders
          where tenant_id = pair_row.tenant_id
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
        values ('Clients', null, pair_row.tenant_id, 'clients_root', 'blue')
        returning id into clients_root_id;
      end if;

      -- Same client display-name collision handling as
      -- get_or_create_client_asset_folder: a short, human-readable
      -- client-id suffix, only applied when actually needed. Uses the
      -- EARLIEST order's client_name snapshot, consistent with origin
      -- order_id also always being the earliest occurrence.
      client_display_name := coalesce(nullif(btrim(pair_row.origin_client_name), ''), 'Client');
      client_label := client_display_name;
      if exists (
        select 1 from public.folders
        where parent_id = clients_root_id and lower(btrim(name)) = lower(client_label)
      ) then
        client_suffix := lower(substr(replace(pair_row.client_id::text, '-', ''), 1, 4));
        client_label := client_display_name || ' · ' || client_suffix;
      end if;

      root_id := null;
      client_insert_attempt := 0;
      loop
        client_insert_attempt := client_insert_attempt + 1;
        begin
          insert into public.folders (name, client_id, parent_id, tenant_id, folder_kind, color)
          values (client_label, pair_row.client_id, clients_root_id, pair_row.tenant_id, 'client_root', 'blue')
          returning id into root_id;
          exit;
        exception when unique_violation then
          select id into root_id from public.folders where client_id = pair_row.client_id and folder_kind = 'client_root' limit 1;
          if root_id is not null then
            exit;
          end if;
          if client_insert_attempt >= 3 then
            raise;
          end if;
          client_label := client_display_name || ' · ' || lower(substr(replace(pair_row.client_id::text, '-', ''), 1, 4 + client_insert_attempt));
        end;
      end loop;
    end if;

    category_id := null;
    select id into category_id
    from public.folders
    where parent_id = root_id and lower(btrim(name)) = lower(pair_row.resolved_category)
    limit 1;
    if category_id is null then
      insert into public.folders (name, client_id, parent_id, tenant_id, folder_kind, color)
      values (pair_row.resolved_category, pair_row.client_id, root_id, pair_row.tenant_id, 'client_category', 'slate')
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
          and ((client_id is not null and client_id <> pair_row.client_id)
            or (tenant_id is not null and tenant_id <> pair_row.tenant_id))
      ) then
        raise exception using errcode = 'P0001',
          message = format(
            'FOLDER_CATEGORY_IDENTITY_CONFLICT client=%s root=%s category=%s folder=%s',
            pair_row.client_id, root_id, pair_row.resolved_category, category_id
          );
      end if;
      update public.folders
      set client_id = pair_row.client_id, tenant_id = pair_row.tenant_id, folder_kind = 'client_category'
      where id = category_id and coalesce(folder_kind, '') <> 'client_category';
    end if;

    -- file_url is copied verbatim from pair_row.file_url below — never
    -- rewritten, transformed, or normalized, whether it's a
    -- private-upload://, a public Supabase storage URL, or any other
    -- historical reference shape.
    file_name := regexp_replace(split_part(pair_row.file_url, '?', 1), '^.*/', '');
    if file_name is null or btrim(file_name) = '' then
      file_name := 'File';
    end if;
    file_ext := lower(regexp_replace(file_name, '^.*\.', ''));
    if file_ext = file_name then
      file_ext := 'file';
    end if;

    begin
      insert into public.client_assets (title, file_url, file_type, folder_id, client_id, order_id)
      values (file_name, pair_row.file_url, file_ext, category_id, pair_row.client_id, pair_row.origin_order_id);
    exception when unique_violation then
      null; -- already backfilled by a concurrent run or a prior partial pass
    end;
  end loop;
end $$;
