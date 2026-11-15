-- Read-only staging QR scanner status. Does not reveal payment details,
-- create a checkout, or accept payments. Only the trusted backend service
-- role may call this RPC. Exposed here solely as an internal REST bridge.
create or replace function public.qs_opps106_scan_counter_qr_status(p_request_id uuid)
returns text
language plpgsql security definer
set search_path = pg_catalog
as $function$
declare
  v_req record;
begin
  if p_request_id is null then return 'invalid'; end if;
  select r.id,r.tenant_id,r.target_id,r.status,r.expires_at,
         r.amount_cents,r.checkout_url
    into v_req
    from qr_payments.payment_requests r
    where r.id=p_request_id and r.target_type='cafe_order';

  if not found then return 'invalid'; end if;
  if v_req.status='settled' then return 'settled'; end if;
  if v_req.status='revoked' then return 'revoked'; end if;
  if v_req.status='expired' or v_req.expires_at<=clock_timestamp()
    then return 'expired'; end if;
  if v_req.status <> 'active' then return 'invalid'; end if;

  -- Fail closed if another payment/order edit has made this QR stale.
  if not exists (
    select 1 from commerce.service_orders so
    where so.id=v_req.target_id and so.tenant_id=v_req.tenant_id
      and so.channel='counter' and so.opps_order_id is null
      and so.status not in ('cancelled','completed','draft')
      and so.payment_status in ('unpaid','pending')
      and round(so.total_amount*100)=v_req.amount_cents
      and not exists (
        select 1 from commerce.service_order_payments p
        where p.service_order_id=so.id and p.tenant_id=so.tenant_id
          and p.status in ('completed','pending')
      )
  ) then return 'revoked'; end if;
  -- This is NOT permission to redirect to PayFast: server-issued
  -- checkout, nonce, expiry and gateway callback still need integration.
  return 'awaiting_gateway';
end
$function$;
revoke all on function public.qs_opps106_scan_counter_qr_status(uuid)
from public,anon,authenticated;
grant execute on function public.qs_opps106_scan_counter_qr_status(uuid)
to service_role;
