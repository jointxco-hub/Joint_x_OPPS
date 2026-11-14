-- OPPS-106 finance-only order payment projection gate.
-- Run before 20261114223600_opps106_paid_invoice_order_projection.sql.
-- Existing production guard is kept, with a single narrowly scoped exception.
-- Staging's newer audited guard is already equivalent; leave it intact.
create or replace function public._opps106_ledger_covers_order(
  p_order_id uuid, p_tenant_id uuid, p_total numeric
) returns boolean language sql stable security definer
set search_path=pg_catalog,public
as $helper$
  select coalesce(p_total,0)>0
    and coalesce((
      select sum(t.amount)
      from public.transactions t
      where t.order_id=p_order_id
        and t.tenant_id=p_tenant_id
        and t.type='income'
        and t.payment_status='completed'
    ),0)+0.0049 >= p_total
$helper$;
revoke all on function public._opps106_ledger_covers_order(uuid,uuid,numeric)
  from PUBLIC,anon,authenticated;

do $upgrade$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='enforce_workspace_order_update_scope';
  if v_def is null then raise exception 'Missing order update scope guard'; end if;
  if position('_order_ledger_fully_covers_total' in v_def)>0 then return; end if;
  if position('_opps106_ledger_covers_order' in v_def)>0 then return; end if;
  if position('if public.has_tenant_permission(old.tenant_id,''production.update'') then' in v_def)=0
     or position('if public.has_tenant_permission(old.tenant_id,''orders.write'') then' in v_def)=0 then
    raise exception 'OPPS106_GUARD_DRIFT: review current production guard';
  end if;
  execute $replacement$
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

  -- OPPS-106: finance-only paid projection is permissible only when the
  -- same-tenant completed Finance ledger covers the positive order total.
  if old.payment_status = 'pending'
     and new.payment_status = 'paid'
     and (to_jsonb(new) - 'payment_status' - 'updated_at')
         = (to_jsonb(old) - 'payment_status' - 'updated_at')
     and public.has_tenant_permission(old.tenant_id,'finance.write')
     and public._opps106_ledger_covers_order(old.id,old.tenant_id,old.total_amount)
  then
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

  $replacement$;
end
$upgrade$;
