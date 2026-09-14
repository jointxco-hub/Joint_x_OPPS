import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  HAS_QUOTE_SEND_TRANSITION, SENDABLE_QUOTE_STATUSES,
  canSendQuote, hasUnsentChanges, isPublished,
} from "../src/features/quotes/quoteStatus.js";
import { buildQuoteDocumentModel, buildInvoiceDocumentModel } from "../src/features/commercial-doc/commercialDocumentModel.js";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}
const MIG = "supabase/migrations/20260906100000_quotes_q2_5_published_revision.sql";

// ── migration contract ─────────────────────────────────────────────────
test("migration adds published_revision_id: nullable, FK ON DELETE SET NULL, partial index, comment", async () => {
  const s = await src(MIG);
  assert.ok(/alter table public\.opps_quotes\s+add column if not exists published_revision_id uuid;/.test(s));
  assert.ok(/add constraint opps_quotes_published_revision_fk\s+foreign key \(published_revision_id\) references public\.opps_quote_revisions\(id\) on delete set null/.test(s));
  assert.ok(/create index if not exists idx_opps_quotes_published_revision\s+on public\.opps_quotes \(published_revision_id\)\s+where published_revision_id is not null/.test(s));
  assert.ok(/comment on column public\.opps_quotes\.published_revision_id is/.test(s));
  assert.ok(/only by public\.mark_quote_sent\(\)/i.test(s) && /NEVER changed by save_opps_quote_with_items/.test(s));
});

test("migration does NOT redefine save_opps_quote_with_items (its behaviour is unchanged)", async () => {
  const s = await src(MIG);
  assert.ok(!/create or replace function public\.save_opps_quote_with_items/.test(s),
    "Q2.5 must not touch the save function — it already cannot move published_revision_id");
});

test("backfill only touches customer-presented quotes, never drafts", async () => {
  const s = await src(MIG);
  const bf = s.match(/update public\.opps_quotes\s+set published_revision_id = current_revision_id[\s\S]*?;/)[0];
  assert.ok(bf.includes("status in ('sent', 'viewed', 'changes_requested')"));
  assert.ok(bf.includes("published_revision_id is null") && bf.includes("current_revision_id is not null"));
  assert.ok(!/'draft'/.test(bf), "draft quotes are never backfilled");
});

test("mark_quote_sent: SECURITY DEFINER, staff+tenant gated, status-gated, idempotent, event-logging", async () => {
  const s = await src(MIG);
  const fn = s.match(/create or replace function public\.mark_quote_sent\(p_quote_id uuid\)[\s\S]*?\n\$\$;/)[0];
  assert.ok(/security definer/.test(fn) && /set search_path = pg_catalog, public/.test(fn));
  assert.ok(fn.includes("v_user_id is null") && fn.includes("QUOTE_AUTH_REQUIRED"));
  assert.ok(fn.includes("select * into v_quote from public.opps_quotes where id = p_quote_id for update"));
  assert.ok(fn.includes("not public.can_access_tenant(v_quote.tenant_id)") &&
            fn.includes("public.is_app_admin() or public.user_finance_level() in (1, 2)") &&
            fn.includes("QUOTE_ACCESS_DENIED"));
  assert.ok(fn.includes("v_quote.current_revision_id is null") && fn.includes("QUOTE_NO_REVISION_TO_SEND"));
  assert.ok(fn.includes("v_quote.status not in ('draft', 'changes_requested', 'sent', 'viewed')") &&
            fn.includes("QUOTE_NOT_SENDABLE"));
  // idempotent branch
  assert.ok(fn.includes("v_quote.published_revision_id is not distinct from v_quote.current_revision_id") &&
            fn.includes("v_quote.status = 'sent'") && fn.includes("'no_change', true"));
  // publish
  assert.ok(fn.includes("set published_revision_id = current_revision_id") && fn.includes("status = 'sent'"));
  assert.ok(fn.includes("v_resend := v_quote.published_revision_id is not null"));
  // event
  assert.ok(/insert into public\.opps_quote_events \([\s\S]*?revision_id, event_type, actor_kind, actor_user_id, metadata[\s\S]*?'sent', 'staff', v_user_id,\s*jsonb_build_object\('resend', v_resend\)/.test(fn));
  // grants
  assert.ok(s.includes("revoke all on function public.mark_quote_sent(uuid) from public, anon;"));
  assert.ok(s.includes("grant execute on function public.mark_quote_sent(uuid) to authenticated;"));
});

test("no invoice / status / payment surface touched", async () => {
  const s = (await src(MIG)).split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  assert.ok(!/opps_invoices|invoice_payments|apply_invoice|status in \([^)]*'quote'/.test(s));
});

// ── quoteStatus helpers ────────────────────────────────────────────────
test("HAS_QUOTE_SEND_TRANSITION is true; canSendQuote respects status + a saved revision", () => {
  assert.equal(HAS_QUOTE_SEND_TRANSITION, true);
  assert.deepEqual([...SENDABLE_QUOTE_STATUSES].sort(), ["changes_requested", "draft", "sent", "viewed"]);
  assert.equal(canSendQuote({ status: "draft", current_revision_id: "r1" }), true);
  assert.equal(canSendQuote({ status: "draft", current_revision_id: null }), false, "no revision -> cannot send");
  assert.equal(canSendQuote({ status: "accepted", current_revision_id: "r1" }), false);
  assert.equal(canSendQuote({ status: "converted", current_revision_id: "r1" }), false);
  assert.equal(canSendQuote({ status: "declined", current_revision_id: "r1" }), false);
  assert.equal(canSendQuote({ status: "expired", current_revision_id: "r1" }), false);
});

test("hasUnsentChanges: current != published AND still customer-presented", () => {
  assert.equal(hasUnsentChanges({ status: "sent", current_revision_id: "r2", published_revision_id: "r1" }), true);
  assert.equal(hasUnsentChanges({ status: "viewed", current_revision_id: "r2", published_revision_id: "r1" }), true);
  assert.equal(hasUnsentChanges({ status: "changes_requested", current_revision_id: "r2", published_revision_id: "r1" }), true);
  assert.equal(hasUnsentChanges({ status: "sent", current_revision_id: "r1", published_revision_id: "r1" }), false, "current == published -> no unsent changes");
  assert.equal(hasUnsentChanges({ status: "draft", current_revision_id: "r2", published_revision_id: null }), false, "never sent -> no unsent changes");
  assert.equal(hasUnsentChanges({ status: "accepted", current_revision_id: "r2", published_revision_id: "r1" }), false, "terminal states are not 'unsent changes'");
  assert.equal(isPublished({ published_revision_id: "r1" }), true);
  assert.equal(isPublished({ published_revision_id: null }), false);
});

// ── API wiring ─────────────────────────────────────────────────────────
test("quotes.js: markQuoteSent hits mark_quote_sent RPC; getQuoteDocument gains a published/draft variant", async () => {
  const s = await src("src/api/quotes.js");
  assert.ok(s.includes('supabase.rpc("mark_quote_sent", { p_quote_id: quoteId })'), "markQuoteSent calls the RPC");
  assert.ok(s.includes("QUOTE_SEND_ERROR_MESSAGES") && s.includes("QUOTE_NOT_SENDABLE") && s.includes("QUOTE_NO_REVISION_TO_SEND"));
  // still the ONLY writes are canonical RPCs — no direct opps_quote* mutation.
  // Q1/Q2.5: save + send. Q3.1: the three public-share RPCs. Quote->Order
  // Phase 1: convert_quote_to_order.
  const rpcs = [...new Set((s.match(/supabase\.rpc\("[a-z_]+"/g) || []))].sort();
  assert.deepEqual(rpcs, [
    'supabase.rpc("convert_quote_to_order"',
    'supabase.rpc("issue_quote"',
    'supabase.rpc("mark_quote_sent"',
    'supabase.rpc("revoke_quote_share"',
    'supabase.rpc("rotate_quote_share_token"',
    'supabase.rpc("save_opps_quote_with_items"',
  ]);
  assert.ok(!/\.from\("opps_quote[s_a-z]*"\)\s*\.\s*(insert|update|delete|upsert)/.test(s), "no direct quote-table writes");
  // variant plumbing
  assert.ok(s.includes('getQuoteDocument(id, { variant = "published" }')  || s.includes('variant = "published"'));
  assert.ok(s.includes('variant === "draft"') && s.includes("quote.published_revision_id"));
  assert.ok(s.includes("published_revision_number") && s.includes("has_unsent_changes"), "list + detail expose published rev number + unsent flag");
});

// ── drawer UI ──────────────────────────────────────────────────────────
test("drawer: Send label switches Send quote / Resend updated quote; unsent pill; published chip; no invoice/accept actions", async () => {
  const raw = await src("src/features/quotes/QuoteDetailDrawer.jsx");
  const s = raw.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  assert.ok(s.includes('const sendLabel = published ? "Resend updated quote" : "Send quote";'));
  assert.ok(s.includes("canSendQuote(quote || header)") && s.includes("HAS_QUOTE_SEND_TRANSITION"));
  assert.ok(/showSend[\s\S]{0,120}\["draft", "changes_requested"\]\.includes\(status\) \|\| unsent/.test(s),
    "Send shows for draft/changes_requested, or whenever there are unsent changes");
  assert.ok(s.includes("hasUnsentChanges(quote || header)"), "drawer computes unsent state");
  assert.ok(/Unsent changes/.test(s), "unsent-changes pill text present");
  assert.ok(s.includes("publishedRevisionId={quote.published_revision_id}"), "published chip wired into revision history");
  assert.ok(s.includes("draftPreview={previewIsDraft}"), "draft preview flag passed to the renderer");
  assert.ok(s.includes('previewIsDraft ? "Draft preview" : "Published quote"'), "preview toggle labels");
  // NO invoice-only actions, NO customer acceptance actions
  assert.ok(!/onMarkPaid|markInvoiceExported|invoice_payments|apply_invoice_payfast|issue_invoice\(|rotate_invoice_share_token/.test(s));
  assert.ok(!/accept_public_quote|request_quote_changes|decline_public_quote|onAccept|onDecline|onRequestChanges/.test(s),
    "no client Accept / Request-changes / Decline in Q2.5");
});

test("revision history: distinct current / published / accepted chips", async () => {
  const s = await src("src/features/quotes/QuoteRevisionHistory.jsx");
  assert.ok(s.includes("publishedRevisionId"));
  assert.ok(s.includes("rev.id === publishedRevisionId") || s.includes("const isPublished = rev.id === publishedRevisionId"));
  assert.ok(/published · live offer/i.test(s), "published chip label");
  assert.ok(s.includes("current") && s.includes("accepted"), "still shows current + accepted chips");
});

test("list: small amber unsent-changes indicator, not a new column", async () => {
  const s = await src("src/features/quotes/QuoteList.jsx");
  assert.ok(s.includes("quote.has_unsent_changes"), "keys off the derived flag");
  assert.ok(/h-2 w-2 (shrink-0 )?rounded-full bg-amber-500/.test(s), "a dot, not a column");
});

// ── CommercialDocument draft banner + invoice parity ───────────────────
test("CommercialDocument: draft banner is quote-only, opt-in; invoice output byte-equivalent", async () => {
  const s = await src("src/features/commercial-doc/CommercialDocument.jsx");
  assert.ok(s.includes("draftPreview = false"), "banner is opt-in, default off");
  assert.ok(s.includes("const showDraftBanner = isQuote && draftPreview === true;"), "quote-only gate");
  assert.ok(s.includes("DRAFT — NOT FOR ACCEPTANCE"), "banner copy");
  assert.ok(s.includes('data-quote-draft-banner="true"'));
  // the banner block is only rendered behind showDraftBanner
  assert.ok(/\{showDraftBanner \?[\s\S]{0,400}data-quote-draft-banner/.test(s));
  // invoice model is untouched by Q2.5
  const inv = buildInvoiceDocumentModel(
    { invoice_number: "INV-1", status: "paid", total: 100, amount_paid: 100, balance_due: 0,
      items: [{ item_name: "x", quantity: 1, rate: 100, item_total: 100 }] },
    { audience: "customer" });
  assert.equal(inv.kind, "invoice");
  assert.equal(inv.totals.balanceDue, 0);
});

// ── FROZEN PUBLISHED DOCUMENT regression ───────────────────────────────
// Doc objects exactly as getQuoteDocument() now returns them: every
// commercial/customer field from the revision SNAPSHOT, only lifecycle
// metadata (id/status/created_date/revision_number/is_*/accepted_at) from
// the quote row.
const PUBLISHED_REV2_DOC = {
  // snapshot (rev 2, frozen)
  quote_number: "QT-2026-000002", currency_code: "ZAR",
  valid_until: "2026-10-06", payment_terms: "50% deposit to start",
  reference_number: "REF-2", terms: "Terms as at revision 2",
  customer_name: "Acme Streetwear", customer_billing_address: "1 Long St",
  shipping_address: "Unit 2, Old Rd",
  subtotal: 800, discount_total: 0, shipping_charge: 0, tax_total: 0, total: 800,
  items: [{ line_number: 1, role: "product", item_name: "Tee", quantity: 5, rate: 160, item_total: 800 }],
  // lifecycle metadata from the quote row
  id: "q1", status: "sent", created_date: "2026-09-06",
  revision_number: 2, is_accepted_revision: false, is_published_revision: true, is_draft_preview: false, accepted_at: null,
};
const DRAFT_REV3_DOC = {
  quote_number: "QT-2026-000002", currency_code: "ZAR",
  valid_until: "2026-10-22", payment_terms: "Net 30 days",
  reference_number: "REF-3", terms: "Terms as at revision 3",
  customer_name: "Acme Streetwear", customer_billing_address: "1 Long St",
  shipping_address: "Unit 9, New Rd",
  subtotal: 960, discount_total: 0, shipping_charge: 0, tax_total: 0, total: 960,
  items: [{ line_number: 1, role: "product", item_name: "Tee", quantity: 5, rate: 192, item_total: 960 }],
  id: "q1", status: "sent", created_date: "2026-09-06",
  revision_number: 3, is_accepted_revision: false, is_published_revision: false, is_draft_preview: true, accepted_at: null,
};

test("frozen published document: published preview = rev 2 values, draft preview = rev 3 values, zero cross-leak", () => {
  const pub = buildQuoteDocumentModel(PUBLISHED_REV2_DOC);
  const draft = buildQuoteDocumentModel(DRAFT_REV3_DOC);

  // published = revision 2, entirely rev-2 values
  assert.equal(pub.revisionNumber, 2);
  assert.equal(pub.validUntil, "2026-10-06");
  assert.equal(pub.dueDate, "2026-10-06");           // shared meta slot
  assert.equal(pub.paymentTerms, "50% deposit to start");
  assert.equal(pub.referenceNumber, "REF-2");
  assert.equal(pub.terms, "Terms as at revision 2");
  assert.equal(pub.customer.shippingAddress, "Unit 2, Old Rd");
  assert.equal(pub.totals.grandTotal, 800);
  assert.equal(pub.lines[0].rate, 160);

  // draft = revision 3, entirely rev-3 values
  assert.equal(draft.revisionNumber, 3);
  assert.equal(draft.validUntil, "2026-10-22");
  assert.equal(draft.paymentTerms, "Net 30 days");
  assert.equal(draft.referenceNumber, "REF-3");
  assert.equal(draft.terms, "Terms as at revision 3");
  assert.equal(draft.customer.shippingAddress, "Unit 9, New Rd");
  assert.equal(draft.totals.grandTotal, 960);
  assert.equal(draft.lines[0].rate, 192);

  // no rev-3 value ever appears in the published model, and vice versa
  const pubJson = JSON.stringify(pub);
  for (const v of ["2026-10-22", "Net 30 days", "REF-3", "revision 3", "Unit 9, New Rd", "192", "960"]) {
    assert.ok(!pubJson.includes(v), `published model leaked rev-3 value ${v}`);
  }
  const draftJson = JSON.stringify(draft);
  for (const v of ["2026-10-06", "50% deposit to start", "REF-2", "revision 2", "Unit 2, Old Rd"]) {
    assert.ok(!draftJson.includes(v), `draft model leaked rev-2 value ${v}`);
  }
});

test("no fabricated payment-terms fallback in the quote model (invoice default untouched)", () => {
  const noTerms = buildQuoteDocumentModel({ quote_number: "QT-9", total: 10, items: [{ item_name: "x", quantity: 1, rate: 10 }] });
  assert.equal(noTerms.paymentTerms, null, "empty payment_terms -> null, never a hardcoded 'Valid for 14 days'");
  const withTerms = buildQuoteDocumentModel({ quote_number: "QT-9", payment_terms: "COD", total: 10, items: [{ item_name: "x", quantity: 1, rate: 10 }] });
  assert.equal(withTerms.paymentTerms, "COD");
  // invoice still defaults to "Due on receipt"
  const inv = buildInvoiceDocumentModel({ invoice_number: "I", total: 10, amount_paid: 0, balance_due: 10, items: [{ item_name: "x", quantity: 1, rate: 10 }] });
  assert.equal(inv.paymentTerms, "Due on receipt");
});

test("getQuoteDocument: NO mutable opps_quotes field overrides a snapshot commercial field", async () => {
  const s = await src("src/api/quotes.js");
  const fn = s.match(/export async function getQuoteDocument[\s\S]*?\n\}/)[0];
  // the row select no longer pulls valid_until (or any offer field)
  assert.ok(/\.select\("id,status,created_at,current_revision_id,published_revision_id,accepted_revision_id,accepted_at"\)/.test(fn),
    "row select is lifecycle-only — no valid_until / payment_terms / totals / customer");
  // the return spreads the snapshot and overrides ONLY lifecycle keys
  const ret = fn.match(/return \{[\s\S]*?\};/)[0];
  assert.ok(ret.includes("...snapshot,"), "snapshot is spread as the base");
  for (const leaked of ["valid_until: quote.", "payment_terms: quote.", "reference_number: quote.",
                        "terms: quote.", "currency_code: quote.", "customer_name: quote.",
                        "shipping_address: quote.", "subtotal: quote.", "total: quote."]) {
    assert.ok(!ret.includes(leaked), `getQuoteDocument still overrides a snapshot field: ${leaked}`);
  }
  // the only explicit overrides are justified lifecycle fields
  const overrides = [...ret.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(overrides)].sort(), [
    "accepted_at", "created_date", "id", "is_accepted_revision",
    "is_draft_preview", "is_published_revision", "revision_number", "status",
  ]);
});

test("formal (published) quote preview carries NO draft banner; draft preview does", async () => {
  // model is banner-agnostic; the flag is a render-time prop. Assert the
  // drawer only passes draftPreview when the DRAFT variant is active.
  const s = await src("src/features/quotes/QuoteDetailDrawer.jsx");
  assert.ok(s.includes("draftPreview={previewIsDraft}"));
  assert.ok(/previewIsDraft = previewVariant === "draft" \|\| \(!publishedDocument && Boolean\(draftDocument\)\)/.test(s),
    "previewIsDraft is true only for the draft variant (or when no published doc exists)");
  const doc = buildQuoteDocumentModel({ quote_number: "QT-1", total: 10, items: [{ item_name: "x", quantity: 1, rate: 10 }] });
  assert.equal(doc.kind, "quote"); // model itself never encodes the banner
});
