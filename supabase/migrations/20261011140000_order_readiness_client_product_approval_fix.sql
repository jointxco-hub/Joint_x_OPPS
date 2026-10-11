-- Order Operational Readiness, Phase B1 — fix stale approval authority
-- inside public.get_order_production_readiness.
--
-- Defect (confirmed live before this migration): the function's single
-- "Artwork/mockup approval not found" warning checked
-- client_approvals.approval_type in ('artwork', 'mockup',
-- 'production_ready') — three values nothing in this system has ever
-- written. The real, current approval authority
-- (record_client_product_approval_on_behalf, 20261011090000) writes
-- approval_type='client_product_concept' against related_table=
-- 'client_products'. The old predicate can never be satisfied, so the
-- warning (and the ready_state it drags to 'needs_attention') fires
-- permanently regardless of actual approval state. The approvals_json
-- list had the same blind spot: its related_table filter never included
-- 'client_products', so real, current, approved client-product rows
-- never appeared in the payload at all.
--
-- Fix, scoped narrowly to this one warning + this one list (everything
-- else in the function — payment/tech-pack/special-instruction/contract
-- warnings, the 8 manual checklist rows, the ready_state formula — is
-- untouched, byte-identical to the live version):
--   - Derive the set of client_product_id values actually represented by
--     this order's own composition (order.products, line_role='product'
--     rows with a client_product_id) — never "any approval for this
--     client is enough". An order with zero represented client products
--     is vacuously satisfied (nothing to approve), matching how every
--     other optional warning here already behaves (e.g. the tech-pack
--     warning only fires when a tech pack actually exists).
--   - The warning now fires only when AT LEAST ONE represented client
--     product lacks an approved client_product_concept row keyed to its
--     OWN id (related_table='client_products', related_id=that product's
--     id) — every represented product must be approved, not just one.
--   - approvals_json gains exactly one additional OR clause: rows where
--     related_table='client_products' and related_id is one of this
--     order's represented client product ids (still scoped by
--     a.client_id, as every branch of this filter already is) — it does
--     not add "any client_product approval for this client", only the
--     ones this specific order actually represents.

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
  represented_client_product_ids uuid[] := array[]::uuid[];
  all_represented_products_approved boolean := true;
begin
  if not public.can_manage_order_production_readiness() then
    raise exception 'Not authorised to view production readiness.';
  end if;

  select *
  into order_row
  from public.orders
  where id = p_order_id
  limit 1;

  if order_row.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into client_row
  from public.clients
  where id = order_row.client_id
     or lower(email) = lower(order_row.client_email)
  order by case when id = order_row.client_id then 0 else 1 end
  limit 1;

  files_count := case
    when jsonb_typeof(to_jsonb(order_row.file_urls)) = 'array' then jsonb_array_length(to_jsonb(order_row.file_urls))
    else 0
  end;
  invoices_count := case
    when jsonb_typeof(to_jsonb(order_row.invoice_files)) = 'array' then jsonb_array_length(to_jsonb(order_row.invoice_files))
    else 0
  end;

  select coalesce(sum(amount), 0)
  into paid_total
  from public.transactions
  where order_id = order_row.id
    and type = 'income'
    and coalesce(payment_status, '') = 'completed';

  balance_due := greatest(coalesce(order_row.total_amount, 0) - coalesce(paid_total, 0), 0);

  -- Client products this order's own composition actually represents —
  -- never "any client product the client happens to own".
  select coalesce(array_agg(distinct (value ->> 'client_product_id')::uuid), array[]::uuid[])
  into represented_client_product_ids
  from jsonb_array_elements(coalesce(order_row.products, '[]'::jsonb))
  where coalesce(nullif(value ->> 'line_role', ''), 'product') = 'product'
    and nullif(value ->> 'client_product_id', '') is not null;

  -- Every represented product must have its OWN approved
  -- client_product_concept row — one approval does not cover another
  -- product, and a pending/rejected row does not count.
  all_represented_products_approved := not exists (
    select 1
    from unnest(represented_client_product_ids) as cp_id
    where not exists (
      select 1
      from public.client_approvals a
      where a.related_table = 'client_products'
        and a.related_id = cp_id
        and a.approval_type = 'client_product_concept'
        and a.status = 'approved'
    )
  );

  with defaults(check_key, label, sort_order) as (
    values
      ('quote_approved', 'Quote approved', 10),
      ('artwork_files_attached', 'Artwork/files attached', 20),
      ('artwork_mockup_approved', 'Artwork/mockup approved', 30),
      ('tech_pack_checked', 'Tech Pack checked', 40),
      ('special_instructions_checked', 'Special instructions checked', 50),
      ('payment_balance_checked', 'Payment/balance checked', 60),
      ('contract_terms_accepted', 'Contract/terms accepted if required', 70),
      ('production_notes_reviewed', 'Production notes reviewed', 80)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'check_key', d.check_key,
      'label', d.label,
      'status', coalesce(c.status, 'pending'),
      'notes', c.notes,
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

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', tp.id,
      'title', tp.title,
      'tech_pack_type', tp.tech_pack_type,
      'status', tp.status,
      'updated_at', tp.updated_at,
      'template_name', t.name,
      'specs', tp.specs
    )
    order by tp.updated_at desc
  ), '[]'::jsonb)
  into tech_packs_json
  from public.client_tech_packs tp
  left join public.client_tech_pack_templates t on t.id = tp.template_id
  where tp.status <> 'archived'
    and (
      tp.client_id = coalesce(order_row.client_id, client_row.id)
      or tp.client_id = client_row.id
    )
  limit 10;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', si.id,
      'title', si.title,
      'instruction', si.instruction,
      'instruction_type', si.instruction_type,
      'status', si.status,
      'requires_approval', si.requires_approval,
      'approved_by_client', si.approved_by_client,
      'updated_at', si.updated_at
    )
    order by si.updated_at desc
  ), '[]'::jsonb)
  into instructions_json
  from public.client_special_instructions si
  where si.status in ('active', 'new', 'reviewing', 'needs_attention')
    and (si.client_id = coalesce(order_row.client_id, client_row.id) or si.client_id = client_row.id)
    and (si.order_id is null or si.order_id = order_row.id)
  limit 10;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'approval_type', a.approval_type,
      'status', a.status,
      'related_table', a.related_table,
      'related_id', a.related_id,
      'approved_at', a.approved_at,
      'rejected_reason', a.rejected_reason
    )
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
    jsonb_build_object(
      'id', ca.id,
      'contract_name', ct.name,
      'contract_type', ct.contract_type,
      'version', ct.version,
      'accepted_by_name', ca.accepted_by_name,
      'accepted_by_email', ca.accepted_by_email,
      'accepted_at', ca.accepted_at,
      'related_table', ca.related_table,
      'related_id', ca.related_id
    )
    order by ca.accepted_at desc
  ), '[]'::jsonb)
  into contracts_json
  from public.client_contract_acceptances ca
  left join public.client_contract_templates ct on ct.id = ca.contract_template_id
  where ca.client_id = coalesce(order_row.client_id, client_row.id)
    and (ca.related_id is null or ca.related_id = order_row.id or ca.related_table is null)
  limit 10;

  warnings_json := (
    with high_instruction_warnings as (
      select jsonb_build_object(
        'level', 'high',
        'type', 'special_instruction',
        'message', concat('Client has active ', replace(si.instruction_type, '_', ' '), ' instruction: ', left(si.instruction, 120))
      ) as warning
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
      select jsonb_build_object(
        'level', 'warning',
        'type', 'files',
        'message', 'Artwork/files are not attached yet.'
      ) as warning
      where files_count = 0

      union all

      select jsonb_build_object(
        'level', 'warning',
        'type', 'payment',
        'message', 'Payment/balance still needs checking.'
      )
      where balance_due > 0

      union all

      select jsonb_build_object(
        'level', 'warning',
        'type', 'tech_pack',
        'message', 'Tech Pack has unapproved changes.'
      )
      where exists (
        select 1
        from public.client_tech_packs tp
        where tp.status in ('needs_client_approval', 'updated_needs_reapproval', 'draft')
          and tp.client_id = coalesce(order_row.client_id, client_row.id)
      )

      union all

      select warning
      from high_instruction_warnings

      union all

      select jsonb_build_object(
        'level', 'warning',
        'type', 'artwork_approval',
        'message', 'Artwork/mockup approval not found.'
      )
      where not all_represented_products_approved
    ) warnings
  );

  select
    count(*) filter (where value ->> 'status' = 'needs_attention'),
    count(*) filter (where value ->> 'status' = 'pending')
  into needs_attention_count, pending_count
  from jsonb_array_elements(checks_json);

  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', order_row.id,
      'order_number', order_row.order_number,
      'status', order_row.status,
      'pipeline_stage', order_row.pipeline_stage,
      'client_id', coalesce(order_row.client_id, client_row.id),
      'client_name', coalesce(order_row.client_name, client_row.name),
      'client_email', coalesce(order_row.client_email, client_row.email),
      'file_count', files_count,
      'invoice_count', invoices_count,
      'paid_total', paid_total,
      'balance_due', balance_due
    ),
    'summary', jsonb_build_object(
      'total_checks', jsonb_array_length(checks_json),
      'checked_count', (
        select count(*)
        from jsonb_array_elements(checks_json)
        where value ->> 'status' in ('checked', 'not_required')
      ),
      'pending_count', pending_count,
      'needs_attention_count', needs_attention_count,
      'warning_count', jsonb_array_length(warnings_json),
      'ready_state', case
        when needs_attention_count > 0 or jsonb_array_length(warnings_json) > 0 then 'needs_attention'
        when pending_count > 0 then 'pending'
        else 'ready'
      end
    ),
    'checks', checks_json,
    'tech_packs', tech_packs_json,
    'special_instructions', instructions_json,
    'approvals', approvals_json,
    'contracts', contracts_json,
    'warnings', warnings_json
  );
end;
$$;

grant execute on function public.get_order_production_readiness(uuid) to authenticated;
revoke execute on function public.get_order_production_readiness(uuid) from anon;
