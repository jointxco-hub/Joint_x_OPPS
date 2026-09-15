// Q2 — OPPS staff quote workflow API.
//
// Every write goes through public.save_opps_quote_with_items(...) (Q1
// contract). This module NEVER inserts/updates opps_quotes /
// opps_quote_items / opps_quote_revisions / opps_quote_events directly.
// Reads are plain tenant-scoped selects gated by the Q1 RLS policies.
//
// A quote is a distinct commercial record. No invoice table, no invoice
// status, no payment/share behaviour is touched here.

import { supabase } from "@/lib/supabaseClient";
import { getCurrentTenantId } from "@/lib/tenantContext";
import { calculateQuoteTotals } from "@/features/quotes/quoteCalculations";
import { sanitizeQuoteLineSourceMetadata, stampReviewResolution } from "@/features/quotes/quoteProductMapping";

function ensureSupabase() {
  if (!supabase) throw new Error("Supabase is not configured.");
}
async function getTenantId() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("No active tenant is available for quotes.");
  return tenantId;
}

const QUOTE_LIST_COLUMNS = [
  "id",
  "quote_number",
  "status",
  "customer_id",
  "customer_name",
  "currency_code",
  "valid_until",
  "reference_number",
  "subtotal",
  "discount_total",
  "shipping_charge",
  "tax_total",
  "total",
  "current_revision_id",
  "published_revision_id",
  "accepted_revision_id",
  "source_request_id",
  "converted_order_id",
  "converted_invoice_id",
  // Q3 public-share state — QuoteShareControls / canShareQuote /
  // hasActiveQuoteShare read these off the quote row to decide whether to
  // show the "Public link" panel and which controls it carries. Kept in
  // the canonical projection so list rows and the detail row agree.
  "share_token",
  "public_visible",
  "share_revoked_at",
  "share_expires_at",
  "created_at",
  "updated_at",
].join(",");

// mark_quote_sent raises these.
export const QUOTE_SEND_ERROR_MESSAGES = {
  QUOTE_AUTH_REQUIRED: "Your session expired. Sign in again before sending this quote.",
  QUOTE_ACCESS_DENIED: "You do not have permission to send quotes for this tenant.",
  QUOTE_NOT_FOUND: "This quote could not be found.",
  QUOTE_NO_REVISION_TO_SEND: "Save the quote at least once before sending it.",
  QUOTE_NOT_SENDABLE: "Accepted, converted, declined or expired quotes cannot be (re)sent.",
};

// save_opps_quote_with_items raises these; map to staff-readable copy.
export const QUOTE_SAVE_ERROR_MESSAGES = {
  QUOTE_AUTH_REQUIRED: "Your session expired. Sign in again before saving this quote.",
  QUOTE_ACCESS_DENIED: "You do not have permission to save quotes for this tenant.",
  QUOTE_ITEMS_INVALID: "The quote line items are invalid. Reload the quote before saving.",
  QUOTE_EMPTY_ITEMS_BLOCKED: "Add at least one line item before saving.",
  QUOTE_ITEM_INVALID_VALUES: "A line item has an invalid quantity, rate, discount or tax. Review the lines and try again.",
  QUOTE_TOTAL_MISMATCH: "The quote total does not match its line items. Fix the amounts, or record an explicit total override with a reason.",
  QUOTE_TOTAL_OVERRIDE_REASON_REQUIRED: "A total override needs a written reason.",
  QUOTE_STALE_VERSION: "This quote changed after you opened it. Reload it before saving.",
  QUOTE_ITEM_COUNT_CHANGED: "The saved quote items changed after you opened the editor. Reload before saving.",
  QUOTE_NOT_EDITABLE: "Accepted, converted or declined quotes cannot be edited.",
  QUOTE_NUMBER_TENANT_DENIED: "You do not have permission to create quote numbers for this tenant.",
};

const POSTGRES_QUOTE_ERROR_MESSAGES = {
  "22P02": "A quote value has an invalid format. Review the line items and try again.",
  "23502": "A required quote value is missing. Review the highlighted line and try again.",
  "23503": "A linked quote record is no longer available. Reload before saving.",
  "23514": "A line item contains an invalid quantity or amount. Review the lines and try again.",
};

function quoteSaveError(error) {
  const raw = String(error?.message || "");
  const code = Object.keys(QUOTE_SAVE_ERROR_MESSAGES).find((candidate) => raw.includes(candidate));
  const pg = POSTGRES_QUOTE_ERROR_MESSAGES[error?.code];
  return Object.assign(
    new Error(code ? QUOTE_SAVE_ERROR_MESSAGES[code] : pg || raw || "Could not save the quote."),
    { code: code || error?.code || "QUOTE_SAVE_FAILED", cause: error },
  );
}

// ── list ─────────────────────────────────────────────────────────────────
export async function listQuotes(options = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const page = Math.max(Number(options.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(options.pageSize || 20), 1), 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("opps_quotes")
    .select(QUOTE_LIST_COLUMNS, { count: "exact" })
    .eq("tenant_id", tenantId)
    // default sort: most recently updated first
    .order(options.sortBy || "updated_at", { ascending: options.ascending === true })
    .range(from, to);

  if (options.status && options.status !== "all") query = query.eq("status", options.status);
  if (options.customerId) query = query.eq("customer_id", options.customerId);
  if (options.quoteNumber) query = query.ilike("quote_number", `%${options.quoteNumber}%`);
  if (options.search) query = query.ilike("customer_name", `%${options.search}%`);
  if (options.dateFrom) query = query.gte("updated_at", options.dateFrom);
  if (options.dateTo) query = query.lte("updated_at", `${options.dateTo}T23:59:59.999Z`);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const rows = data || [];
  const revisionNumberById = await revisionNumbersFor(
    rows.flatMap((r) => [r.current_revision_id, r.published_revision_id]).filter(Boolean),
  );

  return {
    data: rows.map((row) => {
      const currentNo = revisionNumberById[row.current_revision_id] ?? null;
      const publishedNo = revisionNumberById[row.published_revision_id] ?? null;
      return {
        ...row,
        current_revision_number: currentNo,
        published_revision_number: publishedNo,
        has_source_request: Boolean(row.source_request_id),
        is_converted: Boolean(row.converted_order_id),
        has_unsent_changes:
          Boolean(row.published_revision_id) &&
          row.current_revision_id !== row.published_revision_id &&
          ["sent", "viewed", "changes_requested"].includes(String(row.status)),
      };
    }),
    count: count || 0,
    page,
    pageSize,
  };
}

async function revisionNumbersFor(revisionIds) {
  if (!revisionIds.length) return {};
  const tenantId = await getTenantId();
  const { data, error } = await supabase
    .from("opps_quote_revisions")
    .select("id,revision_number")
    .eq("tenant_id", tenantId)
    .in("id", revisionIds);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data || []).map((r) => [r.id, r.revision_number]));
}

// ── detail ───────────────────────────────────────────────────────────────
export async function getQuote(id, { includeItems = true } = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();

  const { data: quote, error } = await supabase
    .from("opps_quotes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();
  if (error) throw new Error(`Quote detail query failed: ${error.message}`);

  const [items, currentRevision, publishedRevision, revisionCount] = await Promise.all([
    includeItems ? listQuoteItems(id) : Promise.resolve([]),
    quote.current_revision_id ? getQuoteRevision(quote.current_revision_id) : Promise.resolve(null),
    quote.published_revision_id ? getQuoteRevision(quote.published_revision_id) : Promise.resolve(null),
    countQuoteRevisions(id),
  ]);

  return {
    ...quote,
    items,
    current_revision: currentRevision,
    current_revision_number: currentRevision?.revision_number ?? null,
    published_revision_number: publishedRevision?.revision_number ?? null,
    revision_count: revisionCount,
  };
}

export async function listQuoteItems(quoteId) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const { data, error } = await supabase
    .from("opps_quote_items")
    .select("*")
    .eq("quote_id", quoteId)
    .eq("tenant_id", tenantId)
    .order("line_number", { ascending: true });
  if (error) throw new Error(`Quote item query failed: ${error.message}`);
  return data || [];
}

async function getQuoteRevision(revisionId) {
  const tenantId = await getTenantId();
  const { data, error } = await supabase
    .from("opps_quote_revisions")
    .select("*")
    .eq("id", revisionId)
    .eq("tenant_id", tenantId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function countQuoteRevisions(quoteId) {
  const tenantId = await getTenantId();
  const { count, error } = await supabase
    .from("opps_quote_revisions")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", quoteId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  return count || 0;
}

export async function listQuoteRevisions(quoteId, { limit = 50 } = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const { data, error } = await supabase
    .from("opps_quote_revisions")
    .select("id,revision_number,totals,created_at,created_by")
    .eq("quote_id", quoteId)
    .eq("tenant_id", tenantId)
    .order("revision_number", { ascending: false })
    .limit(Math.min(Math.max(Number(limit), 1), 100));
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: r.id,
    revision_number: r.revision_number,
    total: Number(r?.totals?.total ?? 0),
    created_at: r.created_at,
    created_by: r.created_by,
  }));
}

export async function listQuoteEvents(quoteId, { limit = 50 } = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const { data, error } = await supabase
    .from("opps_quote_events")
    .select("id,event_type,actor_kind,actor_user_id,actor_label,note,revision_id,metadata,created_at")
    .eq("quote_id", quoteId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(Number(limit), 1), 100));
  if (error) throw new Error(error.message);
  return data || [];
}

// ── customer-safe document shape (for the staff preview) ─────────────────
// Every commercial / customer-facing field comes from the immutable
// revision SNAPSHOT (frozen by save_opps_quote_with_items, already
// customer-safe — no opps_quote_items.source_metadata /
// source_client_product_id / notes). The opps_quotes row contributes ONLY
// document-lifecycle metadata that is intentionally quote-level and cannot
// alter the offer itself — each such field is justified below.
//
// variant:
//   'published' (default) — the formal offer the customer sees:
//        accepted_revision_id ?? published_revision_id.
//        Returns null when the quote has never been sent.
//   'draft'     — the staff working head (current_revision_id); the
//        renderer must show a "NOT FOR ACCEPTANCE" banner (draftPreview).
//
// Q2.5 FROZEN-DOCUMENT FIX: this function previously overrode
// snapshot.valid_until with the MUTABLE opps_quotes.valid_until, so a
// staff edit to rev N+1 changed the "valid until" shown on the still-
// published rev N. valid_until (and payment_terms / reference_number /
// terms / currency / customer / addresses / all money) is now taken from
// the snapshot only.
export async function getQuoteDocument(id, { variant = "published" } = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();

  const { data: quote, error } = await supabase
    .from("opps_quotes")
    .select("id,status,created_at,current_revision_id,published_revision_id,accepted_revision_id,accepted_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();
  if (error) throw new Error(error.message);

  const revisionId = variant === "draft"
    ? quote.current_revision_id
    : (quote.accepted_revision_id || quote.published_revision_id);
  if (!revisionId) return null;

  const revision = await getQuoteRevision(revisionId);
  const snapshot = revision?.snapshot || {};

  return {
    // ── revision-owned: the frozen offer. Do NOT override any of these. ──
    // snapshot carries: quote_number, currency_code, valid_until,
    // payment_terms, reference_number, terms, customer_name,
    // customer_billing_address, shipping_address, subtotal, discount_total,
    // shipping_charge, tax_total, total, items[].
    ...snapshot,
    // ── quote-row lifecycle metadata (justified, offer-neutral) ─────────
    id: quote.id,
    // status — where the quote is in its lifecycle (sent / viewed /
    // accepted …). Not part of the offer content; a customer viewing the
    // published quote should see the CURRENT lifecycle state, not the
    // 'draft' frozen into the snapshot at save time.
    status: quote.status,
    // created_date — when the quote was first opened, quote-level by
    // definition; a revision has no "creation of the quote" date.
    created_date: String(quote.created_at || "").slice(0, 10),
    // revision_number — identity of THIS revision, from the revision row.
    revision_number: revision?.revision_number ?? null,
    is_accepted_revision: Boolean(quote.accepted_revision_id && quote.accepted_revision_id === revisionId),
    is_published_revision: Boolean(quote.published_revision_id && quote.published_revision_id === revisionId),
    is_draft_preview: variant === "draft",
    // accepted_at — when acceptance happened; quote-level event timestamp.
    accepted_at: quote.accepted_at || null,
  };
}

// ── publish the working revision as the live customer offer ─────────────
// The ONLY writer of opps_quotes.published_revision_id. See
// supabase/migrations/20260906100000_quotes_q2_5_published_revision.sql.
export async function markQuoteSent(quoteId) {
  ensureSupabase();
  const { data, error } = await supabase.rpc("mark_quote_sent", { p_quote_id: quoteId });
  if (error) {
    const raw = String(error.message || "");
    const code = Object.keys(QUOTE_SEND_ERROR_MESSAGES).find((k) => raw.includes(k));
    throw Object.assign(
      new Error(code ? QUOTE_SEND_ERROR_MESSAGES[code] : raw || "Could not send the quote."),
      { code: code || error.code || "QUOTE_SEND_FAILED", cause: error },
    );
  }
  if (!data?.ok) {
    throw Object.assign(new Error("The send returned an incomplete result."), { code: "QUOTE_SEND_RESULT_INVALID" });
  }
  return data; // { ok, no_change, resend, quote_id, status, published_revision_id, revision_number }
}

// ── the ONLY write path ─────────────────────────────────────────────────
export async function saveQuoteWithItems(input = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();

  const totals = calculateQuoteTotals(input, input.items || []);
  const items = (totals.items || []).map((item, index) => {
    // Carry the canonical-product linkage through to
    // save_opps_quote_with_items (Q1 contract accepts both). The RPC builds
    // the customer-safe snapshot from an allowlist, so source_metadata only
    // ever contributes a derived price_breakdown — never cost / margin /
    // internal data. sanitizeQuoteLineSourceMetadata is belt-and-braces.
    // stampReviewResolution records (or drops) the internal price_reviewed
    // flag so a re-opened quote keeps a staff-resolved rate resolved.
    const sourceMetadata = stampReviewResolution(item, sanitizeQuoteLineSourceMetadata(item.source_metadata));
    return {
      line_number: Number(item.line_number ?? index + 1),
      role: item.role || "product",
      item_name: String(item.item_name || "").trim(),
      item_description: item.item_description || null,
      quantity: Number(item.quantity ?? 0),
      unit: item.unit || null,
      rate: Number(item.rate ?? 0),
      discount: Number(item.discount ?? 0),
      tax_name: item.tax_name || null,
      tax_percentage: Number(item.tax_percentage ?? 0),
      image_url: item.image_url || null,
      source_client_product_id: item.source_client_product_id || null,
      source_metadata: Object.keys(sourceMetadata).length ? sourceMetadata : undefined,
    };
  });

  const quotePayload = {
    customer_id: input.customer_id || null,
    customer_name: input.customer_name || null,
    customer_email: input.customer_email || null,
    customer_phone: input.customer_phone || null,
    customer_whatsapp: input.customer_whatsapp || null,
    customer_billing_address: input.customer_billing_address || null,
    shipping_address: input.shipping_address || null,
    currency_code: input.currency_code || "ZAR",
    valid_until: input.valid_until || null,
    payment_terms: input.payment_terms || null,
    reference_number: input.reference_number || null,
    notes: input.notes || null,
    terms: input.terms || null,
    shipping_charge: totals.shipping_charge,
    total: totals.total,
    total_override_reason: input.total_override_reason || null,
    source_request_id: input.id ? undefined : (input.source_request_id || null),
    supersedes_quote_id: input.supersedes_quote_id || null,
  };

  const { data, error } = await supabase.rpc("save_opps_quote_with_items", {
    p_tenant_id: tenantId,
    p_quote_id: input.id || null,
    p_quote: quotePayload,
    p_items: items,
    p_expected_updated_at: input.id ? (input.expected_updated_at || null) : null,
    p_expected_item_count: input.id ? Number(input.expected_item_count ?? 0) : null,
    p_allow_total_override: Boolean(input.allow_total_override),
  });

  if (error) throw quoteSaveError(error);
  if (!data?.ok || !data?.quote_id) {
    throw Object.assign(new Error("The quote save returned an incomplete result."), { code: "QUOTE_SAVE_RESULT_INVALID" });
  }
  // return the freshly re-read detail so callers get canonical state
  return getQuote(data.quote_id, { includeItems: true });
}

// ── Q3.1 — public /q/:token share controls (staff) ──────────────────────
// Every call is exactly one canonical Q3 RPC (issue_quote /
// rotate_quote_share_token / revoke_quote_share). This module NEVER
// writes opps_quotes.share_token / public_visible / share_revoked_at /
// share_expires_at directly. Quote sharing is its own lifecycle — no
// invoice share/payment concept is reused.

// Production storefront origin for the public quote page. Deliberately a
// fixed literal, matching the established OrderDrawer / ClientProducts
// convention — NEVER window.location — so a link copied from a preview or
// local build still sends the customer to production.
export const PUBLIC_QUOTE_ORIGIN = "https://xlab.jointx.co.za";

export const QUOTE_SHARE_ERROR_MESSAGES = {
  QUOTE_AUTH_REQUIRED: "Your session expired. Sign in again before changing the public link.",
  QUOTE_ACCESS_DENIED: "You do not have permission to manage this quote's public link.",
  QUOTE_NOT_FOUND: "This quote could not be found.",
  QUOTE_NOT_PUBLISHED: "Send the quote to the customer first — only a sent quote can have a public link.",
  QUOTE_NOT_SHAREABLE: "This quote is still a draft. Send it before creating a public link.",
  QUOTE_SHARE_NOT_ACTIVE: "There is no active public link to rotate. Issue a new link instead.",
  QUOTE_SHARE_TOKEN_COLLISION: "Could not allocate a unique link. Try again.",
};

function quoteShareError(error) {
  const raw = String(error?.message || "");
  const code = Object.keys(QUOTE_SHARE_ERROR_MESSAGES).find((candidate) => raw.includes(candidate));
  return Object.assign(
    new Error(code ? QUOTE_SHARE_ERROR_MESSAGES[code] : raw || "Could not update the public link."),
    { code: code || error?.code || "QUOTE_SHARE_FAILED", cause: error },
  );
}

// The customer-facing URL for a share token. Fixed production origin.
export function buildPublicQuoteUrl(shareToken) {
  const token = String(shareToken || "").trim();
  if (!token) return "";
  return `${PUBLIC_QUOTE_ORIGIN}/q/${encodeURIComponent(token)}`;
}

// Mint (or re-activate) the public link. Server refuses a quote with no
// published revision (QUOTE_NOT_PUBLISHED) or a draft (QUOTE_NOT_SHAREABLE),
// and never touches the quote's status.
export async function issueQuoteShare(quoteId, expiresAt = null) {
  ensureSupabase();
  const { data, error } = await supabase.rpc("issue_quote", {
    p_quote_id: quoteId,
    p_expires_at: expiresAt || null,
  });
  if (error) throw quoteShareError(error);
  if (!data?.ok || !data?.share_token) {
    throw Object.assign(new Error("Issuing the link returned an incomplete result."), { code: "QUOTE_SHARE_RESULT_INVALID" });
  }
  return { ...data, public_url: buildPublicQuoteUrl(data.share_token) };
}

// New token on the same quote — the previous link stops resolving at once.
export async function rotateQuoteShareToken(quoteId) {
  ensureSupabase();
  const { data, error } = await supabase.rpc("rotate_quote_share_token", { p_quote_id: quoteId });
  if (error) throw quoteShareError(error);
  if (!data?.ok || !data?.share_token) {
    throw Object.assign(new Error("Rotating the link returned an incomplete result."), { code: "QUOTE_SHARE_RESULT_INVALID" });
  }
  return { ...data, public_url: buildPublicQuoteUrl(data.share_token) };
}

// Take the link offline. Revision history is untouched.
export async function revokeQuoteShare(quoteId) {
  ensureSupabase();
  const { data, error } = await supabase.rpc("revoke_quote_share", { p_quote_id: quoteId });
  if (error) throw quoteShareError(error);
  if (!data?.ok) {
    throw Object.assign(new Error("Revoking the link returned an incomplete result."), { code: "QUOTE_SHARE_RESULT_INVALID" });
  }
  return data;
}

// ── quote -> order conversion (Phase 1) ──────────────────────────────────
// Server-side RPC does all the real work: eligibility/tenant/finance-
// permission checks, snapshot read, order insert, quote-event log. This
// wrapper only maps error codes to friendly messages and normalizes the
// result shape. See supabase/migrations/20260916090000_quote_order_invoice_conversion.sql.
export const QUOTE_ORDER_CONVERSION_ERROR_MESSAGES = {
  QUOTE_ORDER_FINANCE_PERMISSION_REQUIRED: "You do not have permission to convert quotes into orders.",
  QUOTE_NOT_FOUND: "This quote could not be found.",
  QUOTE_TENANT_ACCESS_DENIED: "You do not have access to this quote's workspace.",
  QUOTE_NOT_CONVERTIBLE: "Only an accepted quote can be converted into an order.",
  QUOTE_NO_ACCEPTED_SNAPSHOT: "This quote has no accepted snapshot to convert from.",
  QUOTE_ACCEPTED_SNAPSHOT_MISSING: "The accepted quote snapshot could not be found.",
  QUOTE_SNAPSHOT_EMPTY_ITEMS: "The accepted quote has no line items to carry into an order.",
};

function quoteOrderConversionError(error) {
  const raw = String(error?.message || "");
  const code = Object.keys(QUOTE_ORDER_CONVERSION_ERROR_MESSAGES).find((candidate) => raw.includes(candidate));
  return Object.assign(
    new Error(code ? QUOTE_ORDER_CONVERSION_ERROR_MESSAGES[code] : raw || "Could not convert this quote into an order."),
    { code: code || error?.code || "QUOTE_ORDER_CONVERSION_FAILED", cause: error },
  );
}

// Convert an accepted quote into an operational order. Idempotent — calling
// this again on an already-converted quote returns the SAME order
// (data.replayed === true) rather than creating a second one.
export async function convertQuoteToOrder(quoteId) {
  ensureSupabase();
  const { data, error } = await supabase.rpc("convert_quote_to_order", { p_quote_id: quoteId });
  if (error) throw quoteOrderConversionError(error);
  if (!data?.ok || !data?.order_id) {
    throw Object.assign(new Error("Converting this quote returned an incomplete result."), { code: "QUOTE_ORDER_CONVERSION_RESULT_INVALID" });
  }
  return data;
}

// ── quote -> invoice direct conversion (Phase 1, second path) ───────────
// The second Quote -> Order/Invoice path: send the invoice first, without
// requiring an order yet. See
// supabase/migrations/20260918100000_quote_direct_invoice_conversion.sql.
export const QUOTE_INVOICE_CONVERSION_ERROR_MESSAGES = {
  QUOTE_INVOICE_FINANCE_PERMISSION_REQUIRED: "You do not have permission to create invoices from quotes.",
  QUOTE_NOT_FOUND: "This quote could not be found.",
  QUOTE_TENANT_ACCESS_DENIED: "You do not have access to this quote's workspace.",
  QUOTE_ORDER_ALREADY_EXISTS: "This quote already has an order — create the invoice from that order instead.",
  QUOTE_NOT_CONVERTIBLE: "Only an accepted quote can be invoiced directly.",
  QUOTE_NO_ACCEPTED_SNAPSHOT: "This quote has no accepted snapshot to invoice from.",
  QUOTE_ACCEPTED_SNAPSHOT_MISSING: "The accepted quote snapshot could not be found.",
  QUOTE_SNAPSHOT_EMPTY_ITEMS: "The accepted quote has no line items to invoice.",
};

function quoteInvoiceConversionError(error) {
  const raw = String(error?.message || "");
  const code = Object.keys(QUOTE_INVOICE_CONVERSION_ERROR_MESSAGES).find((candidate) => raw.includes(candidate));
  return Object.assign(
    new Error(code ? QUOTE_INVOICE_CONVERSION_ERROR_MESSAGES[code] : raw || "Could not create an invoice from this quote."),
    { code: code || error?.code || "QUOTE_INVOICE_CONVERSION_FAILED", cause: error },
  );
}

// Create an invoice directly from an accepted quote (no order required).
// Idempotent — calling this again on a quote that already has a direct
// invoice returns the SAME invoice (data.replayed === true). Refuses
// (QUOTE_ORDER_ALREADY_EXISTS) if the quote already has an order — that
// invoice belongs to the existing Order -> Invoice path instead.
export async function convertQuoteToInvoice(quoteId) {
  ensureSupabase();
  const { data, error } = await supabase.rpc("convert_quote_to_invoice", { p_quote_id: quoteId });
  if (error) throw quoteInvoiceConversionError(error);
  if (!data?.ok || !data?.invoice_id) {
    throw Object.assign(new Error("Creating this invoice returned an incomplete result."), { code: "QUOTE_INVOICE_CONVERSION_RESULT_INVALID" });
  }
  return data;
}

// ── create-from-request prefill (pure, no I/O) ──────────────────────────
// Only builds an unsaved editor draft. The link to
// client_quote_requests.id is written ONLY when saveQuoteWithItems
// succeeds (source_request_id passed above, create path only). Opening
// the editor never marks the request actioned and never activates an order.
export function quoteDraftFromClientRequest(request = {}) {
  const payload = request.payload || {};
  const detailLines = [
    payload.project_name ? `Project: ${payload.project_name}` : null,
    payload.quantity ? `Requested quantity: ${payload.quantity}` : null,
    payload.deadline ? `Requested deadline: ${payload.deadline}` : null,
    payload.details ? `\nClient notes:\n${payload.details}` : null,
  ].filter(Boolean).join("\n");

  return {
    id: null,
    source_request_id: request.id || null,
    customer_id: request.client_id || null,
    customer_name: request.client_name || request.client_email || "",
    customer_email: request.client_email || "",
    currency_code: "ZAR",
    reference_number: payload.project_name ? String(payload.project_name).slice(0, 120) : "",
    // staff-facing draft context only — goes into the internal notes field,
    // never into a customer-visible field
    notes: detailLines || "",
    valid_until: "",
    payment_terms: "",
    terms: "",
    shipping_charge: 0,
    items: [
      {
        line_key: `req-${request.id || "new"}`,
        role: "product",
        item_name: payload.project_name ? String(payload.project_name).slice(0, 160) : "Quote item",
        item_description: "",
        quantity: 1,
        unit: "",
        rate: 0,
        discount: 0,
        tax_name: "",
        tax_percentage: 0,
      },
    ],
  };
}
