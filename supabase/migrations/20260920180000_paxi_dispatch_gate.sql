-- Pep PAXI dispatch gate: an order using Pep PAXI as its courier must
-- not be moved to 'shipped' (or directly to 'delivered', which implies
-- shipped already happened - the QS "Correct to..." menu can jump
-- straight there, skipping 'shipped' entirely) while its PAXI code
-- (orders.pep_code) is empty.
--
-- ── Enforcement point ──────────────────────────────────────────────
-- There is no "advance order" RPC in this codebase (confirmed by
-- source audit): OrderDrawer.jsx's status <Select>, its "Next: {status}"
-- pills, the Quick Solution primary lifecycle button, and the Quick
-- Solution "Correct to..." menu all funnel through the exact same
-- generic path - dataClient.entities.Order.update -> checkedUpdate.js's
-- performCheckedUpdate -> a plain `supabase.from('orders').update(...)`.
-- A BEFORE UPDATE trigger is therefore the only point that covers every
-- UI path AND a direct PostgREST/API call alike, matching the existing
-- orders_production_readiness_gate trigger (20260914100000) this
-- migration is modelled on.
--
-- ── Scope ──────────────────────────────────────────────────────────
-- Only applies when fulfillment_type = 'courier' (default), so it never
-- touches collection orders - Quick Solution or otherwise. The shared
-- client-side gap check (shippingRequirements.js's
-- getCourierRequirementGap) already encodes this same "collection is
-- exempt" rule; this trigger is its authoritative server-side twin, not
-- a new client. Courier matching is normalized (case/whitespace/known
-- spelling variants) since orders.courier is a plain unconstrained text
-- column with no CHECK constraint - only PAXI-equivalent values are
-- special-cased, every other courier's behaviour is untouched.
--
-- ── Audit trail ────────────────────────────────────────────────────
-- A second, AFTER UPDATE trigger logs successful PAXI dispatches and
-- courier/pep_code edits to opps_activity_events, following the exact
-- insert shape used elsewhere (e.g. 202608220008's writeback, or
-- OrderDrawer.jsx's own logOrderCorrectionEvent). It only fires when
-- the change is PAXI-relevant (old or new courier is PAXI-equivalent),
-- to avoid adding unrelated audit noise for every other courier. It is
-- wrapped in its own exception handler - following the same
-- "never let secondary bookkeeping break the primary write" pattern
-- already used by mirror_opps_order_to_xlab_orders (20260913174927,
-- in the storefront repo) - so a logging failure (e.g. an update coming
-- from a context with no resolvable actor) can never block a
-- legitimate order update.
--
-- Blocked *attempts* are logged client-side instead (OrderDrawer.jsx),
-- because a BEFORE UPDATE trigger that raises an exception rolls back
-- everything in that same transaction, including any log row the same
-- trigger tried to insert first - there is no way to record a rejected
-- write from inside the trigger that rejected it.

begin;

create or replace function public._normalize_courier_code(p_courier text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_courier, ''))) in ('pep_paxi', 'paxi', 'pep paxi', 'pep-paxi', 'pep_ paxi', 'pep')
      then 'pep_paxi'
    else lower(trim(coalesce(p_courier, '')))
  end
$$;

comment on function public._normalize_courier_code(text) is
  'Maps known Pep PAXI spelling/casing variants to the canonical "pep_paxi" value used by DEFAULT_COURIERS in OrderDrawer.jsx. Every other courier value passes through as lower(trim(x)) unchanged.';

create or replace function public._enforce_order_paxi_dispatch_gate()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  -- Gate the transition INTO a dispatched-or-later state from a
  -- not-yet-dispatched one. IS DISTINCT FROM (rather than NOT IN, and
  -- rather than just "is distinct from 'shipped'" alone) also covers
  -- the QS "Correct to..." menu jumping straight to 'delivered', which
  -- implies dispatch already happened and must not skip the same
  -- check. NOT IN is unsafe here: under NULL three-valued logic,
  -- `NULL NOT IN ('shipped','delivered')` evaluates to NULL, which a
  -- plpgsql `if` treats as false — a NULL old.status (e.g. from data
  -- predating a status column default) would then silently skip this
  -- gate entirely. IS DISTINCT FROM treats NULL as an ordinary
  -- comparable value, so a NULL old.status is correctly treated as
  -- "not already shipped/delivered" and the gate still applies.
  if new.status in ('shipped', 'delivered')
     and old.status is distinct from 'shipped'
     and old.status is distinct from 'delivered'
     and coalesce(new.fulfillment_type, 'courier') = 'courier'
     and public._normalize_courier_code(new.courier) = 'pep_paxi'
     and coalesce(trim(new.pep_code), '') = ''
  then
    raise exception using errcode = 'P0001',
      message = 'PAXI_CODE_REQUIRED: this order is using Pep PAXI as the courier and cannot be marked as shipped/delivered until a PAXI code is captured. Add the PAXI code and try again.';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_paxi_dispatch_gate on public.orders;
create trigger orders_paxi_dispatch_gate
  before update on public.orders
  for each row
  execute function public._enforce_order_paxi_dispatch_gate();

create or replace function public._log_order_paxi_dispatch_activity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor text;
  v_was_paxi_courier boolean;
  v_is_paxi_courier boolean;
begin
  v_was_paxi_courier := coalesce(old.fulfillment_type, 'courier') = 'courier'
    and public._normalize_courier_code(old.courier) = 'pep_paxi';
  v_is_paxi_courier := coalesce(new.fulfillment_type, 'courier') = 'courier'
    and public._normalize_courier_code(new.courier) = 'pep_paxi';

  -- Only PAXI-relevant changes are logged here - see header comment.
  if not (v_is_paxi_courier or v_was_paxi_courier) then
    return new;
  end if;

  -- Same fallback chain as 202608220008_invoice_order_sync_atomic_writeback:
  -- auth.email() reads only the JWT email claim, which isn't guaranteed
  -- present on every session shape.
  v_actor := coalesce(auth.email(), (select u.user_email from public.users u where u.auth_user_id = auth.uid()));

  if new.status in ('shipped', 'delivered')
     and old.status is distinct from 'shipped'
     and old.status is distinct from 'delivered'
     and v_is_paxi_courier
  then
    insert into public.opps_activity_events (
      tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
    ) values (
      new.tenant_id, v_actor, v_actor, 'order_paxi_dispatched', 'order', new.id,
      format('%s marked %s as %s via Pep PAXI', coalesce(v_actor, 'Someone'), coalesce(new.order_number, new.id::text), new.status),
      jsonb_build_object('status', new.status, 'courier', new.courier, 'pep_code', new.pep_code)
    );
  end if;

  if new.pep_code is distinct from old.pep_code or new.courier is distinct from old.courier then
    insert into public.opps_activity_events (
      tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
    ) values (
      new.tenant_id, v_actor, v_actor, 'order_courier_details_updated', 'order', new.id,
      format('%s updated courier/PAXI details on %s', coalesce(v_actor, 'Someone'), coalesce(new.order_number, new.id::text)),
      jsonb_build_object(
        'courier_before', old.courier, 'courier_after', new.courier,
        'pep_code_before', old.pep_code, 'pep_code_after', new.pep_code
      )
    );
  end if;

  return new;
exception when others then
  raise warning 'order_paxi_dispatch_activity logging failed for order %: %', new.order_number, sqlerrm;
  return new;
end;
$$;

drop trigger if exists orders_paxi_dispatch_activity on public.orders;
create trigger orders_paxi_dispatch_activity
  after update on public.orders
  for each row
  execute function public._log_order_paxi_dispatch_activity();

commit;
