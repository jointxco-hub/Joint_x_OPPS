-- OPPS-106 · Validate a PayFast notification against the exact Café checkout
-- intent without exposing the private commerce schema to PostgREST.
-- This is READ-ONLY and is callable only by the service role.
create or replace function public.qs_verify_payfast_notification_intent(
  p_order_id uuid,
  p_intent_id uuid,
  p_merchant_reference text,
  p_amount numeric
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_matches boolean;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501', message='Trusted backend required';
  end if;

  if p_order_id is null or p_intent_id is null
     or nullif(btrim(p_merchant_reference),'') is null
     or p_amount is null or p_amount <= 0 then
    return false;
  end if;

  select exists (
    select 1
    from commerce.service_orders o
    join commerce.service_order_payments intent
      on intent.service_order_id = o.id
     and intent.tenant_id = o.tenant_id
    where o.id = p_order_id
      and intent.id = p_intent_id
      and intent.provider = 'payfast'
      and intent.status in ('pending','completed')
      and (p_merchant_reference = o.order_number
           or p_merchant_reference = o.id::text)
      and round(intent.amount,2) = round(p_amount,2)
      and round(o.total_amount,2) = round(p_amount,2)
  ) into v_matches;
  return coalesce(v_matches,false);
end
$function$;

revoke all on function public.qs_verify_payfast_notification_intent(
  uuid,uuid,text,numeric) from PUBLIC,anon,authenticated;
grant execute on function public.qs_verify_payfast_notification_intent(
  uuid,uuid,text,numeric) to service_role;
