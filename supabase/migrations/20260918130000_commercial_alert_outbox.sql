-- Commercial Alerts: durable tenant-scoped outbox for customer actions.
-- This migration deliberately does NOT send web push itself.
-- It records durable alert events from canonical quote/invoice audit rows.
-- A separate Edge Function dispatcher can deliver pending alerts without
-- risking quote actions or PayFast reconciliation.

begin;

create table if not exists public.commercial_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  entity_number text,
  title text not null,
  body text not null,
  action_url text,
  payload jsonb not null default '{}'::jsonb,
  source_kind text not null,
  source_id uuid not null,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'processing', 'sent', 'failed')),
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint commercial_alerts_source_once unique (source_kind, source_id)
);

create index if not exists idx_commercial_alerts_tenant_created
  on public.commercial_alerts (tenant_id, created_at desc);

create index if not exists idx_commercial_alerts_pending
  on public.commercial_alerts (created_at)
  where delivery_status in ('pending', 'failed');

alter table public.commercial_alerts enable row level security;

drop policy if exists tenant_members_read_commercial_alerts on public.commercial_alerts;
create policy tenant_members_read_commercial_alerts
  on public.commercial_alerts
  for select to authenticated
  using (public.can_access_tenant(tenant_id));

create or replace function public.enqueue_quote_commercial_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_quote public.opps_quotes%rowtype;
  v_title text;
  v_body text;
begin
  if new.event_type not in ('accepted', 'declined', 'changes_requested') then
    return new;
  end if;

  select q.* into v_quote
  from public.opps_quotes q
  where q.id = new.quote_id;

  if v_quote.id is null then
    return new;
  end if;

  case new.event_type
    when 'accepted' then
      v_title := 'Quote accepted';
      v_body := format(
        '%s accepted %s',
        coalesce(nullif(new.actor_label, ''), coalesce(nullif(v_quote.customer_name, ''), 'Client')),
        v_quote.quote_number
      );
    when 'declined' then
      v_title := 'Quote declined';
      v_body := format(
        '%s declined %s%s',
        coalesce(nullif(new.actor_label, ''), coalesce(nullif(v_quote.customer_name, ''), 'Client')),
        v_quote.quote_number,
        case when nullif(new.note, '') is not null then format(' - %s', left(new.note, 180)) else '' end
      );
    when 'changes_requested' then
      v_title := 'Quote changes requested';
      v_body := format(
        '%s requested changes to %s%s',
        coalesce(nullif(new.actor_label, ''), coalesce(nullif(v_quote.customer_name, ''), 'Client')),
        v_quote.quote_number,
        case when nullif(new.note, '') is not null then format(' - %s', left(new.note, 180)) else '' end
      );
  end case;

  begin
    insert into public.commercial_alerts (
      tenant_id, event_type, entity_type, entity_id, entity_number,
      title, body, action_url, payload, source_kind, source_id
    ) values (
      new.tenant_id,
      'quote_' || new.event_type,
      'quote',
      new.quote_id,
      v_quote.quote_number,
      v_title,
      v_body,
      '/Quotes?open=' || new.quote_id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'quote_id', new.quote_id,
        'quote_number', v_quote.quote_number,
        'customer_name', v_quote.customer_name,
        'actor_label', new.actor_label,
        'actor_email', new.actor_email,
        'note', new.note,
        'quote_event_type', new.event_type,
        'quote_event_id', new.id
      )),
      'opps_quote_events',
      new.id
    )
    on conflict (source_kind, source_id) do nothing;
  exception when others then
    -- Alert enqueue must never break the customer's quote action.
    raise warning 'commercial alert enqueue failed for quote event %: %', new.id, sqlerrm;
  end;

  return new;
end;
$function$;

drop trigger if exists trg_enqueue_quote_commercial_alert on public.opps_quote_events;
create trigger trg_enqueue_quote_commercial_alert
after insert on public.opps_quote_events
for each row
when (new.event_type in ('accepted', 'declined', 'changes_requested'))
execute function public.enqueue_quote_commercial_alert();

create or replace function public.enqueue_invoice_commercial_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_invoice public.opps_invoices%rowtype;
  v_amount numeric;
  v_payment_status text;
begin
  if new.activity_type <> 'invoice_payment_recorded'
     or coalesce(new.metadata->>'source', '') <> 'payfast' then
    return new;
  end if;

  select i.* into v_invoice
  from public.opps_invoices i
  where i.id = new.invoice_id;

  if v_invoice.id is null then
    return new;
  end if;

  begin
    v_amount := nullif(new.metadata->>'amount', '')::numeric;
  exception when invalid_text_representation then
    v_amount := null;
  end;

  v_payment_status := nullif(new.metadata->>'payment_status', '');

  begin
    insert into public.commercial_alerts (
      tenant_id, event_type, entity_type, entity_id, entity_number,
      title, body, action_url, payload, source_kind, source_id
    ) values (
      new.tenant_id,
      case when v_payment_status = 'paid' then 'invoice_paid' else 'invoice_payment_received' end,
      'invoice',
      new.invoice_id,
      v_invoice.invoice_number,
      case when v_payment_status = 'paid' then 'Invoice paid' else 'Payment received' end,
      concat_ws(
        ' - ',
        case
          when v_amount is not null then format('R%s received via PayFast', to_char(v_amount, 'FM999999999990.00'))
          else 'PayFast payment received'
        end,
        v_invoice.invoice_number,
        nullif(v_invoice.customer_name, '')
      ),
      '/Invoices?invoice=' || new.invoice_id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'invoice_id', new.invoice_id,
        'invoice_number', v_invoice.invoice_number,
        'customer_name', v_invoice.customer_name,
        'amount', v_amount,
        'payment_status', v_payment_status,
        'payment_id', new.metadata->>'payment_id',
        'reference', new.metadata->>'reference',
        'invoice_activity_id', new.id
      )),
      'opps_invoice_activity',
      new.id
    )
    on conflict (source_kind, source_id) do nothing;
  exception when others then
    -- Alert enqueue must never break PayFast reconciliation.
    raise warning 'commercial alert enqueue failed for invoice activity %: %', new.id, sqlerrm;
  end;

  return new;
end;
$function$;

drop trigger if exists trg_enqueue_invoice_commercial_alert on public.opps_invoice_activity;
create trigger trg_enqueue_invoice_commercial_alert
after insert on public.opps_invoice_activity
for each row
when (new.activity_type = 'invoice_payment_recorded')
execute function public.enqueue_invoice_commercial_alert();

revoke all on function public.enqueue_quote_commercial_alert() from public;
revoke all on function public.enqueue_invoice_commercial_alert() from public;

-- Backfill canonical customer actions already recorded before this migration.
-- This makes the new in-OPPS alert history useful immediately, including
-- today's PayFast payment, while source dedupe keeps this migration replay-safe.
insert into public.commercial_alerts (
  tenant_id, event_type, entity_type, entity_id, entity_number,
  title, body, action_url, payload, source_kind, source_id, created_at
)
select
  e.tenant_id,
  'quote_' || e.event_type,
  'quote',
  e.quote_id,
  q.quote_number,
  case e.event_type
    when 'accepted' then 'Quote accepted'
    when 'declined' then 'Quote declined'
    else 'Quote changes requested'
  end,
  case e.event_type
    when 'accepted' then format(
      '%s accepted %s',
      coalesce(nullif(e.actor_label, ''), coalesce(nullif(q.customer_name, ''), 'Client')),
      q.quote_number
    )
    when 'declined' then format(
      '%s declined %s%s',
      coalesce(nullif(e.actor_label, ''), coalesce(nullif(q.customer_name, ''), 'Client')),
      q.quote_number,
      case when nullif(e.note, '') is not null then format(' - %s', left(e.note, 180)) else '' end
    )
    else format(
      '%s requested changes to %s%s',
      coalesce(nullif(e.actor_label, ''), coalesce(nullif(q.customer_name, ''), 'Client')),
      q.quote_number,
      case when nullif(e.note, '') is not null then format(' - %s', left(e.note, 180)) else '' end
    )
  end,
  '/Quotes?open=' || e.quote_id::text,
  jsonb_strip_nulls(jsonb_build_object(
    'quote_id', e.quote_id,
    'quote_number', q.quote_number,
    'customer_name', q.customer_name,
    'actor_label', e.actor_label,
    'actor_email', e.actor_email,
    'note', e.note,
    'quote_event_type', e.event_type,
    'quote_event_id', e.id
  )),
  'opps_quote_events',
  e.id,
  e.created_at
from public.opps_quote_events e
join public.opps_quotes q on q.id = e.quote_id
where e.event_type in ('accepted', 'declined', 'changes_requested')
on conflict (source_kind, source_id) do nothing;

insert into public.commercial_alerts (
  tenant_id, event_type, entity_type, entity_id, entity_number,
  title, body, action_url, payload, source_kind, source_id, created_at
)
select
  a.tenant_id,
  case when nullif(a.metadata->>'payment_status', '') = 'paid'
       then 'invoice_paid' else 'invoice_payment_received' end,
  'invoice',
  a.invoice_id,
  i.invoice_number,
  case when nullif(a.metadata->>'payment_status', '') = 'paid'
       then 'Invoice paid' else 'Payment received' end,
  concat_ws(
    ' - ',
    case
      when nullif(a.metadata->>'amount', '') is not null
      then format(
        'R%s received via PayFast',
        to_char((a.metadata->>'amount')::numeric, 'FM999999999990.00')
      )
      else 'PayFast payment received'
    end,
    i.invoice_number,
    nullif(i.customer_name, '')
  ),
  '/Invoices?invoice=' || a.invoice_id::text,
  jsonb_strip_nulls(jsonb_build_object(
    'invoice_id', a.invoice_id,
    'invoice_number', i.invoice_number,
    'customer_name', i.customer_name,
    'amount', nullif(a.metadata->>'amount', '')::numeric,
    'payment_status', nullif(a.metadata->>'payment_status', ''),
    'payment_id', a.metadata->>'payment_id',
    'reference', a.metadata->>'reference',
    'invoice_activity_id', a.id
  )),
  'opps_invoice_activity',
  a.id,
  a.created_at
from public.opps_invoice_activity a
join public.opps_invoices i on i.id = a.invoice_id
where a.activity_type = 'invoice_payment_recorded'
  and coalesce(a.metadata->>'source', '') = 'payfast'
on conflict (source_kind, source_id) do nothing;


comment on table public.commercial_alerts is
  'Durable tenant-scoped outbox of client commercial actions. Quote acceptance/decline/change requests and completed PayFast invoice payments are inserted automatically from canonical audit rows. Push delivery is decoupled so notification failures can never roll back quote actions or payments.';

commit;
