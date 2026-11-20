-- OPPS-106 FINANCE CLASSIFICATION CANDIDATE; NEVER AUTO-APPLY.
-- Exact receipt/QR/environment join replaces JXQR-prefix test heuristic.
-- Requires settled QR evidence from a trusted verified PayFast callback.
CREATE OR REPLACE FUNCTION commerce.qs_project_manual_receipt(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 o commerce.service_orders;
 tx public.transactions;
 paid numeric;
 method text;
 paid_at timestamptz;
 v_provider_ref text;
 v_sandbox_qr boolean := false;
 v_verified_qr_count integer:=0;
 v_all_qr_receipts integer:=0;
 v_qr_environment text;
 v_qr_reference text;
begin
 select * into o from commerce.service_orders where id=p_order_id for update;
 if o.id is null then raise exception 'Cafe order unavailable'; end if;
 if o.opps_order_id is not null and not exists (
   select 1 from public.orders where id=o.opps_order_id and tenant_id=o.tenant_id and source='quick_solution'
 ) then raise exception 'Invalid OPPS order link'; end if;
 select coalesce(sum(amount),0),max(completed_at),
   case when count(distinct provider)=1 then min(provider) else 'other' end
 into paid,paid_at,method from commerce.service_order_payments
 where service_order_id=o.id and tenant_id=o.tenant_id and status='completed';
 if paid<=0 then return; end if;
 -- A JXQR prefix is NOT evidence of sandbox. Every QR capture must have
 -- ONE server-verified, settled request linked by actual PayFast payment ID.
 select count(*)::integer,
        min(r.gateway_environment),
        min(r.gateway_payment_id)
 into v_verified_qr_count,v_qr_environment,v_qr_reference
 from commerce.service_order_payments p
 join qr_payments.payment_requests r
   on r.target_type='cafe_order' and r.target_id=p.service_order_id
  and r.tenant_id=p.tenant_id and r.status='settled'
  and r.gateway_payment_id=p.pf_payment_id
  and r.amount_cents=round(p.amount*100)::bigint
  and r.checkout_started_at is not null
  and r.gateway_environment in ('sandbox','live')
  and ((r.gateway_environment='sandbox'
       and r.gateway_environment_evidence='sandbox_only_verified_itn')
       or (r.gateway_environment='live'
       and r.gateway_environment_evidence='payfast_itn_validated_live'
       and r.checkout_environment='live'
       and r.checkout_merchant_id=p.raw_itn->>'merchant_id'
       and r.checkout_gateway_reference=p.raw_itn->>'m_payment_id'
       and r.checkout_contract_version='jointx_qr_v2'))
 where p.service_order_id=o.id and p.tenant_id=o.tenant_id
   and p.status='completed' and p.provider='payfast'
   and p.pf_payment_id is not null
   and p.raw_itn->>'custom_str4'='cafe_order'
   and p.raw_itn->>'payment_status'='COMPLETE'
   and p.raw_itn->>'m_payment_id'='JXQR-'||r.id::text;

 select count(*)::integer into v_all_qr_receipts
 from commerce.service_order_payments p
 where p.service_order_id=o.id and p.tenant_id=o.tenant_id
   and p.status='completed' and p.provider='payfast'
   and (
     (p.raw_itn->>'custom_str4'='cafe_order'
      and p.raw_itn->>'m_payment_id' like 'JXQR-%')
      or exists(select 1 from qr_payments.payment_requests qr
        where qr.tenant_id=p.tenant_id and qr.target_id=p.service_order_id
          and qr.target_type='cafe_order' and qr.gateway_payment_id=p.pf_payment_id)
   );
 if v_all_qr_receipts>0 and (v_verified_qr_count<>1
   or v_all_qr_receipts<>v_verified_qr_count)
 then raise exception 'QR_GATEWAY_ENVIRONMENT_REVIEW_REQUIRED'; end if;
 v_sandbox_qr := coalesce(v_qr_environment='sandbox',false);
 if method='payfast' then
   select min(pf_payment_id) into v_provider_ref
   from commerce.service_order_payments
   where service_order_id=o.id and tenant_id=o.tenant_id
     and status='completed' and provider='payfast';
 end if;
 select * into tx from public.transactions where qs_service_order_id=o.id for update;
 if tx.id is null and o.opps_order_id is not null then
   select * into tx from public.transactions where order_id=o.opps_order_id for update;
   if tx.id is not null then
     raise exception 'Existing OPPS payment needs reconciliation before linking';
   end if;
 end if;
 if tx.id is null then
   insert into public.transactions(
     tenant_id,type,order_id,order_number,client_name,amount,
     payment_method,payment_status,payment_date,source,qs_service_order_id,
     notes,reference,is_test,excluded_from_reports
   ) values(
     o.tenant_id,'income',o.opps_order_id,o.order_number,o.customer_name,paid,
     case when method in ('cash','card','eft','payfast') then method else 'other' end,
     'completed',(coalesce(paid_at,now()) at time zone 'Africa/Johannesburg')::date,
     'quick_solution',o.id,'Cafe receipt projection; manage original receipts in Cafe.',
     v_provider_ref,v_sandbox_qr,v_sandbox_qr
   );
 else
   if tx.tenant_id<>o.tenant_id or tx.type<>'income' or tx.source<>'quick_solution' then
     raise exception 'Finance receipt link needs review';
   end if;
   if tx.amount=paid and tx.payment_status='completed' and tx.order_id is not distinct from o.opps_order_id then
     -- Classification-only refresh: no change to ledger amounts/order link;
     -- avoids triggering a new order payment projection.
     update public.transactions
     set payment_method=case when method in ('cash','card','eft','payfast') then method else 'other' end,
         reference=case when method='payfast' then v_provider_ref else reference end,
         is_test=case when v_sandbox_qr then true else is_test end,
         excluded_from_reports=case when v_sandbox_qr then true else excluded_from_reports end
     where id=tx.id;
   else
     update public.transactions
     set order_id=o.opps_order_id,amount=paid,payment_status='completed',
         payment_method=case when method in ('cash','card','eft','payfast') then method else 'other' end,
         reference=case when method='payfast' then v_provider_ref else reference end,
         is_test=case when v_sandbox_qr then true else is_test end,
         excluded_from_reports=case when v_sandbox_qr then true else excluded_from_reports end
     where id=tx.id;
   end if;
 end if;
 if o.opps_order_id is not null then
   -- Only project a real balance/status change; do not perform a
   -- same-value UPDATE blocked by the workspace authorization trigger.
   update public.orders set deposit_paid=paid,
     payment_status=case when paid>=total_amount then 'paid' else 'pending' end,
     updated_at=now()
   where id=o.opps_order_id and tenant_id=o.tenant_id
     and (deposit_paid is distinct from paid or
          payment_status is distinct from case when paid>=total_amount then 'paid' else 'pending' end);
 end if;
 perform commerce.qs_project_invoice_receipts(o.id);
end $function$
;
create or replace function commerce.qs_opps106_classify_verified_qr_handoff(
 p_service_order_id uuid,p_opps_order_id uuid
) returns void language plpgsql security definer set search_path=''
as $func$
declare
 v public.orders%rowtype;
 v_environment text;
 v_reference text;
 v_count integer;
begin
 select * into v from public.orders
 where id=p_opps_order_id and source='quick_solution' for update;
 if v.id is null then return;end if;
 select count(*)::integer,min(r.gateway_environment) env,min(r.gateway_payment_id) ref
 into v_count,v_environment,v_reference
 from commerce.service_orders so
 join qr_payments.payment_requests r on r.target_id=so.id
  and r.tenant_id=so.tenant_id and r.target_type='cafe_order' and r.status='settled'
 join commerce.service_order_payments p on p.tenant_id=so.tenant_id
  and p.service_order_id=so.id and p.status='completed' and p.provider='payfast'
  and p.pf_payment_id=r.gateway_payment_id
  and round(p.amount*100)::bigint=r.amount_cents
  and p.raw_itn->>'payment_status'='COMPLETE'
  and p.raw_itn->>'m_payment_id'='JXQR-'||r.id::text
 where so.id=p_service_order_id and so.opps_order_id=v.id
  and so.tenant_id=v.tenant_id
  and ((r.gateway_environment='sandbox' and
        r.gateway_environment_evidence='sandbox_only_verified_itn')
    or (r.gateway_environment='live' and
        r.gateway_environment_evidence='payfast_itn_validated_live'
        and r.checkout_environment='live'
        and r.checkout_merchant_id=p.raw_itn->>'merchant_id'
        and r.checkout_gateway_reference=p.raw_itn->>'m_payment_id'
        and r.checkout_contract_version='jointx_qr_v2'));
 if v_count=0 then return;end if;
 if v_count<>1 then raise exception 'AMBIGUOUS_VERIFIED_QR_ORDER';end if;
 if v.payment_method='payfast' and v.payment_environment=v_environment
  and v.payment_reference=v_reference
  and (v_environment<>'sandbox' or (v.is_test and v.excluded_from_reports))
 then return;end if;
 update public.orders set payment_method='payfast',
  payment_environment=v_environment,payment_reference=v_reference,
  is_test=case when v_environment='sandbox' then true else is_test end,
  excluded_from_reports=case when v_environment='sandbox' then true else excluded_from_reports end,
  updated_at=now()
 where id=v.id and tenant_id=v.tenant_id;
end $func$;

CREATE OR REPLACE FUNCTION commerce._qs_sync_opps_payment_ledger(p_service_order_id uuid, p_opps_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists(select 1 from public.transactions where qs_service_order_id=p_service_order_id) then
    if not exists(select 1 from commerce.service_orders where id=p_service_order_id and opps_order_id=p_opps_order_id) then
      raise exception 'Payment handoff link mismatch';
    end if;
    perform commerce.qs_project_manual_receipt(p_service_order_id);
  else
    perform commerce._qs_sync_opps_payment_ledger_legacy(p_service_order_id,p_opps_order_id);
  end if;
  -- Preserve sandbox-only handoff for already verified historical canaries;
  -- live QR is handled by explicit verified evidence and not by prefix.
  perform commerce.qs_opps106_classify_verified_qr_handoff(
    p_service_order_id,p_opps_order_id);
end $function$
;
-- Do not enable live QR, change PayFast secrets or apply to production.
