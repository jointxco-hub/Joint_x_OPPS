# XOS 2.5 — Request Visibility Fix (Decision 1)

## Root cause

`create_xos_request_for_host` tries to match the requester's authenticated
email to a `public.clients` row under the resolved tenant. If no match is
found it inserts the request anyway with `client_id = NULL` (a deliberate
soft-fail — request creation must never block on identity matching).

`get_internal_client_requests` (the RPC the OPPS ClientRequests page calls)
authorized purely via:

```sql
join public.clients client on client.id = request.client_id
where client.tenant_id in (select public.current_user_tenant_ids());
```

An `INNER JOIN` on a `NULL` `client_id` never matches, so any such request
was silently excluded from OPPS — forever, regardless of tenant. Confirmed
live on 2026-08-17/18 with a real test request, and confirmed historical:
a request from 2026-06-27 (`EMO-XOS browser request test`, id
`d62edd2e-c92f-4682-b2d6-f0d6b14b2916`) has had this exact problem the
whole time.

## Fix

Migration: `supabase/migrations/20260818090001_xos_request_visibility_tenant_scope.sql`

`get_internal_client_requests_unscoped` gains a `tenant_id` output column,
populated per union branch:

| Source table | Has own `tenant_id`? | Derivation used |
|---|---|---|
| `client_quote_requests` | yes | `coalesce(q.tenant_id, c.tenant_id)` |
| `client_messages` | yes | `coalesce(m.tenant_id, c.tenant_id)` |
| `client_profile_requests` | yes | `coalesce(p.tenant_id, c.tenant_id)` |
| `client_products` | yes | `coalesce(cp.tenant_id, c.tenant_id)` |
| `client_tech_packs` | no | `c.tenant_id` |
| `client_special_instructions` | no | `c.tenant_id` |
| `client_approvals` | no | `c.tenant_id` |
| `client_contract_acceptances` | no | `c.tenant_id` |

The `coalesce(..., c.tenant_id)` fallback on the four tables that *do* have
their own column was added after live validation caught a legacy
`client_messages` row (id `3d4f51d8-219e-4562-bcf1-f7a142570ecd`, from
today) whose native `tenant_id` is `NULL` despite having a `client_id` —
without the fallback that row would have flipped from visible-today to
invisible-after-the-fix, a regression. With the fallback it resolves
correctly via its linked client.

`get_internal_client_requests` then authorizes on:

```sql
where request.tenant_id in (select public.current_user_tenant_ids());
```

instead of the client join. `client_id`/`client_name`/`client_email`
remain in the output as optional display metadata only — they no longer
gate visibility. The frontend (`src/pages/ClientRequests.jsx`) was
inspected before writing this fix and already handles all three as
optional (`request.client_name || request.client_email || "Unknown
client"`, `request.client_id || "Not linked"` in the detail dialog) — no
frontend change was needed or made.

## Previous definitions (for rollback reference)

<details>
<summary><code>get_internal_client_requests_unscoped</code> — before this migration</summary>

```sql
CREATE OR REPLACE FUNCTION public.get_internal_client_requests_unscoped(p_type text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_source_app text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, request_type text, status text, client_id uuid, client_email text, client_name text, source_app text, created_at timestamp with time zone, preview text, payload jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  clean_type text := nullif(lower(trim(coalesce(p_type, ''))), '');
  clean_status text := nullif(lower(trim(coalesce(p_status, ''))), '');
  clean_source text := nullif(lower(trim(coalesce(p_source_app, ''))), '');
  clean_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  safe_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to view client requests.';
  end if;

  return query
  with normalized as (
    select
      q.id,
      case
        when lower(coalesce(q.project_name, '')) like 'reorder %'
          or lower(coalesce(q.details, '')) like 'reorder request%'
          then 'reorder_request'
        else 'quote_request'
      end::text as request_type,
      coalesce(q.status, 'new')::text as status,
      q.client_id,
      q.client_email,
      coalesce(q.client_name, c.name)::text as client_name,
      coalesce(q.source_app, 'xlab')::text as source_app,
      q.created_at,
      left(coalesce(q.project_name, q.details, 'Quote request'), 240)::text as preview,
      jsonb_build_object(
        'project_name', q.project_name,
        'quantity', q.quantity,
        'deadline', q.deadline,
        'details', q.details,
        'updated_at', q.updated_at
      ) as payload
    from public.client_quote_requests q
    left join public.clients c on c.id = q.client_id
    where coalesce(q.status, 'new') <> 'draft'
    union all
    select
      m.id, 'message'::text, coalesce(m.status, 'new')::text, m.client_id, m.client_email, c.name::text,
      coalesce(m.source_app, 'xlab')::text, m.created_at,
      left(coalesce(m.subject, m.message, 'Client message'), 240)::text,
      jsonb_build_object('subject', m.subject, 'message', m.message, 'sender_type', m.sender_type, 'is_internal', m.is_internal, 'order_id', m.order_id, 'xlab_order_id', m.xlab_order_id)
    from public.client_messages m
    left join public.clients c on c.id = m.client_id
    where coalesce(m.is_internal, false) = false
    union all
    select
      p.id, 'profile_update'::text, coalesce(p.status, 'pending_review')::text, p.client_id, p.client_email,
      coalesce(p.name, c.name)::text, coalesce(p.source_app, 'xlab')::text, p.created_at,
      left(concat_ws(' ', p.name, p.company_name, p.brand_name, p.phone), 240)::text,
      jsonb_build_object('name', p.name, 'phone', p.phone, 'company_name', p.company_name, 'brand_name', p.brand_name, 'delivery_address', p.delivery_address)
    from public.client_profile_requests p
    left join public.clients c on c.id = p.client_id
    union all
    select
      tp.id, 'tech_pack'::text, coalesce(tp.status, 'draft')::text, tp.client_id, c.email::text, c.name::text,
      coalesce(tp.source_app, 'xlab')::text, tp.created_at, left(coalesce(tp.title, 'Brand Setup'), 240)::text,
      jsonb_build_object('title', tp.title, 'tech_pack_type', tp.tech_pack_type, 'template_name', t.name, 'specs', tp.specs, 'approved_version_id', tp.approved_version_id, 'updated_at', tp.updated_at)
    from public.client_tech_packs tp
    left join public.clients c on c.id = tp.client_id
    left join public.client_tech_pack_templates t on t.id = tp.template_id
    union all
    select
      si.id, 'special_instruction'::text, coalesce(si.status, 'active')::text, si.client_id, c.email::text, c.name::text,
      'xlab'::text, si.created_at, left(coalesce(si.title, si.instruction, 'Special instruction'), 240)::text,
      jsonb_build_object('title', si.title, 'instruction', si.instruction, 'instruction_type', si.instruction_type, 'visibility', si.visibility, 'requires_approval', si.requires_approval, 'approved_by_client', si.approved_by_client, 'approved_at', si.approved_at, 'updated_at', si.updated_at)
    from public.client_special_instructions si
    left join public.clients c on c.id = si.client_id
    union all
    select
      a.id,
      case when a.related_table = 'client_products' and a.status = 'approved' then 'client_product_approved'
           when a.related_table = 'client_products' and a.status = 'rejected' then 'client_product_changes_requested'
           else 'approval' end::text,
      coalesce(a.status, 'pending')::text, a.client_id, c.email::text, c.name::text, 'xlab'::text, a.created_at,
      case when a.related_table = 'client_products' then left(coalesce(cp.client_facing_name, 'Client product') || case when a.status = 'rejected' then ' — changes requested' else ' — concept approved' end, 240)
           else left(coalesce(a.approval_type, 'Approval'), 240) end::text,
      case when a.related_table = 'client_products' then jsonb_build_object('approval_type', a.approval_type, 'related_table', a.related_table, 'related_id', a.related_id, 'client_product_id', cp.id, 'client_product_name', cp.client_facing_name, 'revision', a.revision, 'approved_by_name', a.approved_by_name, 'approved_by_email', a.approved_by_email, 'approved_at', a.approved_at, 'rejected_reason', a.rejected_reason)
           else jsonb_build_object('approval_type', a.approval_type, 'related_table', a.related_table, 'related_id', a.related_id, 'approved_by_name', a.approved_by_name, 'approved_by_email', a.approved_by_email, 'approved_at', a.approved_at, 'rejected_reason', a.rejected_reason) end
    from public.client_approvals a
    left join public.clients c on c.id = a.client_id
    left join public.client_products cp on cp.id = a.related_id and a.related_table = 'client_products'
    union all
    select
      ca.id, 'contract_acceptance'::text, 'accepted'::text, ca.client_id, ca.accepted_by_email,
      coalesce(ca.accepted_by_name, c.name)::text, 'xlab'::text, ca.accepted_at,
      left(coalesce(ct.name, 'Contract accepted'), 240)::text,
      jsonb_build_object('contract_name', ct.name, 'contract_type', ct.contract_type, 'version', ct.version, 'accepted_by_name', ca.accepted_by_name, 'accepted_by_email', ca.accepted_by_email, 'accepted_at', ca.accepted_at, 'acceptance_method', ca.acceptance_method, 'metadata', ca.metadata)
    from public.client_contract_acceptances ca
    left join public.client_contract_templates ct on ct.id = ca.contract_template_id
    left join public.clients c on c.id = ca.client_id
    union all
    select
      cp.id,
      case when cp.status = 'ready_for_client_review' then 'client_product_awaiting_client'
           when cp.status = 'client_approved' and cp.client_price is null then 'client_product_pricing_required'
           when cp.status = 'ready_to_order' then 'client_product_ready_to_order' end::text,
      case when cp.status = 'ready_to_order' then 'ready' else 'new' end::text,
      cp.client_id, c.email::text, c.name::text, 'xlab'::text, cp.updated_at,
      left(coalesce(cp.client_facing_name, 'Client product') || ' — ' || case when cp.status = 'ready_for_client_review' then 'awaiting client review' when cp.status = 'client_approved' then 'pricing required' when cp.status = 'ready_to_order' then 'ready to order' end, 240)::text,
      jsonb_build_object('client_product_id', cp.id, 'client_product_name', cp.client_facing_name, 'client_product_status', cp.status, 'revision', cp.revision, 'client_price', cp.client_price, 'visible_in_account', cp.visible_in_account, 'updated_at', cp.updated_at)
    from public.client_products cp
    left join public.clients c on c.id = cp.client_id
    where cp.status = 'ready_for_client_review' or cp.status = 'ready_to_order' or (cp.status = 'client_approved' and cp.client_price is null)
  )
  select n.*
  from normalized n
  where (clean_type is null or n.request_type = clean_type)
    and (clean_status is null or lower(n.status) = clean_status)
    and (clean_source is null or lower(n.source_app) = clean_source)
    and (clean_search is null or lower(coalesce(n.client_email, '')) like '%' || clean_search || '%' or lower(coalesce(n.client_name, '')) like '%' || clean_search || '%' or lower(coalesce(n.preview, '')) like '%' || clean_search || '%' or lower(n.payload::text) like '%' || clean_search || '%')
  order by n.created_at desc
  limit safe_limit;
end;
$function$
```
</details>

<details>
<summary><code>get_internal_client_requests</code> — before this migration</summary>

```sql
CREATE OR REPLACE FUNCTION public.get_internal_client_requests(p_type text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_source_app text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, request_type text, status text, client_id uuid, client_email text, client_name text, source_app text, created_at timestamp with time zone, preview text, payload jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_manage_internal_client_requests() then raise exception 'Not authorised to view client requests.'; end if;
  return query
  select request.*
  from public.get_internal_client_requests_unscoped(p_type, p_status, p_source_app, p_search, p_limit) request
  join public.clients client on client.id = request.client_id
  where client.tenant_id in (select public.current_user_tenant_ids());
end;
$function$
```
</details>

## Rollback

If this migration needs to be reverted, run `CREATE OR REPLACE FUNCTION`
with the two "previous definitions" blocks above, in either order (no
schema/table changes to undo — this migration only ever touched these two
function bodies).

## Grants verification

`CREATE OR REPLACE FUNCTION` preserves existing grants in Postgres — no
grant statements were needed or added. Confirmed both before and should be
re-confirmed after applying:

```sql
select p.proname, r.rolname, pr.privilege_type
from information_schema.routine_privileges pr
join pg_proc p on p.proname = pr.routine_name
join pg_roles r on r.rolname = pr.grantee
where pr.routine_schema = 'public'
  and p.proname in ('get_internal_client_requests', 'get_internal_client_requests_unscoped')
order by p.proname, r.rolname;
```

Expected (unchanged from before): `get_internal_client_requests` →
`authenticated`, `postgres`, `service_role`. `get_internal_client_requests_unscoped`
→ `postgres`, `service_role` only (never directly callable by end users).

## Validation performed (read-only, no writes, no function deployed yet)

Ran the proposed UNION/coalesce logic as a plain `SELECT` against the live
database (not the actual function — nothing was applied):

| Scenario | Result |
|---|---|
| A: the June 27 unlinked row (`d62edd2e...`) visible to a Demo XOS tenant member (`current_user_tenant_ids()` = Joint X + Demo XOS) | 1 match — visible ✅ |
| B: same row visible to a Tenant A QA–only staff member | 0 matches — correctly excluded ✅ |
| C/D: all 8 union branches resolve `tenant_id` for every row (18/18), including the legacy null-native-tenant_id `client_messages` row once the `coalesce(..., c.tenant_id)` fallback was added | 18/18 ✅ |

## Test matrix (from the task's Decision 1 spec)

| Test | Status | Evidence |
|---|---|---|
| Linked request still visible | ✅ | Unaffected — `tenant_id` present either natively or via unchanged client join; join was never the failure mode for linked rows |
| Unlinked request in staff's own tenant visible | ✅ | Validation scenario A |
| Unlinked request in another tenant not visible | ✅ | Validation scenario B |
| Authenticated outsider has no internal OPPS access | ✅ | Governed by `can_manage_internal_client_requests()`, untouched by this migration |
| XOS submission still succeeds | ✅ | `create_xos_request_for_host` not modified at all |
| OPPS ClientRequests shows newly created XOS request, no duplicates | ✅ (logical) | `LEFT JOIN … on c.id = request.client_id` is 1:1 by primary key — cannot fan out rows. No live re-test performed since the live "Test" canary from Part 1 was already deleted per instruction before this migration was written; the June 27 historical row stands in as the live proof of the unlinked-visibility path. |

No Docker/local Postgres was available in this environment for a fully
isolated instance (checked — Docker daemon not running here); the above is
read-only logic validation against the real database, not a deployed
function. **Not applied to production** — see the top-level report for
readiness status.
