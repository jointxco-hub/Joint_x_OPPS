import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";

function formatMoney(value) {
  return `R${Number(value || 0).toLocaleString()}`;
}

// Shared presentational shell for a Quote/Invoice line-item card: numbered
// header, collapse/expand control, a one-glance collapsed summary, and
// consistent mobile spacing + remove-button placement. Domain-specific
// fields (role selector, media editor, DTF calculator, product picker,
// etc.) stay inside the Quote/Invoice editors and are passed in as
// `children`, rendered only while expanded. Expand/collapse is purely
// local UI state owned by the caller — this component has no knowledge
// of, and never touches, the underlying item data.
export default function LineItemCard({
  index,
  label = "Line",
  itemName,
  quantity,
  rate,
  total,
  expanded,
  onToggleExpand,
  onRemove,
  removeLabel,
  badges = null,
  headerActions = null,
  children,
}) {
  const displayName = String(itemName || "").trim() || "New item";

  return (
    <div className="rounded-xl border border-border bg-card p-2.5 shadow-apple-sm md:p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label.toLowerCase()} ${index + 1}`}
          className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-lg py-1 text-left sm:min-h-8"
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {label} {index + 1}
            </span>
            {badges ? <span className="mt-1 flex flex-wrap items-center gap-2">{badges}</span> : null}
            {!expanded ? (
              <span className="mt-1 block">
                <span className="block truncate text-sm font-medium text-foreground">
                  {index + 1} · {displayName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Qty {Number(quantity || 0)} · {formatMoney(rate)} each · {formatMoney(total)}
                </span>
              </span>
            ) : null}
          </span>
        </button>
        <div className="flex flex-none items-center gap-1">
          {headerActions}
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeLabel}
            className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive sm:h-8 sm:w-8"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {expanded ? <div className="grid gap-3 md:grid-cols-12">{children}</div> : null}
    </div>
  );
}
