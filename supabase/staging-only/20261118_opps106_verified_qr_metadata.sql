-- STAGING ONLY. Do NOT promote this SQL to production until gateway
-- settlement records explicit sandbox/live provenance.
-- Existing workspace authorization checks remain intact.
create or replace function commerce.qs_opps106_verified_sandbox_qr_link(p_service_order_id uuid,p_opps_order_id uuid)
returns boolean language sql stable security definer set search_path = 'pg_catalog'
as $$
 select exists (
  select 1 from commerce.service_orders so
  join public.orders o on o.id=so.opps_order_id and o.tenant_id=so.tenant_id
    and o.source='quick_solution'
  join qr_payments.payment_requests r on r.target_id=so.id
    and r.target_type='cafe_order' and r.tenant_id=so.tenant_id
    and r.status='settled' and r.gateway_payment_id is not null
    and r.checkout_started_at is not null
    and r.amount_cents=round(so.total_amount*100)::bigint
  join commerce.service_order_payments p on p.service_order_id=so.id
    and p.tenant_id=so.tenant_id and p.status='completed'
    and p.provider='payfast' and p.pf_payment_id=r.gateway_payment_id
    and round(p.amount*100)::bigint=r.amount_cents
    and p.raw_itn->>'payment_status'='COMPLETE'
    and p.raw_itn->>'m_payment_id'='JXQR-'||r.id::text
  where so.id=p_service_order_id and o.id=p_opps_order_id
    and so.payment_status='paid'
 );
$$;
revoke all on function commerce.qs_opps106_verified_sandbox_qr_link(uuid,uuid) from public,anon,authenticated;

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

  -- Allow only a verified cache refresh of derived order tags.
  -- Never grant permission to modify any other order field.
  if (to_jsonb(new) - 'current_tags') = (to_jsonb(old) - 'current_tags')
     and new.current_tags = (
       select coalesce(jsonb_agg(distinct role_key), '[]'::jsonb)
       from public.order_tags
       where order_id = old.id and resolved_at is null
     )
  then
    return new;
  end if;

  if public.has_tenant_permission(old.tenant_id,'orders.write') then
    return new;
  end if;

  -- ── Phase P2.2: narrowly-scoped payment-status projection write,
  -- LEDGER-PROVEN, not permission-alone. Allows ONLY the single
  -- transition old.payment_status = 'pending' -> new.payment_status =
  -- 'paid', ONLY when payment_status is the SOLE changed column (every
  -- other column, including updated_at, byte-identical between old
  -- and new), for a session holding finance.write - AND ONLY when
  -- public._order_ledger_fully_covers_total(old.id, old.total_amount)
  -- independently confirms public.transactions already shows the
  -- order's total fully covered by completed income.
  --
  -- The Phase P2.1 draft of this branch checked finance.write alone -
  -- a security review (Phase P2.2 §2) correctly flagged that as
  -- insufficient: a finance-only session could have issued a RAW
  -- `UPDATE orders SET payment_status = 'paid'` directly (via
  -- PostgREST, bypassing _recompute_order_payment_projection
  -- entirely) and this trigger would have allowed it on PERMISSION
  -- ALONE, with no proof any money had ever actually been recorded.
  -- That gap is closed here: this authorization gate now re-derives
  -- ledger sufficiency itself, using the exact same canonical
  -- completed-income filter as get_order_production_readiness and
  -- _recompute_order_payment_projection (one shared helper function,
  -- so the two checks cannot drift apart). A finance-only session
  -- still cannot mark an order paid without the ledger proving it -
  -- permission to write the column is necessary but no longer
  -- sufficient on its own.
  --
  -- This does not grant orders.write or production.update, and it
  -- cannot be used for any other column or any other status value -
  -- a session with only finance.write still cannot change status,
  -- pipeline_stage, courier, totals, or anything else about the
  -- order. Independently audited here (context =
  -- 'enforce_workspace_order_update_scope', distinguishing a direct
  -- write from the trigger-driven 'ledger_balance_covered' path) so
  -- operators can tell which path produced a given 'paid' row.
  if new.payment_status is distinct from old.payment_status
     and old.payment_status = 'pending'
     and new.payment_status = 'paid'
     and (to_jsonb(new) - 'payment_status' - 'updated_at')
       = (to_jsonb(old) - 'payment_status' - 'updated_at')
     and public.has_tenant_permission(old.tenant_id, 'finance.write')
     and public._order_ledger_fully_covers_total(old.id, old.total_amount)
  then
    insert into public.opps_order_payment_projection_audit (
      order_id, tenant_id, from_status, to_status, outcome, actor_uid, context
    ) values (
      old.id, old.tenant_id, 'pending', 'paid', 'synced',
      auth.uid(), 'enforce_workspace_order_update_scope'
    );
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

  -- OPPS-106 staging-only, exact verified QR metadata projection. No
  -- status/amount/production changes, no caller-controlled sandbox flag.
  if old.source='quick_solution'
     and new.payment_method='payfast'
     and new.payment_environment='sandbox'
     and new.is_test=true and new.excluded_from_reports=true
     and (to_jsonb(new)-array['payment_method','payment_environment',
           'payment_reference','is_test','excluded_from_reports','updated_at'])
         = (to_jsonb(old)-array['payment_method','payment_environment',
           'payment_reference','is_test','excluded_from_reports','updated_at'])
     and commerce.qs_opps106_verified_sandbox_qr_link(
       (old.source_metadata->'quick_solution'->>'service_order_id')::uuid,old.id)
     and exists(
       select 1 from qr_payments.payment_requests r
       where r.target_id=(old.source_metadata->'quick_solution'->>'service_order_id')::uuid
         and r.tenant_id=old.tenant_id and r.target_type='cafe_order'
         and r.status='settled' and r.gateway_payment_id=new.payment_reference
     )
  then return new; end if;

  raise exception using
    errcode='42501',
    message='This workspace role cannot edit orders.';
end
$function$
;
create or replace function commerce.qs_opps106_classify_sandbox_handoff(p_service_order_id uuid,p_opps_order_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
 v_old public.orders;
 v_ref text;
 v_request_id uuid;
begin
 if not commerce.qs_opps106_verified_sandbox_qr_link(p_service_order_id,p_opps_order_id)
 then return; end if;
 select o.* into v_old from public.orders o where o.id=p_opps_order_id for update;
 if v_old.id is null then return; end if;
 select r.gateway_payment_id,r.id into v_ref,v_request_id
 from qr_payments.payment_requests r
 where r.target_id=p_service_order_id and r.tenant_id=v_old.tenant_id
   and r.target_type='cafe_order' and r.status='settled'
 order by r.created_at limit 1;
 if v_ref is null then raise exception 'Verified QR reference missing'; end if;
 if v_old.payment_method='payfast' and v_old.payment_environment='sandbox'
    and v_old.payment_reference=v_ref
    and v_old.is_test and v_old.excluded_from_reports then return; end if;
 update public.orders
 set payment_method='payfast', payment_environment='sandbox',
     payment_reference=v_ref,is_test=true,excluded_from_reports=true,
     updated_at=now()
 where id=p_opps_order_id and tenant_id=v_old.tenant_id;
 insert into public.opps_activity_events
 (tenant_id,actor_email,actor_name,event_type,entity_type,entity_id,summary,metadata)
 values (v_old.tenant_id,'opps106-staging@system.invalid','OPPS-106 Staging',
   'cafe_qr_sandbox_reconciled','orders',p_opps_order_id,
   'Reconciled verified sandbox QR order payment classification',
   jsonb_build_object('service_order_id',p_service_order_id,
       'payment_request_id',v_request_id,'payment_ref',v_ref,
       'previous_payment_environment',v_old.payment_environment,
       'previous_payment_method',v_old.payment_method,
       'previous_is_test',v_old.is_test,
       'previous_excluded_from_reports',v_old.excluded_from_reports));
end $$;
revoke all on function commerce.qs_opps106_classify_sandbox_handoff(uuid,uuid) from public,anon,authenticated;

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
  perform commerce.qs_opps106_classify_sandbox_handoff(p_service_order_id,p_opps_order_id);
end $function$
;
-- Reconcile only existing fully verified settled staging QR payments.
select commerce.qs_opps106_classify_sandbox_handoff(so.id,so.opps_order_id)
from commerce.service_orders so
where so.opps_order_id is not null
  and commerce.qs_opps106_verified_sandbox_qr_link(so.id,so.opps_order_id);
