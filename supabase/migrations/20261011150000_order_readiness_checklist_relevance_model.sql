-- Order Operational Readiness, Phase B3 — relevance-filtered manual
-- checklist + 4-state aggregate.
--
-- ── Production-wide inventory (read before this migration was written,
-- see PR description for the full query) ─────────────────────────────
-- Across ALL orders that have ever existed, exactly 3 checklist rows
-- exist: 2x quote_approved (status='checked', orders ORD-MPKPGHZK /
-- ORD-MRZADA4W) and 1x artwork_files_attached (status='needs_attention',
-- ORD-MPKPGHZK). Zero rows exist for artwork_mockup_approved,
-- tech_pack_checked, special_instructions_checked,
-- payment_balance_checked, contract_terms_accepted, or
-- production_notes_reviewed. No notes are attached to any of the 3 rows.
-- This migration does not delete any of these rows - it only changes
-- which check_keys get_order_production_readiness generates/returns
-- going forward. The 3 historical rows remain in
-- order_production_readiness_checks untouched and queryable directly.
--
-- ── Retired (no longer generated/shown; each now owned by a real
-- automatic authority already live) ───────────────────────────────────
--   quote_approved            -> opps_quotes / the quote-acceptance flow
--   artwork_files_attached    -> order_line_component_snapshots.artwork_
--                                revision_ids (_compute_order_line_
--                                production_readiness's ARTWORK_MISSING)
--   artwork_mockup_approved   -> client_product_artwork.status='approved'
--                                (confirm_client_product_artwork_
--                                production_file, 20261011120000) +
--                                client_approvals/client_product_concept
--                                (the Phase B2 "Ready automatically" strip
--                                surfaces both)
--   payment_balance_checked   -> balance_due, already computed live in
--                                this same function from transactions
--
-- ── Conditional (generated only when the underlying record currently
-- exists/applies - never a frozen snapshot of "did exist once") ───────
--   tech_pack_checked             - an active (status <> 'archived')
--                                    client_tech_packs row exists
--   special_instructions_checked  - an active client_special_
--                                    instructions row exists
--   contract_terms_accepted       - a client_contract_acceptances row
--                                    exists for this client (there is no
--                                    schema concept of "a contract is
--                                    mandated but not yet accepted" -
--                                    existence of an acceptance record is
--                                    the only applicability signal this
--                                    system has)
--
-- ── Kept as genuine manual work, also now conditional ──────────────────
--   production_notes_reviewed - shown only when orders.
--                                production_internal_note has content.
--                                This is a real, already-used field (the
--                                OrderDrawer "Internal hold-up note" -
--                                3 real orders currently have content in
--                                it, confirmed live before this migration
--                                was written) - never a new column.
--
-- ── Deliberately NOT added (audited, evidence-based decision) ─────────
-- "Stock/material verified", "quantity verified", "production setup
-- prepared", "quality check complete", "packed/prepared for fulfilment":
-- orders.production_detail_stage ALREADY carries this exact vocabulary
-- as real, actively-selectable stage values (waiting_stock, print_setup,
-- quality_check, packing, finishing, ...) - a single current-stage
-- pointer staff already set via the Production tab's stage pills. Adding
-- a parallel checklist item for "quality checked" or "packed" would
-- create a second manual truth for a fact production_detail_stage
-- already owns, which is exactly the anti-pattern this phase exists to
-- remove elsewhere. There is also zero historical evidence (0 of the
-- original 8 keys were ever used for stock/quantity) that a discrete
-- verification checkbox reflects a real tracked practice today. Nothing
-- is added here; if a genuine future need for a stock-pull confirmation
-- distinct from production_detail_stage surfaces, it should be designed
-- against that real need, not invented speculatively now.
--
-- ── 4-state checklist aggregate (summary.checklist_state, additive -
-- summary.ready_state is left in place, same formula, now simply
-- operating over the smaller relevant-only checks_json) ────────────────
--   relevant_count = 0                                -> 'ready'
--   any relevant check status = 'needs_attention'      -> 'needs_attention'
--   every relevant check status in (checked,not_required) -> 'ready'
--   zero relevant checks resolved yet                  -> 'not_started'
--   else (some resolved, some pending, none flagged)    -> 'in_progress'
--
-- No schema change. No new table, no new column, no DB enum. Preserves
-- the B1 (20261011140000) client_product_concept approval-authority fix
-- byte-for-byte. Never touches order_production_readiness_checks rows
-- themselves, update_order_production_readiness_check's WRITE behavior
-- (only its allowed-key list narrows, preventing new writes to retired
-- keys - no existing row is affected), line readiness, artwork
-- confirmation, the PAXI gate, or any order lifecycle trigger.

create or replace function public.get_order_production_readiness(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.orders%rowtype;
  client_row public.clients%rowtype;
  checks_json jsonb := '[]'::jsonb;
  tech_packs_json jsonb := '[]'::jsonb;
  instructions_json jsonb := '[]'::jsonb;
  approvals_json jsonb := '[]'::jsonb;
  contracts_json jsonb := '[]'::jsonb;
  warnings_json jsonb := '[]'::jsonb;
  files_count int := 0;
  invoices_count int := 0;
  paid_total numeric := 0;
  balance_due numeric := 0;
  needs_attention_count int := 0;
  pending_count int := 0;
  relevant_count int := 0;
  resolved_count int := 0;
  checklist_state text := 'ready';
  represented_client_product_ids uuid[] := array[]::uuid[];
  all_represented_products_approved boolean := true;
begin
  if not public.can_manage_order_production_readiness() then
    raise exception 'Not authorised to view production readiness.';
  end if;

  select * into order_row from public.orders where id = p_order_id limit 1;
  if order_row.id is null then
    raise exception 'Order not found.';
  end if;

  select * into client_row from public.clients
  where id = order_row.client_id or lower(email) = lower(order_row.client_email)
  order by case when id = order_row.client_id then 0 else 1 end
  limit 1;

  files_count := case when jsonb_typeof(to_jsonb(order_row.file_urls)) = 'array' then jsonb_array_length(to_jsonb(order_row.file_urls)) else 0 end;
  invoices_count := case when jsonb_typeof(to_jsonb(order_row.invoice_files)) = 'array' then jsonb_array_length(to_jsonb(order_row.invoice_files)) else 0 end;

  select coalesce(sum(amount), 0) into paid_total
  from public.transactions
  where order_id = order_row.id and type = 'income' and coalesce(payment_status, '') = 'completed';

  balance_due := greatest(coalesce(order_row.total_amount, 0) - coalesce(paid_total, 0), 0);

  -- Client products this order's own composition actually represents
  -- (Phase B1, unchanged).
  select coalesce(array_agg(distinct (value ->> 'client_product_id')::uuid), array[]::uuid[])
  into represented_client_product_ids
  from jsonb_array_elements(coalesce(order_row.products, '[]'::jsonb))
  where coalesce(nullif(value ->> 'line_role', ''), 'product') = 'product'
    and nullif(value ->> 'client_product_id', '') is not null;

  all_represented_products_approved := not exists (
    select 1 from unnest(represented_client_product_ids) as cp_id
    where not exists (
      select 1 from public.client_approvals a
      where a.related_table = 'client_products'
        and a.related_id = cp_id
        and a.approval_type = 'client_product_concept'
        and a.status = 'approved'
    )
  );

  -- Tech packs / special instructions / contracts / approvals are
  -- computed BEFORE the checklist defaults below, because Phase B3's
  -- applicability rules need to know whether each of these actually has
  -- any rows for this client/order.

  select coalesce(jsonb_agg(
    jsonb_build_object('id', tp.id, 'title', tp.title, 'tech_pack_type', tp.tech_pack_type, 'status', tp.status,
      'updated_at', tp.updated_at, 'template_name', t.name, 'specs', tp.specs)
    order by tp.updated_at desc
  ), '[]'::jsonb)
  into tech_packs_json
  from public.client_tech_packs tp
  left join public.client_tech_pack_templates t on t.id = tp.template_id
  where tp.status <> 'archived'
    and (tp.client_id = coalesce(order_row.client_id, client_row.id) or tp.client_id = client_row.id)
  limit 10;

  select coalesce(jsonb_agg(
    jsonb_build_object('id', si.id, 'title', si.title, 'instruction', si.instruction, 'instruction_type', si.instruction_type,
      'status', si.status, 'requires_approval', si.requires_approval, 'approved_by_client', si.approved_by_client, 'updated_at', si.updated_at)
    order by si.updated_at desc
  ), '[]'::jsonb)
  into instructions_json
  from public.client_special_instructions si
  where si.status in ('active', 'new', 'reviewing', 'needs_attention')
    and (si.client_id = coalesce(order_row.client_id, client_row.id) or si.client_id = client_row.id)
    and (si.order_id is null or si.order_id = order_row.id)
  limit 10;

  select coalesce(jsonb_agg(
    jsonb_build_object('id', a.id, 'approval_type', a.approval_type, 'status', a.status, 'related_table', a.related_table,
      'related_id', a.related_id, 'approved_at', a.approved_at, 'rejected_reason', a.rejected_reason)
    order by a.created_at desc
  ), '[]'::jsonb)
  into approvals_json
  from public.client_approvals a
  where a.client_id = coalesce(order_row.client_id, client_row.id)
    and (
      a.related_id = order_row.id
      or a.related_table in ('orders', 'client_tech_packs', 'client_special_instructions')
      or (a.related_table = 'client_products' and a.related_id = any (represented_client_product_ids))
    )
  limit 10;

  select coalesce(jsonb_agg(
    jsonb_build_object('id', ca.id, 'contract_name', ct.name, 'contract_type', ct.contract_type, 'version', ct.version,
      'accepted_by_name', ca.accepted_by_name, 'accepted_by_email', ca.accepted_by_email, 'accepted_at', ca.accepted_at,
      'related_table', ca.related_table, 'related_id', ca.related_id)
    order by ca.accepted_at desc
  ), '[]'::jsonb)
  into contracts_json
  from public.client_contract_acceptances ca
  left join public.client_contract_templates ct on ct.id = ca.contract_template_id
  where ca.client_id = coalesce(order_row.client_id, client_row.id)
    and (ca.related_id is null or ca.related_id = order_row.id or ca.related_table is null)
  limit 10;

  -- Phase B3 relevance-filtered defaults: only the 4 surviving keys, and
  -- only when each one's own applicability condition currently holds.
  with defaults(check_key, label, sort_order, context) as (
    select d.check_key, d.label, d.sort_order, d.context
    from (
      values
        ('tech_pack_checked', 'Tech Pack reviewed', 10, null::text),
        ('special_instructions_checked', 'Special instruction reviewed', 20, null::text),
        ('contract_terms_accepted', 'Contract/terms accepted', 30, null::text),
        ('production_notes_reviewed', 'Production notes reviewed', 40, order_row.production_internal_note)
    ) as d(check_key, label, sort_order, context)
    where
      (d.check_key <> 'tech_pack_checked' or jsonb_array_length(tech_packs_json) > 0)
      and (d.check_key <> 'special_instructions_checked' or jsonb_array_length(instructions_json) > 0)
      and (d.check_key <> 'contract_terms_accepted' or jsonb_array_length(contracts_json) > 0)
      and (d.check_key <> 'production_notes_reviewed' or coalesce(trim(order_row.production_internal_note), '') <> '')
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'check_key', d.check_key,
      'label', d.label,
      'status', coalesce(c.status, 'pending'),
      'notes', c.notes,
      'context', d.context,
      'checked_by', c.checked_by,
      'checked_at', c.checked_at,
      'updated_at', c.updated_at
    )
    order by d.sort_order
  ), '[]'::jsonb)
  into checks_json
  from defaults d
  left join public.order_production_readiness_checks c
    on c.order_id = order_row.id
   and c.check_key = d.check_key;

  warnings_json := (
    with high_instruction_warnings as (
      select jsonb_build_object('level', 'high', 'type', 'special_instruction',
        'message', concat('Client has active ', replace(si.instruction_type, '_', ' '), ' instruction: ', left(si.instruction, 120))) as warning
      from public.client_special_instructions si
      where si.status in ('active', 'new', 'reviewing', 'needs_attention')
        and si.instruction_type in ('sizing', 'fit', 'print', 'quality_control')
        and (si.client_id = coalesce(order_row.client_id, client_row.id) or si.client_id = client_row.id)
        and (si.order_id is null or si.order_id = order_row.id)
      order by si.updated_at desc
      limit 5
    )
    select coalesce(jsonb_agg(warning), '[]'::jsonb)
    from (
      select jsonb_build_object('level', 'warning', 'type', 'files', 'message', 'Artwork/files are not attached yet.') as warning
      where files_count = 0
      union all
      select jsonb_build_object('level', 'warning', 'type', 'payment', 'message', 'Payment/balance still needs checking.')
      where balance_due > 0
      union all
      select jsonb_build_object('level', 'warning', 'type', 'tech_pack', 'message', 'Tech Pack has unapproved changes.')
      where exists (select 1 from public.client_tech_packs tp where tp.status in ('needs_client_approval', 'updated_needs_reapproval', 'draft') and tp.client_id = coalesce(order_row.client_id, client_row.id))
      union all
      select warning from high_instruction_warnings
      union all
      select jsonb_build_object('level', 'warning', 'type', 'artwork_approval', 'message', 'Artwork/mockup approval not found.')
      where not all_represented_products_approved
    ) warnings
  );

  select
    count(*),
    count(*) filter (where value ->> 'status' in ('checked', 'not_required')),
    count(*) filter (where value ->> 'status' = 'needs_attention'),
    count(*) filter (where value ->> 'status' = 'pending')
  into relevant_count, resolved_count, needs_attention_count, pending_count
  from jsonb_array_elements(checks_json);

  checklist_state := case
    when relevant_count = 0 then 'ready'
    when needs_attention_count > 0 then 'needs_attention'
    when resolved_count = relevant_count then 'ready'
    when resolved_count = 0 then 'not_started'
    else 'in_progress'
  end;

  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', order_row.id, 'order_number', order_row.order_number, 'status', order_row.status,
      'pipeline_stage', order_row.pipeline_stage, 'client_id', coalesce(order_row.client_id, client_row.id),
      'client_name', coalesce(order_row.client_name, client_row.name), 'client_email', coalesce(order_row.client_email, client_row.email),
      'file_count', files_count, 'invoice_count', invoices_count, 'paid_total', paid_total, 'balance_due', balance_due
    ),
    'summary', jsonb_build_object(
      'total_checks', relevant_count,
      'checked_count', resolved_count,
      'pending_count', pending_count,
      'needs_attention_count', needs_attention_count,
      'warning_count', jsonb_array_length(warnings_json),
      'checklist_state', checklist_state,
      'ready_state', case
        when needs_attention_count > 0 or jsonb_array_length(warnings_json) > 0 then 'needs_attention'
        when pending_count > 0 then 'pending'
        else 'ready'
      end
    ),
    'checks', checks_json, 'tech_packs', tech_packs_json, 'special_instructions', instructions_json,
    'approvals', approvals_json, 'contracts', contracts_json, 'warnings', warnings_json
  );
end;
$$;

grant execute on function public.get_order_production_readiness(uuid) to authenticated;
revoke execute on function public.get_order_production_readiness(uuid) from anon;

-- Narrow the write RPC's allowed keys to the 4 surviving ones. This only
-- blocks NEW writes to the 4 retired keys going forward - it does not
-- touch, read, or delete any existing row for them.
create or replace function public.update_order_production_readiness_check(
  p_order_id uuid,
  p_check_key text,
  p_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_client_id uuid;
  clean_key text := lower(trim(coalesce(p_check_key, '')));
  clean_status text := lower(trim(coalesce(p_status, '')));
  clean_notes text := nullif(left(coalesce(p_notes, ''), 1000), '');
  check_label text;
begin
  if not public.can_manage_order_production_readiness() then
    raise exception 'Not authorised to update production readiness.';
  end if;

  if clean_key not in (
    'tech_pack_checked',
    'special_instructions_checked',
    'contract_terms_accepted',
    'production_notes_reviewed'
  ) then
    raise exception 'Invalid production readiness check.';
  end if;

  if clean_status not in ('pending', 'checked', 'not_required', 'needs_attention') then
    raise exception 'Invalid production readiness status.';
  end if;

  select client_id into order_client_id from public.orders where id = p_order_id;
  if p_order_id is null or not found then
    raise exception 'Order not found.';
  end if;

  check_label := case clean_key
    when 'tech_pack_checked' then 'Tech Pack reviewed'
    when 'special_instructions_checked' then 'Special instruction reviewed'
    when 'contract_terms_accepted' then 'Contract/terms accepted'
    when 'production_notes_reviewed' then 'Production notes reviewed'
  end;

  insert into public.order_production_readiness_checks (
    order_id, client_id, check_key, label, status, checked_by, checked_at, notes, updated_at
  )
  values (
    p_order_id, order_client_id, clean_key, check_label, clean_status,
    case when clean_status in ('checked', 'not_required') then auth.uid() else null end,
    case when clean_status in ('checked', 'not_required') then now() else null end,
    clean_notes, now()
  )
  on conflict (order_id, check_key)
  do update set
    status = excluded.status,
    checked_by = excluded.checked_by,
    checked_at = excluded.checked_at,
    notes = excluded.notes,
    updated_at = now();

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'check_key', clean_key, 'status', clean_status);
end;
$$;

grant execute on function public.update_order_production_readiness_check(uuid, text, text, text) to authenticated;
revoke execute on function public.update_order_production_readiness_check(uuid, text, text, text) from anon;
