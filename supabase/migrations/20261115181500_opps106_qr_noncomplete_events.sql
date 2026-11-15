-- OPPS-106: record verified non-complete QR gateway notifications safely.
-- Service-only canonical closure: never uses a browser payment status.
create table if not exists qr_payments.noncomplete_events (
  id uuid primary key default gen_random_uuid(),
  gateway_payment_id text not null check(length(gateway_payment_id)>0),
  event_status text not null check(event_status in ('failed','cancelled')),
  claimed_request_id uuid not null,
  claimed_order_id uuid not null,
  claimed_tenant_id uuid not null,
  amount_cents bigint not null check(amount_cents>0),
  handling text not null check(handling in
    ('closed','replayed','mismatched','already_settled','late_or_stale')),
  created_at timestamptz not null default now(),
  unique(gateway_payment_id,event_status,claimed_request_id)
);
alter table qr_payments.noncomplete_events enable row level security;
revoke all on qr_payments.noncomplete_events from public,anon,authenticated;
grant select,insert on qr_payments.noncomplete_events to service_role;
create index if not exists qr_noncomplete_recent
  on qr_payments.noncomplete_events(created_at desc);

create or replace function public.qs_opps106_record_counter_qr_noncomplete(
  p_request_id uuid,p_order_id uuid,p_tenant_id uuid,
  p_amount_cents bigint,p_pf_payment_id text,p_status text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog
as $fn$
declare
  v_order commerce.service_orders%rowtype;
  v_request qr_payments.payment_requests%rowtype;
  v_intent commerce.service_order_payments%rowtype;
  v_handling text;
begin
  if coalesce(auth.role(),'')<>'service_role'
     and session_user not in ('postgres','supabase_admin')
  then raise exception using errcode='42501',message='Trusted backend required';end if;
  if p_request_id is null or p_order_id is null or p_tenant_id is null
    or p_amount_cents is null or p_amount_cents<=0
    or p_status not in ('failed','cancelled')
    or nullif(btrim(p_pf_payment_id),'') is null then
    return jsonb_build_object('ok',false,'reason','INVALID_INPUT');end if;

  -- Same order -> QR row lock discipline as issue and settle.
  select * into v_order from commerce.service_orders
   where id=p_order_id for update;
  select * into v_request from qr_payments.payment_requests
   where id=p_request_id for update;

  if v_order.id is null or v_request.id is null
    or v_order.tenant_id<>p_tenant_id or v_request.tenant_id<>p_tenant_id
    or v_request.target_type<>'cafe_order'
    or v_request.target_id<>p_order_id
    or v_request.amount_cents<>p_amount_cents
    or round(v_order.total_amount*100)<>p_amount_cents
  then
    v_handling:='mismatched';
  elsif v_request.status='settled' then
    v_handling:='already_settled';
  else
    select * into v_intent from commerce.service_order_payments
    where id=v_request.checkout_intent_id
      and service_order_id=p_order_id and tenant_id=p_tenant_id
      and provider='payfast';
    if v_intent.id is null or
      round(v_intent.amount*100)<>p_amount_cents or
      v_request.checkout_started_at is null or
      v_request.checkout_started_at>v_request.expires_at or
      v_intent.status<>'pending'
    then v_handling:='late_or_stale';
    else
      update commerce.service_order_payments
       set status=p_status,updated_at=now()
       where id=v_intent.id and status='pending';
      if v_request.status='active' then
        update qr_payments.payment_requests
          set status='revoked',checkout_url=null,updated_at=now()
          where id=v_request.id;
      end if;
      v_handling:='closed';
    end if;
  end if;

  -- Record even mismatched/orphan events, without customer PII.
  -- Unique identity guarantees repeated delivery cannot create more rows.
  insert into qr_payments.noncomplete_events
    (gateway_payment_id,event_status,claimed_request_id,claimed_order_id,
     claimed_tenant_id,amount_cents,handling)
  values (btrim(p_pf_payment_id),p_status,p_request_id,p_order_id,
     p_tenant_id,p_amount_cents,v_handling)
  on conflict(gateway_payment_id,event_status,claimed_request_id) do nothing;

  return jsonb_build_object('ok',true,'status',v_handling);
end
$fn$;
revoke all on function public.qs_opps106_record_counter_qr_noncomplete(uuid,uuid,uuid,bigint,text,text)
from public,anon,authenticated;
grant execute on function public.qs_opps106_record_counter_qr_noncomplete(uuid,uuid,uuid,bigint,text,text)
to service_role;
