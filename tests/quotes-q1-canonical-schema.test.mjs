import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// QUOTES Q1 — migration contract guards. Behavioural proof lives in the
// disposable pg suite (supabase/tests/quotes_q1_canonical_schema.sql /
// supabase/tests/quotes_q1_run.sh). This pins the invariants that must never
// silently regress out of the migration file.

const MIG = "supabase/migrations/20260906090000_quotes_q1_canonical_schema.sql";
async function src() {
  return (await readFile(new URL(`../${MIG}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

test("four canonical tables + two numbering tables are created", async () => {
  const s = await src();
  for (const t of [
    "public.opps_quote_number_config",
    "public.opps_quote_number_sequences",
    "public.opps_quotes",
    "public.opps_quote_items",
    "public.opps_quote_revisions",
    "public.opps_quote_events",
  ]) {
    assert.ok(new RegExp(`create table if not exists ${t.replace(".", "\\.")} \\(`).test(s), `creates ${t}`);
  }
});

test("quote number: tenant/year scoped, per-tenant prefix, uuid identity, unique(tenant_id, quote_number)", async () => {
  const s = await src();
  assert.ok(/create table if not exists public\.opps_quote_number_sequences[\s\S]*?primary key \(tenant_id, year\)/.test(s),
    "sequence PK is (tenant_id, year), never a global counter");
  assert.ok(/prefix\s+text not null default 'QT'/.test(s), "default prefix QT, configurable per tenant");
  assert.ok(/constraint opps_quotes_tenant_number_key unique \(tenant_id, quote_number\)/.test(s),
    "quote_number unique WITHIN a tenant, not globally");
  assert.ok(/id\s+uuid primary key default gen_random_uuid\(\)/.test(s), "uuid is the true identity");
  const fn = s.match(/create or replace function public\._next_quote_number\(p_tenant_id uuid\)[\s\S]*?\$\$;/)[0];
  assert.ok(fn.includes("not public.can_access_tenant(p_tenant_id)") && fn.includes("QUOTE_NUMBER_TENANT_DENIED"),
    "allocator is tenant-gated");
  assert.ok(fn.includes("on conflict (tenant_id, year) do update") && fn.includes("last_number + 1"),
    "allocation bumps the (tenant, year) counter");
  assert.ok(fn.includes("v_prefix || '-' || v_year::text || '-' || lpad(v_next::text, v_pad, '0')"),
    "label = <prefix>-<year>-<zero-padded n>  (e.g. QT-2026-000001)");
  assert.ok(!/'joint-x'|'Joint X'|jointx/i.test(fn), "no Joint X hardcoded into the quote-number domain");
});

test("no invoice schema / status / payment surface is touched", async () => {
  const s = await src();
  // executable SQL only — the header comment cites invoice_payments as the
  // RLS-pattern provenance, which is documentation, not a dependency.
  const code = s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  assert.ok(!/alter table public\.opps_invoices/.test(code), "opps_invoices is never altered");
  assert.ok(!/alter table public\.opps_invoice_items/.test(code), "opps_invoice_items is never altered");
  assert.ok(!/\binvoice_payments\b|apply_invoice_payfast_payment|reconcile_invoice_with_order/.test(code),
    "no invoice payment / reconciliation object is referenced in executable SQL");
  assert.ok(!/status in \([^)]*'quote'/.test(s), "no 'quote' value added to any invoice status check");
  // converted_invoice_id FK to opps_invoices is a read-only forward link, not a schema change
  assert.ok(/converted_invoice_id\s+uuid references public\.opps_invoices\(id\) on delete set null/.test(s),
    "the only opps_invoices reference is an ON DELETE SET NULL forward link");
});

test("quote status enum is exactly the eight lifecycle values", async () => {
  const s = await src();
  const check = s.match(/status\s+text not null default 'draft'\s*\n\s*check \(status in \(([\s\S]*?)\)\)/)[1];
  const got = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(got, [
    "accepted", "changes_requested", "converted", "declined", "draft", "expired", "sent", "viewed",
  ]);
});

test("RLS mirrors invoice_payments discipline on every quote table", async () => {
  const s = await src();
  assert.ok(/foreach t in array array\[[\s\S]*?'opps_quotes',[\s\S]*?'opps_quote_events'[\s\S]*?\]/.test(s),
    "every quote table goes through the RLS loop");
  assert.ok(/create policy xos1_require_opps_staff on public\.%I\s*\n\s*as restrictive for all to authenticated\s*\n\s*using \(public\.is_opps_staff\(\)\) with check \(public\.is_opps_staff\(\)\)/.test(s),
    "restrictive is_opps_staff() policy, verbatim from invoice_payments");
  assert.ok(/using \(\(public\.is_app_admin\(\) or public\.user_finance_level\(\) in \(1, 2\)\) and public\.can_access_tenant\(tenant_id\)\)/.test(s),
    "permissive finance/admin + tenant policy, verbatim");
  assert.ok(/revoke all on public\.%I from anon, authenticated/.test(s), "tables start closed");
  assert.ok(/revoke all on public\.opps_quotes\s+from anon/.test(s), "anon explicitly stripped from opps_quotes");
});

test("revisions + events are append-only: no UPDATE/DELETE grant, immutability trigger", async () => {
  const s = await src();
  assert.ok(/grant select, insert on public\.opps_quote_revisions to authenticated;/.test(s),
    "opps_quote_revisions: SELECT + INSERT only (no UPDATE, no DELETE)");
  assert.ok(/grant select, insert on public\.opps_quote_events\s+to authenticated;/.test(s),
    "opps_quote_events: SELECT + INSERT only");
  assert.ok(!/grant[^;]*update[^;]*on public\.opps_quote_revisions/.test(s), "never grants UPDATE on revisions");
  assert.ok(!/grant[^;]*delete[^;]*on public\.opps_quote_revisions/.test(s), "never grants DELETE on revisions");
  const trg = s.match(/function public\._opps_quote_revision_immutable\(\)[\s\S]*?\$\$;/)[0];
  assert.ok(trg.includes("tg_op = 'UPDATE'") && trg.includes("QUOTE_REVISION_IMMUTABLE"), "UPDATE always refused");
  assert.ok(trg.includes("exists (select 1 from public.opps_quotes q where q.id = old.quote_id)"),
    "DELETE refused unless it is a cascade from the parent quote");
  assert.ok(/before update or delete on public\.opps_quote_revisions\s*\n\s*for each row execute function public\._opps_quote_revision_immutable/.test(s),
    "trigger armed for UPDATE and DELETE");
});

test("circular FK is resolved by DDL order (columns first, ALTER ADD CONSTRAINT after the revisions table)", async () => {
  const s = await src();
  const headerIdx = s.indexOf("create table if not exists public.opps_quotes (");
  const revisionsIdx = s.indexOf("create table if not exists public.opps_quote_revisions (");
  const fkIdx = s.indexOf("add constraint opps_quotes_current_revision_fk");
  assert.ok(headerIdx > -1 && revisionsIdx > headerIdx && fkIdx > revisionsIdx,
    "order is: opps_quotes -> opps_quote_revisions -> ALTER opps_quotes ADD FK");
  const headerBlock = s.slice(headerIdx, revisionsIdx);
  assert.ok(/current_revision_id\s+uuid,/.test(headerBlock) && /accepted_revision_id\s+uuid,/.test(headerBlock),
    "revision pointer columns declared as plain uuid in the header (no inline FK / forward reference)");
  assert.ok(/add constraint opps_quotes_accepted_revision_fk\s*\n\s*foreign key \(accepted_revision_id\) references public\.opps_quote_revisions\(id\) on delete set null/.test(s));
});

test("save_opps_quote_with_items: staff+tenant gate, optimistic lock, count guard, numeric + R0.02 validation", async () => {
  const s = await src();
  const fn = s.match(/create or replace function public\.save_opps_quote_with_items\([\s\S]*?\n\$\$;/)[0];
  assert.ok(/p_tenant_id\s+uuid,\s*\n\s*p_quote_id\s+uuid,\s*\n\s*p_quote\s+jsonb,\s*\n\s*p_items\s+jsonb,\s*\n\s*p_expected_updated_at\s+timestamptz default null,\s*\n\s*p_expected_item_count\s+integer default null,\s*\n\s*p_allow_total_override\s+boolean default false/.test(fn),
    "7-arg signature matches save_opps_invoice_with_items");
  assert.ok(fn.includes("v_user_id is null") && fn.includes("QUOTE_AUTH_REQUIRED"), "auth-gated");
  assert.ok(fn.includes("not public.can_access_tenant(p_tenant_id)") &&
            fn.includes("public.is_app_admin() or public.user_finance_level() in (1, 2)") &&
            fn.includes("QUOTE_ACCESS_DENIED"), "tenant + finance/admin gate");
  assert.ok(fn.includes("QUOTE_EMPTY_ITEMS_BLOCKED"), "empty item list refused");
  assert.ok(fn.includes("QUOTE_ITEM_INVALID_VALUES") &&
            fn.includes("when invalid_text_representation or numeric_value_out_of_range then"),
    "non-numeric / bad quantity/rate/discount refused with a clean error");
  assert.ok(fn.includes("abs(v_computed_total - v_stated_total) > 0.02") && fn.includes("QUOTE_TOTAL_MISMATCH"),
    "total invariant is +/- R0.02");
  assert.ok(fn.includes("QUOTE_TOTAL_OVERRIDE_REASON_REQUIRED"), "override needs a reason");
  assert.ok(fn.includes("v_existing.updated_at is distinct from p_expected_updated_at") && fn.includes("QUOTE_STALE_VERSION"),
    "optimistic lock on updated_at");
  assert.ok(fn.includes("p_expected_item_count is null or p_expected_item_count <> v_existing_count") &&
            fn.includes("QUOTE_ITEM_COUNT_CHANGED"), "expected-item-count guard");
  assert.ok(fn.includes("v_existing.status in ('accepted', 'converted', 'declined')") && fn.includes("QUOTE_NOT_EDITABLE"),
    "accepted / converted / declined quotes cannot be silently edited");
});

test("save_opps_quote_with_items: appends a NEW immutable revision, repoints current, never touches accepted", async () => {
  const s = await src();
  const fn = s.match(/create or replace function public\.save_opps_quote_with_items\([\s\S]*?\n\$\$;/)[0];
  assert.ok(fn.includes("select coalesce(max(revision_number), 0) + 1"), "revision_number = max + 1");
  assert.ok(fn.includes("insert into public.opps_quote_revisions (quote_id, tenant_id, revision_number, snapshot, totals, created_by)"),
    "inserts a fresh revision row every save");
  assert.ok(fn.includes("set current_revision_id = v_new_revision_id"), "repoints current_revision_id");
  assert.ok(!/set[\s\S]{0,400}accepted_revision_id\s*=/.test(fn), "never assigns accepted_revision_id");
  assert.ok(fn.includes("-- status, accepted_revision_id, accepted_* : deliberately untouched"),
    "update path documents it leaves status + acceptance columns alone");
  assert.ok(!/update public\.opps_quote_revisions/.test(fn), "never updates a prior revision");
});

test("projection + price-breakdown are internal-only and leak no cost/margin/tenant/notes", async () => {
  const s = await src();
  for (const fn of ["_quote_document_projection(uuid)", "_quote_item_price_breakdown(jsonb)"]) {
    assert.ok(s.includes(`revoke all on function public.${fn} from public, anon, authenticated;`),
      `${fn} is fully internal (no client execute)`);
  }
  const proj = s.match(/create or replace function public\._quote_document_projection[\s\S]*?\$\$;/)[0];
  for (const leak of ["tenant_id", "customer_id", "customer_email", "customer_phone",
                      "'notes'", "source_client_product_id", "source_metadata",
                      "created_by", "updated_by", "source_request_id", "converted_order_id",
                      "converted_invoice_id", "share_token", "total_override"]) {
    assert.ok(!proj.includes(leak), `_quote_document_projection never surfaces ${leak}`);
  }
  assert.ok(proj.includes("coalesce(v_quote.accepted_revision_id, v_quote.current_revision_id)"),
    "projects the accepted revision when present, else the current one");
  const pb = s.match(/create or replace function public\._quote_item_price_breakdown[\s\S]*?\$\$;/)[0];
  assert.ok(!/cost|margin|supplier|procurement|component_id|unit_cost/i.test(pb.replace(/--.*$/gm, "")),
    "price-breakdown projector references no cost/margin/supplier/procurement/component field");
  assert.ok(pb.includes("coalesce(v_pb ->> 'mode', '') <> 'composed'") && pb.includes("'per_unit'"),
    "only customer-safe composed per_unit rows (label/role/amount/method/placement) are surfaced");
  assert.ok(s.includes("'price_breakdown', public._quote_item_price_breakdown(qi.source_metadata)"),
    "the revision snapshot stores only the projected breakdown, never raw source_metadata");
  assert.ok(!/'source_metadata',/.test(s.match(/select jsonb_build_object\([\s\S]*?into v_snapshot;/)[0]),
    "raw source_metadata is never written into a snapshot");
});

test("child tenant_id is forced from the parent quote, never trusted from input", async () => {
  const s = await src();
  const trg = s.match(/function public\._opps_quote_child_set_tenant\(\)[\s\S]*?\$\$;/)[0];
  assert.ok(trg.includes("select tenant_id into v_tenant from public.opps_quotes where id = new.quote_id") &&
            trg.includes("new.tenant_id := v_tenant"), "trigger overwrites tenant_id from opps_quotes");
  for (const t of ["opps_quote_items", "opps_quote_revisions", "opps_quote_events"]) {
    assert.ok(new RegExp(`before insert or update on public\\.${t}\\s*\\n\\s*for each row execute function public\\._opps_quote_child_set_tenant`).test(s),
      `${t} has the tenant-forcing trigger`);
  }
});
