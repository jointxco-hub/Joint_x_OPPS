import React, { useState, useMemo, useCallback } from "react";
import { format, parseISO, isValid, startOfDay, endOfDay } from "date-fns";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  Search, Filter, ChevronDown, ChevronUp, Archive, Trash2,
  Tag, MoreHorizontal, ArrowUpDown, AlertTriangle, X,
  ExternalLink, TestTube, Eye, EyeOff, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  EXPENSE_CATEGORIES, REVENUE_CATEGORIES, TRANSACTION_SOURCES,
  LEGACY_CATEGORY_MAP, getExpenseCategoryLabel, getRevenueCategoryLabel,
} from "./FinanceCategories";
import { canDeleteTransactions, canArchiveTransactions, canMarkTestTransactions, canEditTransactions } from "@/lib/financeAccess";

// ── Normalise raw DB rows into a unified shape ────────────────

function normalisePayment(p) {
  return {
    id: p.id,
    rawType: "income",
    date: p.payment_date || p.date || p.created_at,
    description: p.client_name
      ? `${p.client_name}${p.order_number ? ` · ${p.order_number}` : ""}`
      : (p.notes || "Income"),
    category: p.category || "product_sales",
    subcategory: p.subcategory || "",
    amount: p.amount || 0,
    status: p.payment_status || p.status || "completed",
    source: p.source || (p.order_id ? "xlab_order" : p.is_offline ? "opps" : "manual_income"),
    linkedOrderId: p.order_id,
    linkedOrderNumber: p.order_number,
    linkedClient: p.client_name,
    createdBy: p.submitted_by || "",
    notes: p.notes || "",
    isTest: !!p.is_test,
    isArchived: !!p.is_archived,
    excludedFromReports: !!p.excluded_from_reports,
    archivedAt: p.archived_at,
    archivedBy: p.archived_by,
    invoiceNumber: p.invoice_number,
    taxAmount: p.tax_amount || 0,
    createdAt: p.created_at,
  };
}

function normaliseExpense(e) {
  const rawCat = e.expense_category || e.category || "";
  const category = LEGACY_CATEGORY_MAP[rawCat] || rawCat || "other_expense";
  return {
    id: e.id,
    rawType: "expense",
    date: e.expense_date || e.date || e.created_at,
    description: e.vendor || e.notes || "Expense",
    category,
    subcategory: e.subcategory || "",
    amount: e.amount || 0,
    status: e.approval_status === "approved" ? "approved"
      : e.approval_status === "submitted" ? "pending"
      : e.approval_status === "rejected" ? "rejected"
      : "paid",
    source: e.source || "manual_expense",
    linkedOrderId: null,
    linkedClient: e.client_id || null,
    createdBy: e.submitted_by || "",
    notes: e.notes || "",
    vendor: e.vendor || "",
    vatType: e.vat_type,
    vatAmount: e.vat_amount || 0,
    isTest: !!e.is_test,
    isArchived: !!e.is_archived,
    excludedFromReports: !!e.excluded_from_reports,
    archivedAt: e.archived_at,
    archivedBy: e.archived_by,
    approvalStatus: e.approval_status,
    createdAt: e.created_at,
  };
}

// ── Small badge/pill helpers ──────────────────────────────────

function Badge({ label, cls }) {
  return <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function StatusBadge({ status }) {
  const map = {
    completed: ["Paid",        "bg-green-100 text-green-700"],
    paid:      ["Paid",        "bg-green-100 text-green-700"],
    approved:  ["Approved",    "bg-green-100 text-green-700"],
    pending:   ["Pending",     "bg-yellow-100 text-yellow-700"],
    submitted: ["Submitted",   "bg-blue-100 text-blue-700"],
    outstanding:["Outstanding","bg-orange-100 text-orange-700"],
    refunded:  ["Refunded",    "bg-purple-100 text-purple-700"],
    failed:    ["Failed",      "bg-red-100 text-red-700"],
    rejected:  ["Rejected",    "bg-red-100 text-red-700"],
    test:      ["Test",        "bg-slate-100 text-slate-600"],
  };
  const [label, cls] = map[status] || [status, "bg-secondary text-muted-foreground"];
  return <Badge label={label} cls={cls} />;
}

// ── Supabase mutation helpers ─────────────────────────────────

async function patchTransaction(id, patch) {
  if (!supabase) throw new Error("Supabase not configured");
  const { error } = await supabase.from("transactions").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Action menu for a single row ─────────────────────────────

function RowActions({ tx, user, onRefetch }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handle = useCallback(async (action) => {
    setOpen(false);
    try {
      if (action === "archive") {
        await patchTransaction(tx.id, {
          is_archived: true,
          archived_at: new Date().toISOString(),
          archived_by: user?.email || "unknown",
        });
        toast.success("Transaction archived");
      } else if (action === "unarchive") {
        await patchTransaction(tx.id, { is_archived: false, archived_at: null, archived_by: null });
        toast.success("Transaction unarchived");
      } else if (action === "mark_test") {
        await patchTransaction(tx.id, { is_test: true });
        toast.success("Marked as test transaction");
      } else if (action === "unmark_test") {
        await patchTransaction(tx.id, { is_test: false });
        toast.success("Removed test flag");
      } else if (action === "exclude") {
        await patchTransaction(tx.id, { excluded_from_reports: true });
        toast.success("Excluded from reports");
      } else if (action === "include") {
        await patchTransaction(tx.id, { excluded_from_reports: false });
        toast.success("Included in reports");
      } else if (action === "delete") {
        setConfirming(true);
        return;
      } else if (action === "confirm_delete") {
        await supabase.from("transactions").delete().eq("id", tx.id);
        toast.success("Transaction permanently deleted");
        setConfirming(false);
      }
      onRefetch();
    } catch (err) {
      toast.error(err.message || "Action failed");
    }
  }, [tx.id, user?.email, onRefetch]);

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-red-600 font-medium">Delete permanently?</span>
        <button onClick={() => handle("confirm_delete")}
          className="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-lg font-semibold">Yes</button>
        <button onClick={() => setConfirming(false)}
          className="text-[10px] text-muted-foreground">Cancel</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="w-6 h-6 rounded-lg hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-all">
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-7 z-40 bg-card border border-border rounded-xl shadow-apple-xl py-1 w-48 text-sm">
            {canArchiveTransactions(user) && (
              <button onClick={() => handle(tx.isArchived ? "unarchive" : "archive")}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary text-left text-xs text-foreground">
                <Archive className="w-3.5 h-3.5 text-muted-foreground" />
                {tx.isArchived ? "Unarchive" : "Archive"}
              </button>
            )}
            {canMarkTestTransactions(user) && (
              <button onClick={() => handle(tx.isTest ? "unmark_test" : "mark_test")}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary text-left text-xs text-foreground">
                <TestTube className="w-3.5 h-3.5 text-muted-foreground" />
                {tx.isTest ? "Remove Test Flag" : "Mark as Test"}
              </button>
            )}
            {canMarkTestTransactions(user) && (
              <button onClick={() => handle(tx.excludedFromReports ? "include" : "exclude")}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary text-left text-xs text-foreground">
                {tx.excludedFromReports ? <Eye className="w-3.5 h-3.5 text-muted-foreground" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
                {tx.excludedFromReports ? "Include in Reports" : "Exclude from Reports"}
              </button>
            )}
            {canDeleteTransactions(user) && (
              <>
                <div className="border-t border-border my-1" />
                <button onClick={() => handle("delete")}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-red-50 text-left text-xs text-red-600">
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Permanently
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Export to CSV ─────────────────────────────────────────────

function exportCSV(rows) {
  const headers = ["Date","Type","Source","Description","Category","Amount","Status","Linked Order","Created By","Notes","Is Test","Is Archived"];
  const lines = rows.map(r => [
    r.date ? format(new Date(r.date), "yyyy-MM-dd") : "",
    r.rawType,
    TRANSACTION_SOURCES[r.source] || r.source,
    `"${(r.description || "").replace(/"/g, '""')}"`,
    r.rawType === "income" ? getRevenueCategoryLabel(r.category) : getExpenseCategoryLabel(r.category),
    r.rawType === "income" ? r.amount.toFixed(2) : (-r.amount).toFixed(2),
    r.status,
    r.linkedOrderNumber || "",
    r.createdBy || "",
    `"${(r.notes || "").replace(/"/g, '""')}"`,
    r.isTest ? "yes" : "no",
    r.isArchived ? "yes" : "no",
  ]);
  const csv = [headers.join(","), ...lines.map(l => l.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transactions-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: "date_desc",    label: "Newest first" },
  { value: "date_asc",     label: "Oldest first" },
  { value: "amount_desc",  label: "Amount (high → low)" },
  { value: "amount_asc",   label: "Amount (low → high)" },
  { value: "status",       label: "Status" },
  { value: "category",     label: "Category" },
];

export default function TransactionHistory({ payments = [], expenses = [], user, onRefetch }) {
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [showTestOnly, setShowTestOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [sortBy, setSortBy] = useState("date_desc");

  // Merge + normalise
  const allTransactions = useMemo(() => {
    const inc = payments.map(normalisePayment);
    const exp = expenses.map(normaliseExpense);
    return [...inc, ...exp];
  }, [payments, expenses]);

  // Filter
  const filtered = useMemo(() => {
    let rows = allTransactions;

    if (showTestOnly) {
      rows = rows.filter(r => r.isTest);
    } else if (!showArchived) {
      rows = rows.filter(r => !r.isArchived);
    }
    if (showArchived && !showTestOnly) {
      rows = rows.filter(r => r.isArchived);
    }

    if (filterType !== "all") {
      rows = rows.filter(r => r.rawType === filterType);
    }
    if (filterStatus !== "all") {
      rows = rows.filter(r => r.status === filterStatus);
    }
    if (filterSource !== "all") {
      rows = rows.filter(r => r.source === filterSource);
    }
    if (filterCategory !== "all") {
      rows = rows.filter(r => r.category === filterCategory);
    }
    if (filterDateFrom) {
      const from = startOfDay(new Date(filterDateFrom));
      rows = rows.filter(r => r.date && new Date(r.date) >= from);
    }
    if (filterDateTo) {
      const to = endOfDay(new Date(filterDateTo));
      rows = rows.filter(r => r.date && new Date(r.date) <= to);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.description?.toLowerCase().includes(q) ||
        r.notes?.toLowerCase().includes(q) ||
        r.linkedOrderNumber?.toLowerCase().includes(q) ||
        r.linkedClient?.toLowerCase().includes(q) ||
        r.createdBy?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [allTransactions, showTestOnly, showArchived, filterType, filterStatus, filterSource, filterCategory, filterDateFrom, filterDateTo, search]);

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === "date_desc") return new Date(b.date || 0) - new Date(a.date || 0);
      if (sortBy === "date_asc")  return new Date(a.date || 0) - new Date(b.date || 0);
      if (sortBy === "amount_desc") return b.amount - a.amount;
      if (sortBy === "amount_asc")  return a.amount - b.amount;
      if (sortBy === "status")   return (a.status || "").localeCompare(b.status || "");
      if (sortBy === "category") return (a.category || "").localeCompare(b.category || "");
      return 0;
    });
  }, [filtered, sortBy]);

  // Counts for quick pills
  const testCount     = useMemo(() => allTransactions.filter(r => r.isTest).length, [allTransactions]);
  const archivedCount = useMemo(() => allTransactions.filter(r => r.isArchived).length, [allTransactions]);
  const excludedCount = useMemo(() => allTransactions.filter(r => r.excludedFromReports).length, [allTransactions]);

  const resetFilters = () => {
    setSearch(""); setFilterType("all"); setFilterStatus("all");
    setFilterSource("all"); setFilterCategory("all");
    setFilterDateFrom(""); setFilterDateTo("");
    setShowTestOnly(false); setShowArchived(false);
  };

  const hasActiveFilters = search || filterType !== "all" || filterStatus !== "all" ||
    filterSource !== "all" || filterCategory !== "all" || filterDateFrom || filterDateTo ||
    showTestOnly || showArchived;

  return (
    <div className="space-y-4">

      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Transaction History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {sorted.length} records · all income &amp; expenses
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {testCount > 0 && (
            <button
              onClick={() => { setShowTestOnly(v => !v); setShowArchived(false); }}
              className={`text-xs px-3 py-1 rounded-full border font-medium transition-all ${showTestOnly ? "bg-amber-100 text-amber-700 border-amber-200" : "border-border text-muted-foreground hover:text-foreground"}`}>
              <TestTube className="w-3 h-3 inline mr-1" />{testCount} test
            </button>
          )}
          {archivedCount > 0 && (
            <button
              onClick={() => { setShowArchived(v => !v); setShowTestOnly(false); }}
              className={`text-xs px-3 py-1 rounded-full border font-medium transition-all ${showArchived ? "bg-slate-100 text-slate-700 border-slate-200" : "border-border text-muted-foreground hover:text-foreground"}`}>
              <Archive className="w-3 h-3 inline mr-1" />{archivedCount} archived
            </button>
          )}
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5 h-8"
            onClick={() => setShowFilters(v => !v)}>
            <Filter className="w-3.5 h-3.5" />
            Filters
            {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />}
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5 h-8"
            onClick={() => exportCSV(sorted)}>
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">Filters</p>
            {hasActiveFilters && (
              <button onClick={resetFilters} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Search */}
            <div className="col-span-2 md:col-span-4 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search description, client, order, notes…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-8 text-xs rounded-xl"
              />
            </div>
            {/* Type */}
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Type</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-8 text-xs rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Status */}
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-xs rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="completed">Paid</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="outstanding">Outstanding</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Source */}
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Source</Label>
              <Select value={filterSource} onValueChange={setFilterSource}>
                <SelectTrigger className="h-8 text-xs rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {Object.entries(TRANSACTION_SOURCES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Sort */}
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Sort</Label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-8 text-xs rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {/* Date from */}
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Date from</Label>
              <Input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
                className="h-8 text-xs rounded-xl" />
            </div>
            {/* Date to */}
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Date to</Label>
              <Input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
                className="h-8 text-xs rounded-xl" />
            </div>
          </div>

          {/* Test / Archived toggles */}
          {(testCount > 0 || archivedCount > 0) && (
            <div className="flex items-center gap-3 pt-1 border-t border-border">
              {testCount > 0 && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={showTestOnly} onChange={e => { setShowTestOnly(e.target.checked); if (e.target.checked) setShowArchived(false); }}
                    className="rounded" />
                  <span className="text-xs text-muted-foreground">Test transactions only ({testCount})</span>
                </label>
              )}
              {archivedCount > 0 && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={showArchived} onChange={e => { setShowArchived(e.target.checked); if (e.target.checked) setShowTestOnly(false); }}
                    className="rounded" />
                  <span className="text-xs text-muted-foreground">Show archived ({archivedCount})</span>
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {/* Test warning banner */}
      {testCount > 0 && !showTestOnly && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
          <TestTube className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>{testCount} test transaction{testCount !== 1 ? "s" : ""}</strong> may be affecting your totals.
            {" "}<button onClick={() => setShowTestOnly(true)} className="underline font-semibold">Review them</button> or archive to clean up.
          </span>
        </div>
      )}

      {/* Excluded warning */}
      {excludedCount > 0 && (
        <div className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600">
          <EyeOff className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{excludedCount} transaction{excludedCount !== 1 ? "s are" : " is"} excluded from reports.</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {sorted.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No transactions found</p>
            <p className="text-xs mt-1">
              {hasActiveFilters ? "Try adjusting your filters." : "No transactions recorded yet."}
            </p>
            {hasActiveFilters && (
              <button onClick={resetFilters} className="mt-3 text-xs text-primary underline">Clear filters</button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Column header */}
            <div className="grid grid-cols-[110px_1fr_120px_90px_90px_40px] gap-2 px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-secondary/40">
              <span>Date</span>
              <span>Description</span>
              <span>Category</span>
              <span>Status</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            {sorted.map(tx => (
              <TransactionRow key={tx.id} tx={tx} user={user} onRefetch={onRefetch} />
            ))}
          </div>
        )}
      </div>

      {sorted.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing {sorted.length} of {allTransactions.length} transactions
        </p>
      )}
    </div>
  );
}

// ── Single transaction row ────────────────────────────────────

function TransactionRow({ tx, user, onRefetch }) {
  const [expanded, setExpanded] = useState(false);
  const isIncome = tx.rawType === "income";

  const dateStr = tx.date
    ? (() => { try { return format(new Date(tx.date), "d MMM yyyy"); } catch { return tx.date; } })()
    : "—";

  const categoryLabel = isIncome
    ? getRevenueCategoryLabel(tx.category)
    : getExpenseCategoryLabel(tx.category);

  const amountDisplay = `${isIncome ? "+" : "-"}R${Math.abs(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className={`group transition-colors ${tx.isArchived ? "opacity-50" : ""} ${tx.isTest ? "bg-amber-50/30" : ""}`}>
      <div
        className="grid grid-cols-[110px_1fr_120px_90px_90px_40px] gap-2 px-4 py-3 items-center cursor-pointer hover:bg-secondary/30"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Date */}
        <div className="flex flex-col">
          <span className="text-xs text-foreground">{dateStr}</span>
          <span className={`text-[10px] font-semibold mt-0.5 ${isIncome ? "text-green-600" : "text-red-500"}`}>
            {isIncome ? "↑ Income" : "↓ Expense"}
          </span>
        </div>

        {/* Description + badges */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-foreground truncate">{tx.description}</span>
            {tx.isTest && <Badge label="Test" cls="bg-amber-100 text-amber-700" />}
            {tx.isArchived && <Badge label="Archived" cls="bg-slate-100 text-slate-500" />}
            {tx.excludedFromReports && <Badge label="Excluded" cls="bg-slate-100 text-slate-500" />}
          </div>
          {tx.source && (
            <span className="text-[10px] text-muted-foreground">
              {TRANSACTION_SOURCES[tx.source] || tx.source}
            </span>
          )}
        </div>

        {/* Category */}
        <span className="text-xs text-muted-foreground truncate">{categoryLabel}</span>

        {/* Status */}
        <StatusBadge status={tx.status} />

        {/* Amount */}
        <span className={`text-xs font-semibold text-right ${isIncome ? "text-green-600" : "text-red-500"}`}>
          {amountDisplay}
        </span>

        {/* Actions */}
        <div className="flex items-center justify-end" onClick={e => e.stopPropagation()}>
          <RowActions tx={tx} user={user} onRefetch={onRefetch} />
        </div>
      </div>

      {/* Expanded detail row */}
      {expanded && (
        <div className="px-4 pb-3 pt-0 grid grid-cols-2 md:grid-cols-4 gap-3 bg-secondary/20 border-t border-border/50">
          {tx.linkedOrderNumber && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Order</p>
              <p className="text-xs font-medium">{tx.linkedOrderNumber}</p>
            </div>
          )}
          {tx.linkedClient && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Client</p>
              <p className="text-xs font-medium">{tx.linkedClient}</p>
            </div>
          )}
          {tx.createdBy && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Recorded by</p>
              <p className="text-xs">{tx.createdBy}</p>
            </div>
          )}
          {tx.invoiceNumber && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Invoice</p>
              <p className="text-xs">{tx.invoiceNumber}</p>
            </div>
          )}
          {tx.vatAmount > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">VAT</p>
              <p className="text-xs">R{tx.vatAmount.toFixed(2)} ({tx.vatType})</p>
            </div>
          )}
          {tx.taxAmount > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Tax Collected</p>
              <p className="text-xs">R{tx.taxAmount.toFixed(2)}</p>
            </div>
          )}
          {tx.notes && (
            <div className="col-span-2 md:col-span-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Notes</p>
              <p className="text-xs text-foreground">{tx.notes}</p>
            </div>
          )}
          {tx.archivedBy && (
            <div className="col-span-2 md:col-span-4">
              <p className="text-[10px] text-muted-foreground">
                Archived by {tx.archivedBy} on {tx.archivedAt ? format(new Date(tx.archivedAt), "d MMM yyyy") : "—"}
              </p>
            </div>
          )}
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Created</p>
            <p className="text-xs">{tx.createdAt ? format(new Date(tx.createdAt), "d MMM yyyy HH:mm") : "—"}</p>
          </div>
        </div>
      )}
    </div>
  );
}
