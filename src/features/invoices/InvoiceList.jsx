import { Search, Plus, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import InvoiceStatusBadge from "./InvoiceStatusBadge";

const statuses = [
  "all",
  "draft",
  "approved",
  "exported",
  "imported_to_zoho",
  "paid",
  "partially_paid",
  "overdue",
  "void",
];

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return "No date";
  return String(value).slice(0, 10);
}

export default function InvoiceList({
  invoices = [],
  isLoading,
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
          <h2 className="text-lg font-semibold text-foreground">Invoices</h2>
          <p className="text-sm text-muted-foreground">{count || 0} records. Line items load only when an invoice opens.</p>
        </div>
        <Button onClick={onCreate} className="h-10 rounded-xl">
          <Plus className="h-4 w-4" /> Create invoice
        </Button>
      </div>

      <Card className="rounded-2xl border-border shadow-apple-sm">
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_160px_160px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.search}
                onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
                placeholder="Search customer"
                className="h-10 rounded-xl pl-10"
              />
            </div>
            <Select value={filters.status} onValueChange={(status) => onFiltersChange({ ...filters, status })}>
              <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {statuses.map((status) => (
                  <SelectItem key={status} value={status}>{status === "all" ? "All statuses" : status.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={filters.dateFrom} onChange={(event) => onFiltersChange({ ...filters, dateFrom: event.target.value })} type="date" className="h-10 rounded-xl" />
            <Input value={filters.dateTo} onChange={(event) => onFiltersChange({ ...filters, dateTo: event.target.value })} type="date" className="h-10 rounded-xl" />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card className="rounded-2xl border-border p-8 text-center text-sm text-muted-foreground">Loading invoices...</Card>
      ) : invoices.length === 0 ? (
        <Card className="rounded-2xl border-border p-10 text-center shadow-apple-sm">
          <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="text-lg font-semibold text-foreground">Create your first invoice</h3>
          <p className="mt-2 text-sm text-muted-foreground">Start from an order or create one manually.</p>
          <Button onClick={onCreate} className="mt-5 rounded-xl">
            <Plus className="h-4 w-4" /> Create invoice
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-apple-sm md:block">
            <div className="grid grid-cols-[1.2fr_1.4fr_1fr_1fr_1fr_1fr] gap-3 border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Invoice</span>
              <span>Customer</span>
              <span>Date</span>
              <span>Status</span>
              <span>Total</span>
              <span>Balance</span>
            </div>
            {invoices.map((invoice) => (
              <button
                key={invoice.id}
                onClick={() => onSelect(invoice)}
                className="grid w-full grid-cols-[1.2fr_1.4fr_1fr_1fr_1fr_1fr] gap-3 border-b border-border px-4 py-4 text-left text-sm transition-all last:border-0 hover:bg-secondary/40"
              >
                <span className="font-semibold text-foreground">{invoice.invoice_number}</span>
                <span className="min-w-0 truncate text-muted-foreground">{invoice.customer_name}</span>
                <span className="text-muted-foreground">{formatDate(invoice.invoice_date)}</span>
                <InvoiceStatusBadge status={invoice.status} />
                <span className="font-semibold text-foreground">{money(invoice.total)}</span>
                <span className="font-semibold text-foreground">{money(invoice.balance_due)}</span>
              </button>
            ))}
          </div>

          <div className="space-y-3 md:hidden">
            {invoices.map((invoice) => (
              <button key={invoice.id} onClick={() => onSelect(invoice)} className="w-full rounded-xl border border-border bg-card p-3 text-left shadow-apple-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{invoice.invoice_number}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{invoice.customer_name}</p>
                  </div>
                  <InvoiceStatusBadge status={invoice.status} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
                  <span className="text-muted-foreground">{formatDate(invoice.invoice_date)}</span>
                  <span className="font-semibold text-foreground">{money(invoice.total)}</span>
                  <span className="font-semibold text-foreground">{money(invoice.balance_due)}</span>
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
