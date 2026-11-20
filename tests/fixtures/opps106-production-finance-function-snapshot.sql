-- READ ONLY SNAPSHOT of 20 Nov 2026 production function definitions.
-- Only for disposable PostgreSQL CI. It is not a migration.
-- commerce.qs_project_manual_receipt(uuid) md5 fc235c5e150505b93b3378c05366dc5d
CREATE OR REPLACE FUNCTION commerce.qs_project_manual_receipt(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o commerce.service_orders; tx public.transactions; paid numeric; method text; paid_at timestamptz;
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
  if o.opps_order_id is not null then
    update public.orders set deposit_paid=paid,payment_status=case when paid>=total_amount then 'paid' else 'pending' end,
      updated_at=now() where id=o.opps_order_id and tenant_id=o.tenant_id;
  end if;
  perform commerce.qs_project_invoice_receipts(o.id);
end $function$
;

-- commerce._qs_sync_opps_payment_ledger(uuid,uuid) md5 f5b31fb5508286d6e4cc44bb06f8f9c6
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
end $function$
;

-- public.enforce_workspace_order_update_scope() md5 cc2acde8cb7fb58f2dfbcfb07a813611
CREATE OR REPLACE FUNCTION public.enforce_workspace_order_update_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_required_permission text;
  v_target_detail_pipeline text;
  v_is_service_role boolean :=
    coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      auth.jwt()->>'role',
      ''
    )='service_role';
  v_production_fields_changed boolean := false;
begin
  if not public.is_opps_workspace_tenant(old.tenant_id) then
    return new;
  end if;

  if v_is_service_role then
    return new;
  end if;

  if old.source='quick_solution' then
    v_production_fields_changed :=
      new.production_method is distinct from old.production_method
      or new.production_detail_stage
        is distinct from old.production_detail_stage
      or new.production_client_update
        is distinct from old.production_client_update
      or new.production_internal_note
        is distinct from old.production_internal_note
      or new.production_hold_reason
        is distinct from old.production_hold_reason;

    if v_production_fields_changed
       and not public.has_tenant_permission(
         old.tenant_id,'production.update'
       )
       and not public.has_tenant_permission(
         old.tenant_id,'orders.lifecycle.correct'
       )
    then
      raise exception using
        errcode='42501',
        message='This café role cannot edit internal production workflow.';
    end if;

    if new.status is distinct from old.status then
      v_required_permission := case
        when new.status='cancelled'
          then 'orders.cancel'
        when old.status='confirmed'
             and new.status='in_production'
          then 'orders.lifecycle.start'
        when old.status='in_production'
             and new.status='ready'
          then 'orders.lifecycle.ready'
        when old.status='ready'
             and new.status='shipped'
          then 'orders.lifecycle.handoff'
        when old.status='shipped'
             and new.status='delivered'
          then 'orders.lifecycle.complete'
        else 'orders.lifecycle.correct'
      end;

      if not public.has_tenant_permission(
        old.tenant_id,
        v_required_permission
      ) then
        raise exception using
          errcode='42501',
          message=case
            when v_required_permission='orders.lifecycle.correct'
              then 'This café role cannot reverse, skip, or correct the customer lifecycle.'
            when v_required_permission='orders.cancel'
              then 'This café role cannot cancel orders.'
            else 'This café role cannot perform this lifecycle action.'
          end;
      end if;
    end if;

    if new.production_detail_stage
         is distinct from old.production_detail_stage
       and new.production_detail_stage is not null
    then
      v_target_detail_pipeline :=
        public.qs_pipeline_for_detail_stage(
          new.production_detail_stage
        );

      if v_target_detail_pipeline='ready'
         and not public.has_tenant_permission(
           old.tenant_id,'orders.lifecycle.ready'
         )
      then
        raise exception using
          errcode='42501',
          message='This café role cannot mark an order ready for customer handoff.';
      end if;
    end if;

    if new.pipeline_stage is distinct from old.pipeline_stage then
      v_required_permission := case
        when new.pipeline_stage='ready'
          then 'orders.lifecycle.ready'
        when new.pipeline_stage='dispatched'
          then 'orders.lifecycle.handoff'
        when new.pipeline_stage='complete'
          then 'orders.lifecycle.complete'
        when new.pipeline_stage='received'
             and old.pipeline_stage is distinct from 'received'
          then 'orders.lifecycle.correct'
        else null
      end;

      if v_required_permission is not null
         and not public.has_tenant_permission(
           old.tenant_id,
           v_required_permission
         )
      then
        raise exception using
          errcode='42501',
          message='This café role cannot perform this pipeline transition.';
      end if;
    end if;
  end if;

  if public.has_tenant_permission(old.tenant_id,'orders.write') then
    return new;
  end if;

  if public.has_tenant_permission(old.tenant_id,'production.update') then
    v_old := to_jsonb(old)
      - array[
        'status','pipeline_stage',
        'production_method','production_detail_stage',
        'production_client_update','production_internal_note',
        'production_hold_reason',
        'assigned_to','assigned_team','due_date','updated_at'
      ];

    v_new := to_jsonb(new)
      - array[
        'status','pipeline_stage',
        'production_method','production_detail_stage',
        'production_client_update','production_internal_note',
        'production_hold_reason',
        'assigned_to','assigned_team','due_date','updated_at'
      ];

    if v_old is distinct from v_new then
      raise exception using
        errcode='42501',
        message='This workspace role can update production progress only.';
    end if;

    return new;
  end if;

  raise exception using
    errcode='42501',
    message='This workspace role cannot edit orders.';
end
$function$
;