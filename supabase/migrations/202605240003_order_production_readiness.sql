-- OPPS production readiness checklist foundation.
-- Depends on the X LAB client account foundation tables.

create table if not exists public.order_production_readiness_checks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  client_id uuid null references public.clients(id) on delete set null,
  check_key text not null,
  label text not null,
  status text not null default 'pending',
  checked_by uuid null references auth.users(id) on delete set null,
  checked_at timestamptz null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_production_readiness_checks_status_check
    check (status in ('pending', 'checked', 'not_required', 'needs_attention')),
  constraint order_production_readiness_checks_unique unique (order_id, check_key)
);

alter table public.order_production_readiness_checks enable row level security;

create index if not exists idx_order_readiness_order_id on public.order_production_readiness_checks(order_id);
create index if not exists idx_order_readiness_client_id on public.order_production_readiness_checks(client_id);
create index if not exists idx_order_readiness_status on public.order_production_readiness_checks(status);
create index if not exists idx_order_readiness_updated_at on public.order_production_readiness_checks(updated_at desc);

create or replace function public.can_manage_order_production_readiness()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.users u
      where (u.auth_user_id = auth.uid() or lower(u.user_email) = lower(auth.jwt() ->> 'email'))
        and coalesce(u.is_active, true) = true
        and coalesce(u.role, '') in (
          'admin',
          'owner',
          'ops',
          'operations',
          'ops_manager',
          'manager',
          'production',
          'support',
          'sales'
        )
    )
    or lower(auth.jwt() ->> 'email') = 'jointx.co@gmail.com',
    false
  );
$$;

grant execute on function public.can_manage_order_production_readiness() to authenticated;
revoke execute on function public.can_manage_order_production_readiness() from anon;

drop policy if exists "Internal users can read production readiness checks" on public.order_production_readiness_checks;
create policy "Internal users can read production readiness checks"
on public.order_production_readiness_checks
for select
to authenticated
using (public.can_manage_order_production_readiness());

drop policy if exists "Internal users can manage production readiness checks" on public.order_production_readiness_checks;
create policy "Internal users can manage production readiness checks"
on public.order_production_readiness_checks
for all
to authenticated
using (public.can_manage_order_production_readiness())
with check (public.can_manage_order_production_readiness());

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
      where not exists (
        select 1
        from public.client_approvals a
        where a.client_id = coalesce(order_row.client_id, client_row.id)
          and a.approval_type in ('artwork', 'mockup', 'production_ready')
          and a.status = 'approved'
      )
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
    'quote_approved',
    'artwork_files_attached',
    'artwork_mockup_approved',
    'tech_pack_checked',
    'special_instructions_checked',
    'payment_balance_checked',
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
    when 'quote_approved' then 'Quote approved'
    when 'artwork_files_attached' then 'Artwork/files attached'
    when 'artwork_mockup_approved' then 'Artwork/mockup approved'
    when 'tech_pack_checked' then 'Tech Pack checked'
    when 'special_instructions_checked' then 'Special instructions checked'
    when 'payment_balance_checked' then 'Payment/balance checked'
    when 'contract_terms_accepted' then 'Contract/terms accepted if required'
    when 'production_notes_reviewed' then 'Production notes reviewed'
  end;

  insert into public.order_production_readiness_checks (
    order_id,
    client_id,
    check_key,
    label,
    status,
    checked_by,
    checked_at,
    notes,
    updated_at
  )
  values (
    p_order_id,
    order_client_id,
    clean_key,
    check_label,
    clean_status,
    case when clean_status in ('checked', 'not_required') then auth.uid() else null end,
    case when clean_status in ('checked', 'not_required') then now() else null end,
    clean_notes,
    now()
  )
  on conflict (order_id, check_key)
  do update set
    status = excluded.status,
    checked_by = excluded.checked_by,
    checked_at = excluded.checked_at,
    notes = excluded.notes,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'check_key', clean_key,
    'status', clean_status
  );
end;
$$;

grant execute on function public.update_order_production_readiness_check(uuid, text, text, text) to authenticated;
revoke execute on function public.update_order_production_readiness_check(uuid, text, text, text) from anon;
