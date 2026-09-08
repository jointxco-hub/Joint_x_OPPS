import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}
const MIG = "supabase/migrations/20260906120000_quotes_q3_public_route.sql";

test("no new share schema — Q1's four opps_quotes share columns are reused", async () => {
  const s = await src(MIG);
  assert.ok(!/alter table public\.opps_quotes\s+add column/i.test(s), "Q3 adds no columns to opps_quotes");
  const q1 = await src("supabase/migrations/20260906090000_quotes_q1_canonical_schema.sql");
  for (const col of ["share_token", "share_expires_at", "public_visible", "share_revoked_at"]) {
    assert.ok(q1.includes(col), `Q1 already owns opps_quotes.${col}`);
  }
});

test("staff share controls are staff-only; anon revoked", async () => {
  const s = await src(MIG);
  for (const fn of ["issue_quote(uuid, timestamptz)", "revoke_quote_share(uuid)", "rotate_quote_share_token(uuid)"]) {
    assert.ok(s.includes(`revoke all on function public.${fn} from public, anon;`), `${fn} revoked from anon`);
    assert.ok(s.includes(`grant execute on function public.${fn} to authenticated;`), `${fn} -> authenticated only`);
  }
  const guard = s.match(/create or replace function public\._quote_staff_guard[\s\S]*?\$\$;/)[0];
  assert.ok(guard.includes("auth.uid() is null") && guard.includes("QUOTE_AUTH_REQUIRED"));
  assert.ok(guard.includes("can_access_tenant(v_quote.tenant_id)") &&
            guard.includes("is_app_admin() or public.user_finance_level() in (1, 2)") &&
            guard.includes("QUOTE_ACCESS_DENIED"));
  assert.ok(s.includes("revoke all on function public._quote_staff_guard(uuid, boolean) from public, anon, authenticated;"),
    "the guard helper is internal-only");
});

test("issue_quote requires a formal offer (published_revision_id), never advances status", async () => {
  const s = await src(MIG);
  const fn = s.match(/create or replace function public\.issue_quote[\s\S]*?\$\$;/)[0];
  assert.ok(fn.includes("v_quote.published_revision_id is null") && fn.includes("QUOTE_NOT_PUBLISHED"));
  assert.ok(!/set status/i.test(fn), "issue_quote never writes status (quote semantics, unlike issue_invoice)");
  assert.ok(fn.includes("'share_issued', 'staff'"), "logs a share_issued event");
});

test("_public_quote_projection: from accepted ?? published revision SNAPSHOT, returns null with no offer, leaks nothing internal", async () => {
  const s = await src(MIG);
  assert.ok(s.includes("revoke all on function public._public_quote_projection(uuid) from public, anon, authenticated;"),
    "internal-only");
  const fn = s.match(/create or replace function public\._public_quote_projection[\s\S]*?\$\$;/)[0];
  assert.ok(fn.includes("coalesce(v_quote.accepted_revision_id, v_quote.published_revision_id)"),
    "source of truth = accepted ?? published (NEVER current_revision_id)");
  assert.ok(!fn.includes("current_revision_id"), "current_revision_id is never read");
  assert.ok(/if v_rev_id is null then\s*\n\s*return null;/.test(fn), "no offer -> null");
  // every commercial field comes from the snapshot, not the mutable row
  assert.ok(fn.includes("'valid_until',              nullif(v_snap ->> 'valid_until', '')"), "valid_until from snapshot, not v_quote");
  assert.ok(!/'valid_until',\s*v_quote\./.test(fn), "valid_until never from the mutable opps_quotes row");
  for (const k of ["'payment_terms',", "'reference_number',", "'terms',", "'customer_name',",
                   "'shipping_address',", "'subtotal',", "'total',"]) {
    assert.ok(fn.includes(`${k}`) && fn.slice(fn.indexOf(k)).slice(0, 60).includes("v_snap"), `${k} sourced from snapshot`);
  }
  // never emits internal keys
  for (const leak of ["'id',", "'tenant_id',", "'customer_email',", "'customer_phone',", "'customer_id',",
                      "'notes',", "'share_token',", "'total_override", "'source_metadata',", "'created_by',",
                      "'current_revision_id',", "'published_revision_id',"]) {
    assert.ok(!fn.includes(leak), `_public_quote_projection emits ${leak}`);
  }
});

test("get_public_quote: anon, token-only, enumeration-safe (identical null for every miss)", async () => {
  const s = await src(MIG);
  assert.ok(s.includes("grant execute on function public.get_public_quote(text) to anon, authenticated;"));
  const fn = s.match(/create or replace function public\.get_public_quote\(p_token text\)[\s\S]*?\$\$;/)[0];
  const sig = fn.match(/function public\.get_public_quote\(([^)]*)\)/)[1].trim();
  assert.equal(sig, "p_token text", "only a token — no quote_id / tenant param");
  for (const g of ["public_visible is not true", "share_revoked_at is not null",
                   "share_expires_at is not null and v_quote.share_expires_at < now()",
                   "published_revision_id is null", "status = 'draft'"]) {
    assert.ok(fn.includes(g), `guard: ${g}`);
  }
  const returns = [...fn.matchAll(/return (null|public\._public_quote_projection)/g)].map((m) => m[1]);
  assert.ok(returns.filter((r) => r === "null").length >= 6, "every failure path returns a bare null");
});

test("public actions are token-scoped, anon, fail-closed on a stale published revision", async () => {
  const s = await src(MIG);
  for (const fn of ["accept_public_quote(text, integer, text, text, text)",
                    "request_quote_changes(text, integer, text, text, text)",
                    "decline_public_quote(text, integer, text, text, text)"]) {
    assert.ok(s.includes(`revoke all on function public.${fn} from public;`), `${fn} revoked from public`);
    assert.ok(s.includes(`grant execute on function public.${fn} to anon, authenticated;`), `${fn} -> anon`);
  }
  // no quote_id / tenant param on any of them
  for (const name of ["accept_public_quote", "request_quote_changes", "decline_public_quote"]) {
    const sig = s.match(new RegExp(`function public\\.${name}\\(([\\s\\S]*?)\\)\\s*\\n?returns`))[1];
    assert.ok(/^\s*p_token\s+text/.test(sig) && !/quote_id|tenant/.test(sig), `${name} takes a token, not an id`);
    assert.ok(/p_expected_revision_number\s+integer/.test(sig), `${name} takes the expected published revision NUMBER (not the internal uuid)`);
    assert.ok(!/uuid/.test(sig), `${name} signature exposes no uuid to the caller`);
  }
  const accept = s.match(/create or replace function public\.accept_public_quote[\s\S]*?\$\$;/)[0];
  assert.ok(accept.includes("p_expected_revision_number is distinct from public._published_revision_number(v_quote)") &&
            accept.includes("QUOTE_PUBLISHED_REVISION_CHANGED"), "accept: stale published revision-number -> fail closed");
  assert.ok(accept.includes("accepted_revision_id  = published_revision_id"), "accept pins to published, never current");
  assert.ok(accept.includes("NEVER current_revision_id"), "documented");
  assert.ok(accept.includes("v_quote.status not in ('sent', 'viewed', 'changes_requested')") &&
            accept.includes("QUOTE_NOT_ACCEPTABLE"));
  assert.ok(accept.includes("QUOTE_ACK_NAME_REQUIRED"), "typed name required");
  assert.ok(accept.includes("_public_quote_by_token_for_update"), "resolves + locks by token under the same validity checks");
});

test("request_quote_changes: no price/total/revision mutation; decline: history + share preserved", async () => {
  const s = await src(MIG);
  const rc = s.match(/create or replace function public\.request_quote_changes[\s\S]*?\$\$;/)[0];
  assert.ok(rc.includes("set status = 'changes_requested'"));
  assert.ok(!/published_revision_id\s*=|current_revision_id\s*=|total\s*=|subtotal\s*=/.test(rc),
    "request_quote_changes touches no revision pointer or money");
  assert.ok(rc.includes("left(btrim(coalesce(p_message, '')), 4000)"), "customer message is length-capped");
  const dec = s.match(/create or replace function public\.decline_public_quote[\s\S]*?\$\$;/)[0];
  assert.ok(dec.includes("set status = 'declined'"));
  assert.ok(!/share_token\s*=|share_revoked_at\s*=|delete from public\.opps_quote_revisions/.test(dec),
    "decline preserves the share token and every revision");
});

test("ip_hash is privacy-safe (sha256 of ip + rotating salt), never a raw IP; internal-only", async () => {
  const s = await src(MIG);
  const fn = s.match(/create or replace function public\._request_ip_hash[\s\S]*?\$\$;/)[0];
  assert.ok(fn.includes("extensions.digest(v_ip || ':' || to_char(now(), 'YYYY-MM-DD'), 'sha256')"),
    "sha256(ip + date-rotating salt)");
  assert.ok(fn.includes("if v_ip = '' then return null"), "no header -> null, never a placeholder");
  assert.ok(s.includes("revoke all on function public._request_ip_hash() from public, anon, authenticated;"));
  // events store ip_hash / user_agent columns from Q1, never a raw ip
  assert.ok(!/x-real-ip|remote_addr|inet_client_addr/i.test(s), "no raw client IP is ever read/stored");
});

test("no invoice payment / status / balance concepts leak into quote actions", async () => {
  const s = (await src(MIG)).split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  assert.ok(!/invoice_payments|apply_invoice|balance_due|amount_paid|payment_status|mark.*paid|issue_invoice|get_public_invoice/i.test(s),
    "Q3 reuses no invoice payment/lifecycle object");
});

// ── customer change-request message / decline reason: persist → project → render ──

test("persistence: request_quote_changes & decline_public_quote store the customer text on opps_quote_events.note", async () => {
  const s = await src(MIG);
  for (const [name, arg] of [["request_quote_changes", "p_message"], ["decline_public_quote", "p_reason"]]) {
    const fn = s.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`))[0];
    // the free-text arg is written to the event's note column, trimmed + capped, empty -> NULL
    assert.ok(
      fn.includes("insert into public.opps_quote_events") && /\bnote\b/.test(fn),
      `${name} inserts a quote event with a note`,
    );
    assert.ok(
      fn.includes(`nullif(left(btrim(coalesce(${arg}, '')), 4000), '')`),
      `${name} stores ${arg} verbatim (trimmed, 4000-capped, '' -> NULL) — no fabrication, no drop`,
    );
    // the event is attributed to the public link + the published revision the customer saw
    assert.ok(/'(changes_requested|declined)', 'public_link'/.test(fn), `${name} event is actor_kind public_link`);
    assert.ok(/revision_id[\s\S]*published_revision_id|published_revision_id, '(changes_requested|declined)'/.test(fn),
      `${name} pins the event to published_revision_id`);
  }
  // the multi-line / cap / spaces-only behaviour is proven end-to-end in
  // supabase/tests/quotes_q3_public_route.sql scenario 7b.
  const sqlSuite = await src("supabase/tests/quotes_q3_public_route.sql");
  assert.ok(sqlSuite.includes("PASS 7b: message persistence"), "SQL suite covers multi-line verbatim + 4000 cap");
});

test("staff projection: listQuoteEvents returns note + actor + timestamp for the drawer", async () => {
  const api = await src("src/api/quotes.js");
  const fn = api.match(/export async function listQuoteEvents[\s\S]*?\n}/)[0];
  for (const col of ["note", "actor_kind", "actor_label", "event_type", "revision_id", "metadata", "created_at"]) {
    assert.ok(new RegExp(`\\b${col}\\b`).test(fn), `listQuoteEvents selects ${col}`);
  }
  assert.ok(fn.includes('.eq("tenant_id", tenantId)'), "still tenant-scoped");
});

test("rendering: QuoteDetailDrawer Activity shows the full note (line breaks kept), customer vs internal distinguished", async () => {
  const d = await src("src/features/quotes/QuoteDetailDrawer.jsx");
  const activity = d.slice(d.indexOf('<Section title="Activity">'), d.indexOf("</Section>", d.indexOf('<Section title="Activity">')));
  // the note is actually rendered, with line breaks preserved
  assert.ok(/\{ev\.note\}/.test(activity), "the event note text is rendered");
  assert.ok(/whitespace-pre-wrap/.test(activity), "line breaks in the customer message are preserved");
  // a customer change-request / decline reason is visually distinguished from a plain note
  assert.ok(/actor_kind === "public_link"/.test(activity), "customer responses are detected by actor_kind");
  assert.ok(/"changes_requested"|"declined"/.test(activity), "the two customer-response event types are handled");
  assert.ok(/Message from customer|Decline reason from customer/.test(activity), "customer-facing note label");
  // actor + timestamp still shown on the header line
  assert.ok(/ev\.actor_label/.test(activity) && /when\(ev\.created_at\)/.test(activity), "actor + timestamp retained");
});

test("public quote pages never expose event notes / internal notes", async () => {
  // OPPS: the anon public projection is snapshot-only — it must not read opps_quote_events at all
  const proj = (await src(MIG)).match(/create or replace function public\._public_quote_projection[\s\S]*?\$\$;/)[0];
  assert.ok(!/opps_quote_events/.test(proj), "_public_quote_projection never touches the events table");
  assert.ok(!/'note'|v_quote\.notes|\bnote\b\s*,/.test(proj), "_public_quote_projection emits no note field");
  // X LAB: the public page's `note` is only the customer's own compose-box state, never a rendered server value
  const xlabDir = "../../xlab-q3-release";
  let page;
  try {
    page = (await readFile(new URL(`${xlabDir}/src/pages/PublicQuote.jsx`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  } catch {
    page = null; // X LAB worktree not present in this checkout — OPPS assertions above still hold
  }
  if (page) {
    assert.ok(/const \[note, setNote\] = useState\(''\)/.test(page), "`note` is local compose state");
    assert.ok(/message: note|reason: note/.test(page), "`note` flows OUT to the RPC only");
    assert.ok(!/quote\.note\b|quote\?\.note\b|events?\.map|event_type/.test(page), "no server-side event/note is ever rendered");
  }
});
