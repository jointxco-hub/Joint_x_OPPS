import { Search, Plus, ChevronLeft, ChevronRight, FileText, AlertTriangle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import QuoteStatusBadge from "./QuoteStatusBadge";
import { QUOTE_STATUSES } from "./quoteStatus";

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function dateText(value, fallback = "—") {
  return value ? String(value).slice(0, 10) : fallback;
}

export default function QuoteList({
  quotes = [],
  isLoading,
  isError = false,
  error = null,
  filters,
  onFiltersChange,
  page,
  pageSize,
  count,
  onPageChange,
  onCreate,
  onSelect,
}) {
  const totalPages = Math.max(Math.ceil((count || 0) / pageSize), 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Quotes</h2>
          <p className="text-sm text-muted-foreground">{count || 0} records. Most recently updated first.</p>
        </div>
        <Button onClick={onCreate} className="hidden h-10 rounded-xl md:inline-flex">
          <Plus className="h-4 w-4" /> Create quote
        </Button>
      </div>

      <Card className="rounded-2xl border-border shadow-apple-sm">
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_170px_150px_150px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.search}
                onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
                placeholder="Search customer"
                className="h-10 rounded-xl pl-10"
              />
            </div>
            <Input
              value={filters.quoteNumber}
              onChange={(event) => onFiltersChange({ ...filters, quoteNumber: event.target.value })}
              placeholder="Quote number"
              className="h-10 rounded-xl"
            />
            <Select value={filters.status} onValueChange={(status) => onFiltersChange({ ...filters, status })}>
              <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {QUOTE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>{status.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={filters.dateFrom} onChange={(event) => onFiltersChange({ ...filters, dateFrom: event.target.value })} type="date" className="h-10 rounded-xl" />
            <Input value={filters.dateTo} onChange={(event) => onFiltersChange({ ...filters, dateTo: event.target.value })} type="date" className="h-10 rounded-xl" />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card className="rounded-2xl border-border p-8 text-center text-sm text-muted-foreground">Loading quotes...</Card>
      ) : isError ? (
        <Card className="rounded-2xl border-red-200 bg-red-50 p-10 text-center shadow-apple-sm">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <h3 className="text-lg font-semibold text-red-900">Could not load quotes</h3>
          <p className="mt-2 text-sm text-red-700">{error?.message || "Something went wrong loading quotes for your account."}</p>
        </Card>
      ) : quotes.length === 0 ? (
        <Card className="rounded-2xl border-border p-10 text-center shadow-apple-sm">
          <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="text-lg font-semibold text-foreground">Create your first quote</h3>
          <p className="mt-2 text-sm text-muted-foreground">Start from scratch or from a client quote request.</p>
          <Button onClick={onCreate} className="mt-5 rounded-xl">
            <Plus className="h-4 w-4" /> Create quote
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-apple-sm md:block">
            <div className="grid grid-cols-[1.1fr_1.4fr_1fr_1fr_1fr_0.7fr_1fr] gap-3 border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Quote</span>
              <span>Customer</span>
              <span>Status</span>
              <span>Total</span>
              <span>Valid until</span>
              <span>Rev</span>
              <span>Updated</span>
            </div>
            {quotes.map((quote) => (
              <button
                key={quote.id}
                onClick={() => onSelect(quote)}
                className="grid w-full grid-cols-[1.1fr_1.4fr_1fr_1fr_1fr_0.7fr_1fr] gap-3 border-b border-border px-4 py-4 text-left text-sm transition-all last:border-0 hover:bg-secondary/40"
              >
                <span className="flex items-center gap-1.5 font-semibold text-foreground">
                  {quote.quote_number}
                  {quote.has_unsent_changes ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title={`Unsent changes — customer sees rev #${quote.published_revision_number}`} />
                  ) : null}
                  {quote.has_source_request ? <Inbox className="h-3.5 w-3.5 text-muted-foreground" title="From a client request" /> : null}
                </span>
                <span className="min-w-0 truncate text-muted-foreground">{quote.customer_name}</span>
                <QuoteStatusBadge status={quote.status} />
                <span className="font-semibold text-foreground">{money(quote.total)}</span>
                <span className="text-muted-foreground">{dateText(quote.valid_until)}</span>
                <span className="text-muted-foreground">{quote.current_revision_number != null ? `#${quote.current_revision_number}` : "—"}</span>
                <span className="text-muted-foreground">{dateText(quote.updated_at)}</span>
              </button>
            ))}
          </div>

          <div className="space-y-3 md:hidden">
            {quotes.map((quote) => (
              <button key={quote.id} onClick={() => onSelect(quote)} className="w-full rounded-xl border border-border bg-card p-3 text-left shadow-apple-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                      {quote.quote_number}
                      {quote.has_unsent_changes ? <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Unsent changes" /> : null}
                      {quote.has_source_request ? <Inbox className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{quote.customer_name}</p>
                  </div>
                  <QuoteStatusBadge status={quote.status} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
                  <span className="font-semibold text-foreground">{money(quote.total)}</span>
                  <span className="text-muted-foreground">Valid {dateText(quote.valid_until)}</span>
                  <span className="text-muted-foreground">
                    Rev {quote.current_revision_number != null ? `#${quote.current_revision_number}` : "—"} · {dateText(quote.updated_at)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => onPageChange(Math.max(page - 1, 1))} disabled={page <= 1} className="rounded-xl">
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <Button variant="outline" size="sm" onClick={() => onPageChange(Math.min(page + 1, totalPages))} disabled={page >= totalPages} className="rounded-xl">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
