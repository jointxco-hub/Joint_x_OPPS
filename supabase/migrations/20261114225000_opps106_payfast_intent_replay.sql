-- OPPS-106: verified PayFast ITN replay after completed gateway payment.
-- The existing projection cancels stale pending intent rows and creates a
-- separate completed payment row. Bind a replay to the exact gateway
-- payment ID, not merely a matching amount or historical pending intent.
drop function if exists public.qs_verify_payfast_notification_intent(uuid,uuid,text,numeric);

create function public.qs_verify_payfast_notification_intent(
  p_order_id uuid,
  p_intent_id uuid,
  p_merchant_reference text,
  p_amount numeric,
  p_pf_payment_id text
) returns boolean
language plpgsql security definer
set search_path=''
as $function$
declare
  v_match boolean;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501', message='Trusted backend required';
  end if;
  if p_order_id is null or p_intent_id is null
    or nullif(btrim(p_merchant_reference),'') is null
    or nullif(btrim(p_pf_payment_id),'') is null
    or p_amount is null or p_amount <= 0 then
    return false;
  end if;

  select exists (
    select 1
    from commerce.service_orders o
    join commerce.service_order_payments intent
      on intent.service_order_id=o.id and intent.tenant_id=o.tenant_id
    where o.id=p_order_id and intent.id=p_intent_id
      and intent.provider='payfast'
      and (p_merchant_reference=o.order_number or p_merchant_reference=o.id::text)
      and round(o.total_amount,2)=round(p_amount,2)
      and round(intent.amount,2)=round(p_amount,2)
      and (
        intent.status='pending'
        or (
          intent.status in ('cancelled','completed') and
          exists (
            select 1 from commerce.service_order_payments receipt
            where receipt.service_order_id=o.id
              and receipt.tenant_id=o.tenant_id
              and receipt.provider='payfast'
              and receipt.status='completed'
              and receipt.pf_payment_id=btrim(p_pf_payment_id)
              and round(receipt.amount,2)=round(p_amount,2)
          )
        )
      )
  ) into v_match;
  return coalesce(v_match,false);
end
$function$;

revoke all on function public.qs_verify_payfast_notification_intent(uuid,uuid,text,numeric,text)
  from public,anon,authenticated;
grant execute on function public.qs_verify_payfast_notification_intent(uuid,uuid,text,numeric,text)
  to service_role;
