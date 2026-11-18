-- OPPS-106 staging-only: append-only human review of unresolved QR checkouts.
-- Provider findings are staff-reported, NOT backend-attested proof of no charge.
-- No automatic release, payment-state update or QR issuance.
create table qr_payments.checkout_review_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 payment_request_id uuid not null references qr_payments.payment_requests(id),
 actor_user_id uuid not null,
 event_type text not null check (event_type in (
   'case_opened','provider_no_capture_reported',
   'provider_capture_reported','escalated','second_review_confirmed'
 )),
 provider_reference text,
 notes text not null check (length(btrim(notes)) between 12 and 1000),
 operation_key text not null check(operation_key ~ '^[A-Za-z0-9_-]{8,128}$'),
 created_at timestamptz not null default now(),
 unique(payment_request_id,actor_user_id,operation_key)
);
create index checkout_review_events_request_time
 on qr_payments.checkout_review_events(payment_request_id,created_at,id);
alter table qr_payments.checkout_review_events enable row level security;
revoke all on qr_payments.checkout_review_events from public,anon,authenticated;

create or replace function public.qs_opps106_log_qr_checkout_review(
 p_request_id uuid, p_event_type text,p_provider_reference text,
 p_notes text,p_operation_key text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
 v_actor uuid:=auth.uid();
 v_tenant uuid;
 v_order commerce.service_orders%rowtype;
 v_request qr_payments.payment_requests%rowtype;
 v_prior qr_payments.checkout_review_events%rowtype;
 v_event_id uuid;
 v_ref text:=nullif(btrim(coalesce(p_provider_reference,'')),'');
begin
 if v_actor is null or not public.is_opps_staff()
 then raise exception using errcode='42501',message='OPPS staff access required';end if;
 select id into v_tenant from public.tenants where slug='quick-solution' and status='active';
 if v_tenant is null or not public.has_tenant_capability(v_tenant,'cafe.operations.manage')
 then raise exception using errcode='42501',message='Café operations access required';end if;
 if p_request_id is null or p_event_type not in (
    'case_opened','provider_no_capture_reported','provider_capture_reported',
    'escalated','second_review_confirmed'
   ) or p_notes is null or length(btrim(p_notes)) not between 12 and 1000
   or p_operation_key is null or p_operation_key !~ '^[A-Za-z0-9_-]{8,128}$'
 then raise exception using errcode='22023',message='Invalid review entry';end if;
 if v_ref is not null and (length(v_ref)<6 or length(v_ref)>160)
 then raise exception using errcode='22023',message='Invalid provider reference';end if;
 if p_event_type in ('provider_no_capture_reported','provider_capture_reported','second_review_confirmed')
    and v_ref is null
 then raise exception using errcode='22023',message='Provider reference required';end if;

 -- Lock canonical order then QR in the same order as settlement.
 select so.* into v_order from commerce.service_orders so
 where so.id=(select r.target_id from qr_payments.payment_requests r where r.id=p_request_id)
   and so.tenant_id=v_tenant for update;
 if v_order.id is null then raise exception using errcode='22023',message='Café order unavailable';end if;
 select * into v_request from qr_payments.payment_requests
 where id=p_request_id and target_id=v_order.id and tenant_id=v_tenant and target_type='cafe_order'
 for update;
 if v_request.id is null then raise exception using errcode='22023',message='QR request unavailable';end if;
 select * into v_prior from qr_payments.checkout_review_events
 where payment_request_id=p_request_id and actor_user_id=v_actor and operation_key=p_operation_key;
 if v_prior.id is not null then
   if v_prior.event_type is distinct from p_event_type
      or v_prior.provider_reference is distinct from v_ref
      or v_prior.notes is distinct from btrim(p_notes)
   then raise exception using errcode='23505',message='Review key reused for different evidence';end if;
   return jsonb_build_object('ok',true,'eventId',v_prior.id,'replayed',true);
 end if;

 if v_request.checkout_started_at is null or v_request.status='settled'
    or v_order.payment_status not in ('unpaid','pending')
    or exists (
      select 1 from commerce.service_order_payments p
      where p.tenant_id=v_tenant and p.service_order_id=v_order.id and p.status='completed'
    )
 then return jsonb_build_object('ok',false,'reason','NO_LONGER_REVIEWABLE');end if;

 if p_event_type='second_review_confirmed' and not exists (
   select 1 from qr_payments.checkout_review_events e
   where e.payment_request_id=p_request_id
     and e.tenant_id=v_tenant
     and e.event_type='provider_no_capture_reported'
     and e.provider_reference=v_ref
     and e.actor_user_id<>v_actor
 ) then return jsonb_build_object('ok',false,'reason','INDEPENDENT_FIRST_REVIEW_REQUIRED');end if;

 insert into qr_payments.checkout_review_events(
  tenant_id,payment_request_id,actor_user_id,event_type,provider_reference,notes,operation_key
 ) values(
  v_tenant,p_request_id,v_actor,p_event_type,v_ref,btrim(p_notes),p_operation_key
 ) returning id into v_event_id;
 return jsonb_build_object('ok',true,'eventId',v_event_id,'replayed',false,
   'paymentReleased',false);
end $function$;
revoke all on function public.qs_opps106_log_qr_checkout_review(uuid,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.qs_opps106_log_qr_checkout_review(uuid,text,text,text,text)
 to authenticated;

create or replace function public.qs_opps106_list_qr_checkout_review_events(p_request_id uuid)
returns table(event_id uuid,event_type text,provider_reference text,
 notes text,reviewer_id uuid,created_at timestamptz)
language plpgsql stable security definer set search_path=''
as $function$
declare v_tenant uuid;
begin
 if auth.uid() is null or not public.is_opps_staff()
 then raise exception using errcode='42501',message='OPPS staff access required';end if;
 select id into v_tenant from public.tenants where slug='quick-solution' and status='active';
 if v_tenant is null or not public.has_tenant_capability(v_tenant,'cafe.operations.manage')
 then raise exception using errcode='42501',message='Café operations access required';end if;
 return query select e.id,e.event_type,e.provider_reference,e.notes,e.actor_user_id,e.created_at
 from qr_payments.checkout_review_events e
 join qr_payments.payment_requests r on r.id=e.payment_request_id
 where e.payment_request_id=p_request_id and e.tenant_id=v_tenant and r.tenant_id=v_tenant
 order by e.created_at,e.id;
end $function$;
revoke all on function public.qs_opps106_list_qr_checkout_review_events(uuid)
 from public,anon,authenticated;
grant execute on function public.qs_opps106_list_qr_checkout_review_events(uuid)
 to authenticated;
