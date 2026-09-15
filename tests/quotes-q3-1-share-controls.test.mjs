import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canShareQuote,
  hasActiveQuoteShare,
  SHAREABLE_QUOTE_STATUSES,
} from "../src/features/quotes/quoteStatus.js";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const API = "src/api/quotes.js";
const CONTROLS = "src/features/quotes/QuoteShareControls.jsx";
const DRAWER = "src/features/quotes/QuoteDetailDrawer.jsx";
const PAGE = "src/pages/Quotes.jsx";

const published = { published_revision_id: "rev-2" };

// ── gating ─────────────────────────────────────────────────────────────

test("a draft / never-sent quote has no share action", () => {
  assert.equal(canShareQuote({ status: "draft", published_revision_id: null }), false);
  assert.equal(canShareQuote({ status: "draft", ...published }), false, "draft blocked even if a revision somehow exists");
  assert.equal(canShareQuote({ status: "sent", published_revision_id: null }), false, "no formal offer => no link");
});

test("a sent / viewed / changes_requested / accepted / declined quote with a published revision can be shared", () => {
  for (const status of ["sent", "viewed", "changes_requested", "accepted", "declined"]) {
    assert.equal(canShareQuote({ status, ...published }), true, `${status} is shareable`);
    assert.ok(SHAREABLE_QUOTE_STATUSES.has(status));
  }
  assert.equal(canShareQuote({ status: "converted", ...published }), false, "converted is not a customer-viewing state");
  assert.equal(canShareQuote({ status: "expired", ...published }), false);
});

test("QuoteShareControls renders nothing when the quote is not shareable", async () => {
  const s = await src(CONTROLS);
  assert.ok(/if \(!canShareQuote\(quote\)\) return null;/.test(s), "early-returns null for draft/unpublished quotes");
});

// ── active-share detection ─────────────────────────────────────────────

test("hasActiveQuoteShare: issued + visible + not revoked + not expired", () => {
  assert.equal(hasActiveQuoteShare({ share_token: null }), false, "no token");
  assert.equal(hasActiveQuoteShare({ share_token: "t", share_revoked_at: "2026-09-06T00:00:00Z" }), false, "revoked");
  assert.equal(hasActiveQuoteShare({ share_token: "t", public_visible: false }), false, "hidden");
  assert.equal(hasActiveQuoteShare({ share_token: "t", share_expires_at: "2000-01-01T00:00:00Z" }), false, "expired");
  assert.equal(hasActiveQuoteShare({ share_token: "t", public_visible: true }), true, "live, no expiry");
  assert.equal(hasActiveQuoteShare({ share_token: "t", public_visible: true, share_expires_at: "2999-01-01T00:00:00Z" }), true, "live, future expiry");
});

test("no active share => 'Share quote'; active share => Copy / Rotate / Revoke", async () => {
  const s = await src(CONTROLS);
  assert.ok(s.includes("hasActiveQuoteShare(quote)"), "decides layout off the live-share check");
  assert.ok(s.includes("Share quote") || s.includes("Re-issue public link"), "issue affordance when there is no live link");
  for (const label of ["Copy public link", "Rotate link", "Revoke link"]) {
    assert.ok(s.includes(label), `active-share control: ${label}`);
  }
});

// ── URL construction ──────────────────────────────────────────────────

test("buildPublicQuoteUrl uses the fixed production origin and /q/{token} — never window.location", async () => {
  const s = await src(API);
  assert.ok(s.includes('PUBLIC_QUOTE_ORIGIN = "https://xlab.jointx.co.za"'), "fixed production origin literal");
  const fn = s.match(/export function buildPublicQuoteUrl[\s\S]*?\n}/)[0];
  assert.ok(fn.includes("`${PUBLIC_QUOTE_ORIGIN}/q/${encodeURIComponent(token)}`"), "origin + /q/ + encoded token");
  assert.ok(!/window\.location|location\.origin|location\.host/.test(fn), "URL is not derived from the current host");
  const controls = await src(CONTROLS);
  assert.ok(!/window\.location|location\.origin|location\.host/.test(controls), "the UI does not build a URL from the host either");
});

// ── canonical RPCs only, no direct table writes ───────────────────────

test("share actions call ONLY the canonical Q3 RPCs — no supabase.from('opps_quotes') mutation", async () => {
  const s = await src(API);
  const block = s.slice(s.indexOf("Q3.1"));
  assert.ok(/rpc\("issue_quote", \{\s*p_quote_id: quoteId,\s*p_expires_at: expiresAt \|\| null,?\s*\}\)/.test(block), "issueQuoteShare -> issue_quote");
  assert.ok(/rpc\("rotate_quote_share_token", \{ p_quote_id: quoteId \}\)/.test(block), "rotateQuoteShareToken -> rotate_quote_share_token");
  assert.ok(/rpc\("revoke_quote_share", \{ p_quote_id: quoteId \}\)/.test(block), "revokeQuoteShare -> revoke_quote_share");
  assert.ok(!/\.from\("opps_quotes"\)[\s\S]*?\.(update|insert|upsert|delete)\(/.test(block), "no direct opps_quotes write in the share block");
  for (const f of [CONTROLS, DRAWER]) {
    const t = await src(f);
    assert.ok(!/supabase|\.from\(['"]opps_quote/.test(t), `${f} never touches supabase directly`);
  }
});

test("Quotes.jsx wires each control to its own mutation + query invalidation", async () => {
  const s = await src(PAGE);
  assert.ok(s.includes("issueQuoteShare") && s.includes("rotateQuoteShareToken") && s.includes("revokeQuoteShare"), "all three api fns imported");
  for (const m of ["issueShareMutation", "rotateShareMutation", "revokeShareMutation"]) {
    assert.ok(s.includes(m), `${m} defined`);
  }
  assert.ok(s.includes("onIssueShare={(quote) => issueShareMutation.mutate(quote)}"), "issue wired to the drawer");
  assert.ok(s.includes("onRotateShare={(quote) => rotateShareMutation.mutate(quote)}"), "rotate wired");
  assert.ok(s.includes("onRevokeShare={(quote) => revokeShareMutation.mutate(quote)}"), "revoke wired");
  assert.ok(s.includes("invalidateQuote(quote.id)"), "success refreshes the quote / events / document queries");
});

// ── UX: confirmations, clipboard, mobile ──────────────────────────────

test("rotate confirms the old link dies; revoke is a destructive confirmation", async () => {
  const s = await src(CONTROLS);
  assert.ok(s.includes('confirm === "rotate"') && s.includes('confirm === "revoke"'), "both gated behind a ConfirmDialog");
  const rotate = s.slice(s.indexOf('open={confirm === "rotate"}'));
  assert.ok(/stops working immediately/i.test(rotate), "rotate copy warns the current link stops working");
  const revoke = s.slice(s.indexOf('open={confirm === "revoke"}'));
  assert.ok(revoke.includes('variant="destructive"'), "revoke uses the destructive confirm styling");
  assert.ok(/Revision history is kept/i.test(revoke), "revoke copy reassures history is preserved");
});

test("copy uses navigator.clipboard with a non-clipboard fallback and a success toast", async () => {
  const s = await src(CONTROLS);
  assert.ok(s.includes("navigator?.clipboard?.writeText") || s.includes("navigator.clipboard.writeText"), "clipboard API first");
  assert.ok(s.includes('document.execCommand("copy")'), "execCommand fallback for browsers without the async clipboard");
  assert.ok(s.includes('toast.success("Public link copied")'), "clear success feedback");
});

test("controls are reachable and >=44px on mobile", async () => {
  const s = await src(CONTROLS);
  const buttons = s.match(/className="h-11 rounded-xl[^"]*sm:h-9"/g) || [];
  assert.ok(buttons.length >= 4, "issue + copy + rotate + revoke are all h-11 (44px) collapsing to h-9 on >=sm");
  assert.ok(s.includes("flex flex-wrap gap-2"), "the action row wraps instead of overflowing a narrow drawer");
});

// ── isolation from quote semantics + invoice ──────────────────────────

test("share controls never touch revision pointers / status / totals", async () => {
  for (const f of [API, CONTROLS, DRAWER, PAGE]) {
    const s = await src(f);
    const scoped = f === API ? s.slice(s.indexOf("Q3.1")) : s;
    assert.ok(!/published_revision_id\s*[:=][^=]|accepted_revision_id\s*[:=]|current_revision_id\s*[:=]/.test(scoped),
      `${f}: share code assigns no revision pointer`);
    assert.ok(!/mark_quote_sent|save_opps_quote_with_items/.test(scoped) || f === PAGE,
      `${f}: share code does not call the send / save RPCs`);
  }
});

test("no invoice share / payment concept leaks into the quote share code", async () => {
  for (const f of [API, CONTROLS]) {
    const s = await src(f);
    const scoped = f === API ? s.slice(s.indexOf("Q3.1")) : s;
    assert.ok(!/issue_invoice|invoice_share|get_public_invoice|invoice_payments|payfast|balance_due|amount_paid/i.test(scoped),
      `${f}: reuses no invoice object`);
  }
});

// ── regression: the panel didn't render because the quote projection ───
//    didn't carry the Q3 share-state columns (browser acceptance). ─────

test("QUOTE_LIST_COLUMNS carries every field QuoteShareControls needs", async () => {
  const s = await src(API);
  const list = s.match(/const QUOTE_LIST_COLUMNS = \[([\s\S]*?)\]\.join/)[1];
  for (const col of ["share_token", "public_visible", "share_revoked_at", "share_expires_at"]) {
    assert.ok(new RegExp(`"${col}"`).test(list), `list projection selects ${col}`);
  }
  // the fields canShareQuote already relied on must still be there
  for (const col of ["status", "published_revision_id"]) {
    assert.ok(new RegExp(`"${col}"`).test(list), `list projection selects ${col}`);
  }
  // detail path stays a full-row read (also carries the share columns)
  assert.ok(/from\("opps_quotes"\)\s*\.select\("\*"\)/.test(s), "getQuote reads the whole row");
});

test("a sent + published quote with NO token => panel shows 'Not shared' / 'Share quote'", async () => {
  const q = { status: "sent", published_revision_id: "rev-2", share_token: null };
  assert.equal(canShareQuote(q), true, "the panel is shown");
  assert.equal(hasActiveQuoteShare(q), false, "there is no live link");
  const s = await src(CONTROLS);
  const idle = s.slice(s.indexOf("hasActiveQuoteShare(quote)"));
  // the not-active branch (rendered when hasActiveQuoteShare is false)
  const notActive = s.slice(s.indexOf("{active ? ("));
  assert.ok(/Not shared/.test(s) && /Share quote/.test(notActive.slice(notActive.indexOf(") : ("))),
    "idle state offers 'Not shared' status + a 'Share quote' button");
  assert.ok(/onIssue\?\.\(quote\)/.test(s), "the button issues the link");
  void idle;
});

test("an active share => panel shows 'Live' + Copy / Rotate / Revoke", async () => {
  const q = { status: "sent", published_revision_id: "rev-2", share_token: "tok", public_visible: true };
  assert.equal(canShareQuote(q), true);
  assert.equal(hasActiveQuoteShare(q), true, "a live link is detected");
  const s = await src(CONTROLS);
  // the URL row + the three controls are gated behind the content
  // ternary: `{active ? ( <> … </> ) : ( <issue button> )}`
  const contentTernary = s.slice(s.lastIndexOf("{active ? ("), s.lastIndexOf("onIssue?.(quote)"));
  assert.ok(/<Link2 className="[^"]*" \/> Live/.test(s), "'Live' status pill");
  for (const label of ["Copy public link", "Rotate link", "Revoke link"]) {
    assert.ok(contentTernary.includes(label), `active branch renders: ${label}`);
  }
  assert.ok(contentTernary.includes("{publicUrl}"), "the active branch prints the public URL");
  assert.ok(s.includes("const publicUrl = active ? buildPublicQuoteUrl(quote.share_token)"), "URL built from the real share_token");
  assert.ok(s.includes("onConfirm={() => { setConfirm(null); onRotate?.(quote); }}") &&
            s.includes("onConfirm={() => { setConfirm(null); onRevoke?.(quote); }}"),
    "rotate + revoke fire their callbacks after a confirmation");
});

test("the fix is quote-only — no invoice file / migration / public projection touched", async () => {
  const s = await src(API);
  // the change is confined to the quote list projection + a comment.
  // converted_invoice_id (Phase 1, Quote -> Invoice direct path) is a
  // legitimate FK column ON opps_quotes itself — same class of addition
  // as converted_order_id — not an invoice-table leak, so it's excluded
  // from this guard the same way "order_" is never flagged.
  const projection = s.match(/const QUOTE_LIST_COLUMNS[\s\S]*?\]\.join\(","\);/)[0].replace(/"converted_invoice_id",?/, "");
  assert.ok(!/opps_invoices|invoice_[a-z]/i.test(projection),
    "no invoice-table column crept into the quote projection");
  const mig = await src("supabase/migrations/20260906120000_quotes_q3_public_route.sql");
  assert.ok(mig.includes("_public_quote_projection") && !/share_token'|customer_email'/.test(
    mig.match(/create or replace function public\._public_quote_projection[\s\S]*?\$\$;/)[0]),
    "the customer-safe public projection is unchanged (still leaks no internal field)");
});
