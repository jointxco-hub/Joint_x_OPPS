import { useState } from "react";
import { Eye, MoreHorizontal, Pencil, RefreshCw, Send, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from "@/components/ui/drawer";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { CommercialDocument, buildQuoteDocumentModel } from "@/features/commercial-doc";
import QuoteStatusBadge from "./QuoteStatusBadge";
import QuoteRevisionHistory from "./QuoteRevisionHistory";
import QuoteShareControls from "./QuoteShareControls";
import {
  isQuoteEditable, HAS_QUOTE_SEND_TRANSITION, canSendQuote, hasUnsentChanges, isPublished,
} from "./quoteStatus";

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function dateText(value, fallback = "—") {
  return value ? String(value).slice(0, 10) : fallback;
}
function when(value) {
  if (!value) return "";
  try { return new Date(value).toLocaleString(); } catch { return String(value).slice(0, 19); }
}

const EVENT_LABELS = {
  created: "Quote created",
  revised: "Quote revised",
  sent: "Sent to customer",
  viewed: "Viewed by customer",
  accepted: "Accepted",
  changes_requested: "Changes requested",
  declined: "Declined",
  expired: "Expired",
  converted: "Converted to order",
  share_issued: "Public link issued",
  share_revoked: "Public link revoked",
  share_rotated: "Public link rotated",
};

// Same interaction language as InvoiceDetailDrawer: bottom Drawer,
// max-w-4xl, header with number + customer + status badge, scrollable
// body, a nested Dialog for the document preview. NO invoice-only actions
// (Mark paid / Pay / Re-export / Imported / payment ledger / share) and NO
// customer acceptance actions (that is Q4).
export default function QuoteDetailDrawer({
  open,
  quote,
  summaryQuote,
  revisions = [],
  events = [],
  publishedDocument = null,   // accepted ?? published revision — the formal offer
  draftDocument = null,       // current working revision — DRAFT preview only
  isLoading = false,
  isRevisionsLoading = false,
  isSending = false,
  isIssuingShare = false,
  isRotatingShare = false,
  isRevokingShare = false,
  loadError = null,
  onOpenChange,
  onEdit,
  onRevise,
  onSend,
  onIssueShare,
  onRotateShare,
  onRevokeShare,
}) {
  const header = quote || summaryQuote || {};
  const status = header.status || "draft";
  const unsent = hasUnsentChanges(quote || header);
  const published = isPublished(quote || header);

  // preview: default to the published/formal quote when one exists,
  // otherwise the draft (current head).
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewVariant, setPreviewVariant] = useState("published");
  const openPreview = () => {
    setPreviewVariant(publishedDocument ? "published" : "draft");
    setPreviewOpen(true);
  };
  const previewDoc = previewVariant === "draft" ? draftDocument : (publishedDocument || draftDocument);
  const previewIsDraft = previewVariant === "draft" || (!publishedDocument && Boolean(draftDocument));

  // Edit / Revise — same handler, label depends on whether the customer
  // has already been shown something.
  const editAction = (() => {
    if (["draft"].includes(status)) return { label: "Edit", icon: Pencil, fn: () => onEdit?.(quote) };
    if (["sent", "viewed", "changes_requested", "expired"].includes(status)) {
      return { label: "Revise", icon: RefreshCw, fn: () => onRevise?.(quote) };
    }
    return null; // accepted / declined / converted → preview only
  })();

  const showSend =
    HAS_QUOTE_SEND_TRANSITION && canSendQuote(quote || header) &&
    (["draft", "changes_requested"].includes(status) || unsent);
  const sendLabel = published ? "Resend updated quote" : "Send quote";

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-h-[92vh] max-w-4xl rounded-t-2xl md:rounded-t-3xl">
        <DrawerHeader className="border-b border-border px-4 py-3 text-left md:px-6 md:py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <DrawerTitle className="flex flex-wrap items-center gap-2">
                {header.quote_number || "Quote"}
                <QuoteStatusBadge status={status} />
                {header.current_revision_number != null ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    working rev #{header.current_revision_number}
                    {header.published_revision_number != null && header.published_revision_number !== header.current_revision_number
                      ? ` · sent #${header.published_revision_number}`
                      : ""}
                  </span>
                ) : null}
                {unsent ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                    <TriangleAlert className="h-3 w-3" />
                    Unsent changes{header.published_revision_number != null ? ` — customer sees rev #${header.published_revision_number}` : ""}
                  </span>
                ) : null}
              </DrawerTitle>
              <DrawerDescription>{header.customer_name || (isLoading ? "Loading quote..." : "Quote")}</DrawerDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={openPreview} disabled={!publishedDocument && !draftDocument} className="h-11 rounded-xl sm:h-9">
                <Eye className="h-4 w-4" /> Preview
              </Button>
              {editAction ? (
                <Button size="sm" onClick={editAction.fn} disabled={!quote || !isQuoteEditable(status)} className="h-11 rounded-xl sm:h-9">
                  <editAction.icon className="h-4 w-4" /> {editAction.label}
                </Button>
              ) : null}
              {showSend ? (
                <Button
                  variant={unsent ? "default" : "outline"}
                  size="sm"
                  onClick={() => onSend?.(quote)}
                  disabled={!quote || isSending}
                  className="h-11 rounded-xl sm:h-9"
                >
                  <Send className="h-4 w-4" /> {isSending ? "Sending..." : sendLabel}
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" className="h-11 w-11 rounded-xl p-0 sm:h-9 sm:w-9" aria-label="More">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DrawerHeader>

        <div className="overflow-y-auto px-3 py-4 md:px-6 md:py-5">
          {loadError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              This quote could not be loaded. Close and reopen it before editing.
            </div>
          ) : isLoading || !quote ? (
            <div className="rounded-2xl border border-border bg-secondary/30 p-6 text-sm text-muted-foreground">Loading quote details...</div>
          ) : (
            <div className="space-y-4 md:space-y-5">
              {unsent ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" />
                  <p>
                    You have edited this quote since it was sent. The customer still sees
                    <strong> revision #{quote.published_revision_number}</strong>. Use
                    <strong> Resend updated quote</strong> to publish revision #{quote.current_revision_number} as the new offer.
                  </p>
                </div>
              ) : null}

              {/* customer */}
              <Section title="Customer">
                <Kv label="Name" value={quote.customer_name} />
                {quote.customer_email ? <Kv label="Email" value={quote.customer_email} /> : null}
                {quote.customer_phone ? <Kv label="Phone" value={quote.customer_phone} /> : null}
                {quote.customer_whatsapp ? <Kv label="WhatsApp" value={quote.customer_whatsapp} /> : null}
                {quote.customer_billing_address ? <Kv label="Billing" value={quote.customer_billing_address} /> : null}
                {quote.shipping_address ? <Kv label="Ship to" value={quote.shipping_address} /> : null}
                <Kv label="Reference" value={quote.reference_number || "—"} />
                <Kv label="Valid until" value={dateText(quote.valid_until)} />
                <Kv label="Payment terms" value={quote.payment_terms || "—"} />
              </Section>

              {/* line items (working head) */}
              <Section title={`Line items — working rev #${quote.current_revision_number ?? "?"} (${(quote.items || []).length})`}>
                <div className="divide-y divide-border">
                  {(quote.items || []).map((item) => (
                    <div key={item.id || item.line_number} className="flex items-start justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">
                          {item.item_name}
                          {item.role && item.role !== "product" ? (
                            <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{item.role.replace(/_/g, " ")}</span>
                          ) : null}
                        </p>
                        {item.item_description ? <p className="text-xs text-muted-foreground">{item.item_description}</p> : null}
                        <p className="text-xs text-muted-foreground">
                          {item.quantity}{item.unit ? ` ${item.unit}` : ""} × {money(item.rate)}
                          {Number(item.discount) ? ` · less ${money(item.discount)}` : ""}
                          {Number(item.tax_percentage) ? ` · ${item.tax_name || "tax"} ${item.tax_percentage}%` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 font-semibold text-foreground">{money(item.item_total)}</span>
                    </div>
                  ))}
                </div>
              </Section>

              {(quote.notes || quote.terms) ? (
                <Section title="Notes & terms">
                  {quote.notes ? <p className="whitespace-pre-wrap text-sm text-muted-foreground"><span className="font-semibold text-foreground">Internal: </span>{quote.notes}</p> : null}
                  {quote.terms ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground"><span className="font-semibold text-foreground">Customer terms: </span>{quote.terms}</p> : null}
                </Section>
              ) : null}

              <Section title="Totals (working revision)">
                <Kv label="Subtotal" value={money(quote.subtotal)} />
                {Number(quote.discount_total) ? <Kv label="Discount" value={`- ${money(quote.discount_total)}`} /> : null}
                {Number(quote.shipping_charge) ? <Kv label="Shipping" value={money(quote.shipping_charge)} /> : null}
                {Number(quote.tax_total) ? <Kv label="Tax" value={money(quote.tax_total)} /> : null}
                <Kv label="Quote total" value={money(quote.total)} strong />
                {quote.total_override_reason ? <Kv label="Override reason" value={quote.total_override_reason} /> : null}
              </Section>

              <QuoteShareControls
                quote={quote}
                isIssuing={isIssuingShare}
                isRotating={isRotatingShare}
                isRevoking={isRevokingShare}
                onIssue={onIssueShare}
                onRotate={onRotateShare}
                onRevoke={onRevokeShare}
              />

              <QuoteRevisionHistory
                revisions={revisions}
                currentRevisionId={quote.current_revision_id}
                publishedRevisionId={quote.published_revision_id}
                acceptedRevisionId={quote.accepted_revision_id}
                isLoading={isRevisionsLoading}
              />

              <Section title="Activity">
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity yet.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {events.map((ev) => {
                      // A customer's change-request message / decline reason is
                      // stored on the event's `note` by the public-link RPCs. It
                      // is the only note staff must be able to read in full.
                      const isCustomerResponse =
                        ev.actor_kind === "public_link" &&
                        (ev.event_type === "changes_requested" || ev.event_type === "declined");
                      const noteLabel =
                        ev.event_type === "declined" && isCustomerResponse
                          ? "Decline reason from customer"
                          : isCustomerResponse
                            ? "Message from customer"
                            : "Note";
                      return (
                        <li key={ev.id} className="text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-foreground">
                              {EVENT_LABELS[ev.event_type] || ev.event_type}
                              {ev.event_type === "sent" && ev?.metadata?.resend ? " (resend)" : ""}
                              {ev.actor_label ? ` — ${ev.actor_label}` : ""}
                            </span>
                            <span className="text-xs text-muted-foreground">{when(ev.created_at)}</span>
                          </div>
                          {ev.note ? (
                            <div
                              className={`mt-1 rounded-lg border px-3 py-2 text-sm ${
                                isCustomerResponse
                                  ? "border-amber-200 bg-amber-50 text-amber-900"
                                  : "border-border bg-secondary/30 text-muted-foreground"
                              }`}
                            >
                              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide">
                                {noteLabel}
                              </p>
                              <p className="whitespace-pre-wrap break-words">{ev.note}</p>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
            </div>
          )}
        </div>
      </DrawerContent>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {previewIsDraft ? "Draft preview" : "Published quote"} — {header.quote_number}
            </DialogTitle>
          </DialogHeader>

          {publishedDocument && draftDocument ? (
            <div className="mb-3 inline-flex rounded-xl bg-secondary/60 p-1 text-xs">
              <button
                type="button"
                onClick={() => setPreviewVariant("published")}
                className={`rounded-lg px-3 py-1.5 font-semibold ${!previewIsDraft ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                Published quote
              </button>
              <button
                type="button"
                onClick={() => setPreviewVariant("draft")}
                className={`rounded-lg px-3 py-1.5 font-semibold ${previewIsDraft ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                Draft preview (rev #{draftDocument.revision_number ?? "?"})
              </button>
            </div>
          ) : null}

          {previewDoc ? (
            <CommercialDocument
              kind="quote"
              document={buildQuoteDocumentModel(previewDoc)}
              mode="responsive"
              draftPreview={previewIsDraft}
            />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">Preview unavailable — this quote has no saved revision yet.</p>
          )}
        </DialogContent>
      </Dialog>
    </Drawer>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 md:p-4">
      <p className="mb-2 text-sm font-semibold text-foreground">{title}</p>
      {children}
    </div>
  );
}
function Kv({ label, value, strong = false }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right ${strong ? "font-semibold text-foreground" : "text-foreground"}`}>{value}</span>
    </div>
  );
}
