// The Q1 lifecycle enum. Q2 is staff-side only: staff create/edit drafts
// and revise pre-acceptance quotes. Customer states (viewed / accepted /
// changes_requested / declined) are NEVER set from Q2 — there is no
// status-transition RPC yet (Q4). "Send quote" is a placeholder until a
// safe backend transition exists.

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "changes_requested",
  "declined",
  "expired",
  "converted",
];

export const QUOTE_STATUS_LABELS = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  changes_requested: "Changes requested",
  declined: "Declined",
  expired: "Expired",
  converted: "Converted",
};

export const QUOTE_STATUS_BADGE = {
  draft: "bg-secondary text-muted-foreground border-border",
  sent: "bg-blue-50 text-blue-700 border-blue-100",
  viewed: "bg-indigo-50 text-indigo-700 border-indigo-100",
  accepted: "bg-emerald-50 text-emerald-700 border-emerald-100",
  changes_requested: "bg-amber-50 text-amber-700 border-amber-100",
  declined: "bg-red-50 text-red-700 border-red-100",
  expired: "bg-slate-100 text-slate-600 border-slate-200",
  converted: "bg-purple-50 text-purple-700 border-purple-100",
};

// Mirrors save_opps_quote_with_items exactly: it refuses an edit when
// status is accepted / converted / declined. Everything else routes
// through the same RPC and is fine to open in the editor.
export const NON_EDITABLE_QUOTE_STATUSES = new Set(["accepted", "converted", "declined"]);

export function isQuoteEditable(status) {
  return !NON_EDITABLE_QUOTE_STATUSES.has(String(status || "draft"));
}

// Q2.5 ships public.mark_quote_sent(). Single source of truth the UI uses
// to decide whether the "Send quote" / "Resend updated quote" action can
// do anything.
export const HAS_QUOTE_SEND_TRANSITION = true;

// mark_quote_sent() accepts these (draft / changes_requested = first send;
// sent / viewed = resend). accepted / converted / declined / expired are
// refused server-side.
export const SENDABLE_QUOTE_STATUSES = new Set(["draft", "changes_requested", "sent", "viewed"]);

export function canSendQuote(quote) {
  return (
    HAS_QUOTE_SEND_TRANSITION &&
    Boolean(quote?.current_revision_id) &&
    SENDABLE_QUOTE_STATUSES.has(String(quote?.status || "draft"))
  );
}

// Unsent changes: the staff working head has moved past the revision the
// customer was formally sent, and the quote is still in a
// customer-presented state. Mirrors mark_quote_sent's own model.
export function hasUnsentChanges(quote) {
  if (!quote) return false;
  const cur = quote.current_revision_id;
  const pub = quote.published_revision_id;
  return (
    Boolean(pub) && Boolean(cur) && cur !== pub &&
    ["sent", "viewed", "changes_requested"].includes(String(quote.status))
  );
}

// Has this quote ever been formally published to the customer?
export function isPublished(quote) {
  return Boolean(quote?.published_revision_id);
}

// ── Q3.1 public /q/:token share ─────────────────────────────────────────
// A public link can exist only once the quote has a published revision
// AND is in a customer-presented state. Draft / never-sent quotes show no
// share controls at all. `declined` is included deliberately so staff can
// still copy a historical link or, more importantly, revoke it.
export const SHAREABLE_QUOTE_STATUSES = new Set([
  "sent", "viewed", "changes_requested", "accepted", "declined",
]);

export function canShareQuote(quote) {
  return (
    Boolean(quote?.published_revision_id) &&
    SHAREABLE_QUOTE_STATUSES.has(String(quote?.status || "draft"))
  );
}

// Is a public link live right now? Issued, not revoked, still visible, and
// (if an expiry was set) not past it. Mirrors get_public_quote's own gate.
export function hasActiveQuoteShare(quote) {
  if (!quote?.share_token) return false;
  if (quote.share_revoked_at) return false;
  if (quote.public_visible === false) return false;
  if (quote.share_expires_at && Date.parse(quote.share_expires_at) < Date.now()) return false;
  return true;
}
