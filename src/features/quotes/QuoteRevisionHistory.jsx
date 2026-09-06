import { History } from "lucide-react";

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function when(value) {
  if (!value) return "";
  try { return new Date(value).toLocaleString(); } catch { return String(value).slice(0, 19); }
}

// Read-only in Q2. No rollback-to-revision (not trivial/safe yet — a
// "revert" would still have to go through save_opps_quote_with_items and
// mint a NEW revision, which is a deliberate Q3+ decision).
export default function QuoteRevisionHistory({
  revisions = [],
  currentRevisionId = null,
  publishedRevisionId = null,
  acceptedRevisionId = null,
  isLoading = false,
}) {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3 md:p-4">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <History className="h-4 w-4" /> Revision history
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading revisions...</p>
      ) : revisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No revisions yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {revisions.map((rev) => {
            const isCurrent = rev.id === currentRevisionId;
            const isPublished = rev.id === publishedRevisionId;
            const isAccepted = rev.id === acceptedRevisionId;
            return (
              <li
                key={rev.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                  isCurrent ? "border-primary/30 bg-primary/5" : "border-border bg-card"
                }`}
              >
                <span className="flex items-center gap-2 font-semibold text-foreground">
                  Revision #{rev.revision_number}
                  {isCurrent ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">current</span> : null}
                  {isPublished ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700">published · live offer</span> : null}
                  {isAccepted ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">accepted</span> : null}
                </span>
                <span className="text-muted-foreground">{when(rev.created_at)}</span>
                <span className="font-semibold text-foreground">{money(rev.total)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
