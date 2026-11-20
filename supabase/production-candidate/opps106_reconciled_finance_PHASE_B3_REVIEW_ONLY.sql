-- OPPS-106 PHASE B3 / FINANCE RECONCILIATION -- REVIEW ONLY.
-- Rebased from production functions; no service-role grant, trigger modification,
-- new receipt, or issuance switch. Depends on Phase A + B1 + B2.
-- No PayFast call; only a settled, provider-verified QR is classified.
-- Production-specific definitions captured by read-only pg_get_functiondef.
-- Fail on drift, rather than overwriting later independent production changes.
do $guard$
declare v_md5 text;
begin
 if to_regclass('qr_payments.payment_requests') is null
  or to_regprocedure('public.qs_opps106_quarantine_verified_qr_capture(uuid,uuid,uuid,bigint,text,text)') is null
 then raise exception 'OPPS106_PHASE_B2_REQUIRED';end if;
 if exists(select 1 from qr_payments.issuance_controls where enabled)
 then raise exception 'OPPS106_ISSUANCE_MUST_REMAIN_DISABLED';end if;
 select md5(pg_get_functiondef('commerce.qs_project_manual_receipt(uuid)'::regprocedure)) into v_md5;
 if v_md5 <> 'fc235c5e150505b93b3378c05366dc5d' then raise exception 'OPPS106_FINANCE_FUNCTION_DRIFT';end if;
 select md5(pg_get_functiondef('commerce._qs_sync_opps_payment_ledger(uuid,uuid)'::regprocedure)) into v_md5;
 if v_md5 <> 'f5b31fb5508286d6e4cc44bb06f8f9c6' then raise exception 'OPPS106_OPPS_HANDOFF_FUNCTION_DRIFT';end if;
 select md5(pg_get_functiondef('public.enforce_workspace_order_update_scope()'::regprocedure)) into v_md5;
 if v_md5 <> 'cc2acde8cb7fb58f2dfbcfb07a813611' then raise exception 'OPPS106_WORKSPACE_GUARD_DRIFT';end if;
end $guard$;

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
  and exists(select 1 from commerce.service_order_payments intent
    where intent.id=r.checkout_intent_id
      and intent.tenant_id=r.tenant_id
      and intent.service_order_id=r.target_id
      and intent.provider='payfast'
      and intent.status='cancelled'
      and intent.pf_payment_id is null)
  and round(p.amount*100)::bigint=r.amount_cents
  and p.raw_itn->>'payment_status'='COMPLETE'
  and p.raw_itn->>'custom_str4'='cafe_order'
  and p.raw_itn->>'m_payment_id'='JXQR-'||r.id::text
  and r.checkout_gateway_reference=p.raw_itn->>'m_payment_id'
 where so.id=p_service_order_id and so.opps_order_id=v.id
  and so.tenant_id=v.tenant_id
  and ((r.gateway_environment='sandbox' and
        r.gateway_environment_evidence='sandbox_only_verified_itn'
        and r.checkout_environment='sandbox' and r.checkout_merchant_id=p.raw_itn->>'merchant_id'
        and r.checkout_contract_version='jointx_qr_v2')
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
CREATE OR REPLACE FUNCTION commerce.qs_project_manual_receipt(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o commerce.service_orders; tx public.transactions; paid numeric; method text; paid_at timestamptz;
  v_qr_candidates integer:=0;
  v_qr_matched integer:=0;
  v_completed_receipts integer:=0;
  v_qr_environment text;
  v_verified_payment_id text;

begin
  select * into o from commerce.service_orders where id=p_order_id for update;
  if o.id is null then raise exception 'Cafe order unavailable'; end if;
  if o.opps_order_id is not null and not exists(select 1 from public.orders
    where id=o.opps_order_id and tenant_id=o.tenant_id and source='quick_solution') then
    raise exception 'Invalid OPPS order link';
  end if;
  select coalesce(sum(amount),0),max(completed_at),case when count(distinct provider)=1 then min(provider) else 'other' end
    into paid,paid_at,method from commerce.service_order_payments
    where service_order_id=o.id and tenant_id=o.tenant_id and status='completed';
  if paid<=0 then return; end if;

  -- A prefix alone is not payment-environment evidence.
  -- Canonical PayFast creates a completed receipt separately from the
  -- cancelled pending checkout intent. The completed receipt must match a SETTLED private
  -- request, the identical service order/tenant, gateway transaction and cents.
  select count(*)::integer into v_qr_candidates
  from commerce.service_order_payments p
  where p.service_order_id=o.id and p.tenant_id=o.tenant_id
    and p.status='completed' and p.provider='payfast'
    and ((p.raw_itn->>'m_payment_id' like 'JXQR-%')
      or exists(select 1 from qr_payments.payment_requests q
          where q.tenant_id=p.tenant_id and q.target_type='cafe_order'
            and q.target_id=p.service_order_id and q.gateway_payment_id=p.pf_payment_id));

  if v_qr_candidates>0 then
    select count(*)::integer into v_completed_receipts
      from commerce.service_order_payments p
      where p.service_order_id=o.id and p.tenant_id=o.tenant_id
        and p.status='completed';

    select count(*)::integer, min(q.gateway_environment),min(p.pf_payment_id)
    into v_qr_matched,v_qr_environment,v_verified_payment_id
    from commerce.service_order_payments p
    join qr_payments.payment_requests q
      on q.tenant_id=p.tenant_id and q.target_type='cafe_order'
      and q.target_id=p.service_order_id and q.status='settled'
      and q.gateway_payment_id=p.pf_payment_id
      and exists(select 1 from commerce.service_order_payments intent
        where intent.id=q.checkout_intent_id
          and intent.tenant_id=q.tenant_id
          and intent.service_order_id=q.target_id
          and intent.provider='payfast'
          and intent.status='cancelled'
          and intent.pf_payment_id is null)
      and q.amount_cents=round(p.amount*100)::bigint
      and q.checkout_started_at is not null
      and q.checkout_gateway_reference='JXQR-'||q.id::text
    where p.service_order_id=o.id and p.tenant_id=o.tenant_id
      and p.provider='payfast' and p.status='completed'
      and p.pf_payment_id is not null
      and p.raw_itn->>'payment_status'='COMPLETE'
      and p.raw_itn->>'m_payment_id'=q.checkout_gateway_reference
      and p.raw_itn->>'custom_str4'='cafe_order'
      and ((q.gateway_environment='sandbox'
            and q.gateway_environment_evidence='sandbox_only_verified_itn'
            and q.checkout_environment='sandbox'
            and q.checkout_merchant_id=p.raw_itn->>'merchant_id'
            and q.checkout_contract_version='jointx_qr_v2')
        or (q.gateway_environment='live'
            and q.gateway_environment_evidence='payfast_itn_validated_live'
            and q.checkout_environment='live'
            and q.checkout_merchant_id=p.raw_itn->>'merchant_id'
            and q.checkout_contract_version='jointx_qr_v2'));
    if v_qr_matched<>1 or v_qr_candidates<>1 or v_completed_receipts<>1 then
      raise exception 'QR_GATEWAY_ENVIRONMENT_REVIEW_REQUIRED';
    end if;
  end if;

  select * into tx from public.transactions where qs_service_order_id=o.id for update;
  if tx.id is null and o.opps_order_id is not null then
    select * into tx from public.transactions where order_id=o.opps_order_id for update;
    if tx.id is not null then
      -- Existing rows lack receipt identity. Never assume equal amounts mean same receipt.
      raise exception 'Existing OPPS payment needs reconciliation before linking';
    end if;
  end if;
  if tx.id is null then
    insert into public.transactions(tenant_id,type,order_id,order_number,client_name,amount,
      payment_method,payment_status,payment_date,source,qs_service_order_id,notes)
    values(o.tenant_id,'income',o.opps_order_id,o.order_number,o.customer_name,paid,
      case when method in ('cash','card','eft') then method else 'other' end,'completed',
      (coalesce(paid_at,now()) at time zone 'Africa/Johannesburg')::date,
      'quick_solution',o.id,'Cafe receipt projection; manage original receipts in Cafe.');
  else
    if tx.tenant_id<>o.tenant_id or tx.type<>'income' or tx.source<>'quick_solution' then
      raise exception 'Finance receipt link needs review';
    end if;
    update public.transactions set order_id=o.opps_order_id,amount=paid,payment_status='completed',
      payment_method=case when method in ('cash','card','eft') then method else 'other' end
      where id=tx.id;
  end if;

  if v_qr_matched=1 then
    -- Reuse canonical Finance receipt identity. Never create another row
    -- and never reset independently recorded QA exclusions for live captures.
    update public.transactions
    set payment_method='payfast',reference=v_verified_payment_id,
        is_test=case when v_qr_environment='sandbox' then true
          else coalesce(is_test,false) end,
        excluded_from_reports=case when v_qr_environment='sandbox' then true
          else coalesce(excluded_from_reports,false) end
    where qs_service_order_id=o.id and tenant_id=o.tenant_id
      and type='income' and source='quick_solution';
    if not found then raise exception 'VERIFIED_QR_FINANCE_ROW_MISSING'; end if;
  end if;
  if o.opps_order_id is not null then
    update public.orders set deposit_paid=paid,payment_status=case when paid>=total_amount then 'paid' else 'pending' end,
      updated_at=now() where id=o.opps_order_id and tenant_id=o.tenant_id;
  end if;
  if v_qr_matched=1 and o.opps_order_id is not null then
    perform commerce.qs_opps106_classify_verified_qr_handoff(o.id,o.opps_order_id);
  end if;
  perform commerce.qs_project_invoice_receipts(o.id);
end $function$
;
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
  perform commerce.qs_opps106_classify_verified_qr_handoff(p_service_order_id,p_opps_order_id);
end $function$
;
-- Existing public.enforce_workspace_order_update_scope() is NOT replaced.
-- Existing INSERT-only public._set_order_payment_environment() is NOT replaced:
-- verified QR environment is applied later to the linked order by the helper.
