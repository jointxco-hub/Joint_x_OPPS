-- OPPS-106 STAGING ONLY: staff read-only list of unresolved PayFast QR checkouts.
-- Never infer "unpaid" from age/expiry. Never auto-release a manual payment.
create or replace function public.qs_opps106_list_qr_checkout_reviews(p_limit integer default 50)
returns table(
  service_order_id uuid,
  order_number text,
  payment_request_id uuid,
  checkout_started_at timestamptz,
  qr_status text,
  qr_expired_at timestamptz,
  payment_intent_status text,
  order_payment_status text,
  amount_cents bigint,
  review_action text
)
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_tenant uuid;
begin
  if auth.uid() is null or not public.is_opps_staff() then
    raise exception using errcode='42501',message='OPPS staff access required';
  end if;
  select id into v_tenant from public.tenants
   where slug='quick-solution' and status='active' limit 1;
  if v_tenant is null or
     not public.has_tenant_capability(v_tenant,'cafe.operations.manage') then
    raise exception using errcode='42501',message='Café operations access required';
  end if;
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise exception using errcode='22023',message='Limit out of range';
  end if;
  return query
  select so.id,so.order_number,r.id,r.checkout_started_at,
         r.status,r.expires_at,p.status,so.payment_status,
         r.amount_cents,'VERIFY_PAYFAST_AND_CANONICAL_RECEIPT_BEFORE_MANUAL_PAYMENT'::text
  from qr_payments.payment_requests r
  join commerce.service_orders so on so.id=r.target_id and so.tenant_id=r.tenant_id
  left join commerce.service_order_payments p
    on p.id=r.checkout_intent_id and p.service_order_id=so.id and p.tenant_id=so.tenant_id
  where r.tenant_id=v_tenant
    and r.target_type='cafe_order'
    and r.checkout_started_at is not null
    and r.status<>'settled'
    and so.payment_status in ('unpaid','pending')
    and not exists(
      select 1 from commerce.service_order_payments cp
      where cp.service_order_id=so.id and cp.tenant_id=so.tenant_id
        and cp.status='completed'
    )
  order by r.checkout_started_at asc,r.id asc
  limit p_limit;
end $function$;
revoke all on function public.qs_opps106_list_qr_checkout_reviews(integer)
  from public,anon,authenticated;
grant execute on function public.qs_opps106_list_qr_checkout_reviews(integer)
  to authenticated,service_role;
