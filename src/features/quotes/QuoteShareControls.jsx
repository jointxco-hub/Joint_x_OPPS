import { useState } from "react";
import { Check, Copy, Link2, Link2Off, RefreshCw, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { buildPublicQuoteUrl } from "@/api/quotes";
import { canShareQuote, hasActiveQuoteShare } from "./quoteStatus";

// Q3.1 — OPPS staff controls for the public /q/:token customer quote link.
//
// Every action is delegated to a parent callback that calls exactly one
// canonical RPC (issue_quote / rotate_quote_share_token /
// revoke_quote_share). This component never touches Supabase directly and
// never mutates opps_quotes. It only *reads* share state off the quote row
// (share_token / public_visible / share_revoked_at / share_expires_at) to
// decide which controls to show.
//
// Not rendered at all for draft / never-sent quotes (canShareQuote).

async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the execCommand path */
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "-1000px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export default function QuoteShareControls({
  quote,
  isIssuing = false,
  isRotating = false,
  isRevoking = false,
  onIssue,
  onRotate,
  onRevoke,
}) {
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'rotate' | 'revoke' | null

  if (!canShareQuote(quote)) return null;

  const active = hasActiveQuoteShare(quote);
  const publicUrl = active ? buildPublicQuoteUrl(quote.share_token) : "";
  const busy = isIssuing || isRotating || isRevoking;
  const expiresText = quote?.share_expires_at
    ? new Date(quote.share_expires_at).toLocaleDateString()
    : null;
  const wasRevoked = Boolean(quote?.share_revoked_at) && !active;

  const handleCopy = async () => {
    if (!publicUrl) return;
    const ok = await copyToClipboard(publicUrl);
    if (ok) {
      setCopied(true);
      toast.success("Public link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Could not copy automatically — the link is shown above, copy it manually.");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3 md:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">Public link</p>
        {active ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            <Link2 className="h-3 w-3" /> Live
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            <Link2Off className="h-3 w-3" /> {wasRevoked ? "Revoked" : "Not shared"}
          </span>
        )}
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        A no-login page showing only the sent revision. Accept / Request changes / Decline happen there.
        {expiresText ? ` Link expires ${expiresText}.` : ""}
      </p>

      {active ? (
        <>
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={publicUrl}>
              {publicUrl}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleCopy}
              disabled={busy}
              className="h-11 rounded-xl sm:h-9"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy public link"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirm("rotate")}
              disabled={busy}
              className="h-11 rounded-xl sm:h-9"
            >
              <RefreshCw className={`h-4 w-4 ${isRotating ? "animate-spin" : ""}`} />
              {isRotating ? "Rotating..." : "Rotate link"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirm("revoke")}
              disabled={busy}
              className="h-11 rounded-xl text-destructive hover:text-destructive sm:h-9"
            >
              <Link2Off className="h-4 w-4" />
              {isRevoking ? "Revoking..." : "Revoke link"}
            </Button>
          </div>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          onClick={() => onIssue?.(quote)}
          disabled={busy}
          className="h-11 rounded-xl sm:h-9"
        >
          <Share2 className="h-4 w-4" />
          {isIssuing ? "Creating link..." : wasRevoked ? "Re-issue public link" : "Share quote"}
        </Button>
      )}

      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Rotate the public link?"
        description="A new link is generated and the current one stops working immediately. Anyone who already has the old link — including the customer — will need the new one."
        confirmText="Rotate link"
        onConfirm={() => { setConfirm(null); onRotate?.(quote); }}
      />
      <ConfirmDialog
        open={confirm === "revoke"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Revoke the public link?"
        description="The link is taken offline right away and the customer can no longer open the quote. Revision history is kept. You can issue a new link later."
        confirmText="Revoke link"
        variant="destructive"
        onConfirm={() => { setConfirm(null); onRevoke?.(quote); }}
      />
    </div>
  );
}
