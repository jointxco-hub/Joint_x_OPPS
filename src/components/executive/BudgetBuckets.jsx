import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dataClient } from "@/api/dataClient";
import { toast } from "sonner";
import {
  Plus, Wallet, MoreHorizontal, AlertTriangle, X, Edit, Archive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BUDGET_CATEGORIES } from "./FinanceCategories";
import { canManageBudgets } from "@/lib/financeAccess";

const BUCKET_STATUSES = {
  active: { label: "Active", cls: "bg-green-100 text-green-700" },
  paused: { label: "Paused", cls: "bg-amber-100 text-amber-700" },
  closed: { label: "Closed", cls: "bg-slate-100 text-slate-500" },
};

// ── Add / Edit drawer ─────────────────────────────────────────

function BucketDrawer({ bucket, user, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: bucket?.name || "",
    category: bucket?.category || "other",
    monthly_budget: bucket?.monthly_budget ?? "",
    used_amount: bucket?.used_amount ?? "",
    notes: bucket?.notes || "",
    status: bucket?.status || "active",
  });
  const [saving, setSaving] = useState(false);

  const remaining = (parseFloat(form.monthly_budget) || 0) - (parseFloat(form.used_amount) || 0);
  const pct = form.monthly_budget > 0
    ? Math.min(100, ((parseFloat(form.used_amount) || 0) / parseFloat(form.monthly_budget)) * 100)
    : 0;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        monthly_budget: parseFloat(form.monthly_budget) || 0,
        used_amount: parseFloat(form.used_amount) || 0,
        created_by: user?.email || "",
      };
      if (bucket?.id) {
        await dataClient.entities.FinanceBudgetBucket.update(bucket.id, payload);
        toast.success("Bucket updated");
      } else {
        await dataClient.entities.FinanceBudgetBucket.create(payload);
        toast.success("Budget bucket created");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-4">
      <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-apple-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="font-semibold text-foreground text-sm flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#1a7a5e] inline-block" />
            {bucket ? "Edit Bucket" : "Create Budget Bucket"}
          </h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Bucket Name *</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Blanks & Garments, Marketing…" required autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(BUDGET_CATEGORIES).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(BUCKET_STATUSES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Monthly Budget (R)</Label>
              <Input type="number" min="0" step="0.01" value={form.monthly_budget}
                onChange={e => setForm({ ...form, monthly_budget: e.target.value })}
                placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label>Amount Used (R)</Label>
              <Input type="number" min="0" step="0.01" value={form.used_amount}
                onChange={e => setForm({ ...form, used_amount: e.target.value })}
                placeholder="0.00" />
            </div>
          </div>

          {/* Live preview */}
          {parseFloat(form.monthly_budget) > 0 && (
            <div className="bg-secondary/50 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">Remaining</span>
                <span className={`text-xs font-semibold ${remaining < 0 ? "text-red-600" : "text-green-600"}`}>
                  {remaining < 0 ? "-" : ""}R{Math.abs(remaining).toLocaleString()}
                </span>
              </div>
              <div className="w-full bg-border rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-[#1a7a5e]"}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{pct.toFixed(0)}% used</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional notes…" />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl">Cancel</Button>
            <Button type="submit" disabled={saving || !form.name} className="flex-1 rounded-xl bg-[#1a7a5e] hover:bg-[#155f4a] text-white">
              {saving ? "Saving…" : bucket ? "Save Changes" : "Create Bucket"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Bucket card ───────────────────────────────────────────────

function BucketCard({ bucket, user, onEdit, onRefetch, highlighted, cardRef }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const budget = bucket.monthly_budget || 0;
  const used = bucket.used_amount || 0;
  const remaining = budget - used;
  const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
  const overBudget = remaining < 0;
  const warnZone = pct >= 80 && !overBudget;

  const cfg = BUCKET_STATUSES[bucket.status] || BUCKET_STATUSES.active;

  const archiveBucket = async () => {
    setMenuOpen(false);
    try {
      await dataClient.entities.FinanceBudgetBucket.update(bucket.id, {
        archived_at: new Date().toISOString(),
        archived_by: "",
        status: "closed",
      });
      toast.success("Bucket archived");
      onRefetch();
    } catch (err) {
      toast.error(err.message || "Failed");
    }
  };

  return (
    <div
      ref={cardRef}
      className={`bg-card border rounded-2xl p-4 shadow-apple-sm relative transition-shadow ${overBudget ? "border-red-200" : highlighted ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{bucket.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {bucket.category && BUDGET_CATEGORIES[bucket.category] && (
              <span className="text-[10px] text-muted-foreground">{BUDGET_CATEGORIES[bucket.category]}</span>
            )}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>
          </div>
        </div>
        {canManageBudgets(user) && (
          <div className="relative">
            <button onClick={() => setMenuOpen(v => !v)}
              className="w-6 h-6 rounded-lg hover:bg-secondary flex items-center justify-center text-muted-foreground">
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-7 z-40 bg-card border border-border rounded-xl shadow-apple-xl py-1 w-40">
                  <button onClick={() => { setMenuOpen(false); onEdit(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary text-left text-xs">
                    <Edit className="w-3.5 h-3.5 text-muted-foreground" /> Edit Bucket
                  </button>
                  <div className="border-t border-border my-1" />
                  <button onClick={archiveBucket}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary text-left text-xs text-muted-foreground">
                    <Archive className="w-3.5 h-3.5" /> Archive
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Amounts */}
      <div className="flex items-end justify-between mb-2">
        <div>
          <p className="text-[10px] text-muted-foreground">Used</p>
          <p className="text-base font-bold text-foreground">R{used.toLocaleString()}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-muted-foreground">Budget</p>
          <p className="text-sm font-semibold text-muted-foreground">R{budget.toLocaleString()}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-border rounded-full h-2 mb-2">
        <div
          className={`h-2 rounded-full transition-all ${overBudget ? "bg-red-500" : warnZone ? "bg-amber-500" : "bg-[#1a7a5e]"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>

      {/* Remaining */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {overBudget && <AlertTriangle className="w-3 h-3 text-red-500" />}
          <span className={`text-xs font-semibold ${overBudget ? "text-red-600" : warnZone ? "text-amber-600" : "text-muted-foreground"}`}>
            {overBudget
              ? `R${Math.abs(remaining).toLocaleString()} over budget`
              : `R${remaining.toLocaleString()} remaining`}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">{pct.toFixed(0)}%</span>
      </div>

      {bucket.notes && (
        <p className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border/50">{bucket.notes}</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export default function BudgetBuckets({ user, highlightBucketId }) {
  const qc = useQueryClient();
  const [showDrawer, setShowDrawer] = useState(false);
  const [editBucket, setEditBucket] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const bucketRefs = useRef({});

  useEffect(() => {
    if (!highlightBucketId) return;
    const el = bucketRefs.current[highlightBucketId];
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
    }
  }, [highlightBucketId]);

  const { data: buckets = [], isLoading } = useQuery({
    queryKey: ["budget-buckets"],
    queryFn: () => dataClient.entities.FinanceBudgetBucket.list("-created_at", 50),
  });

  const onRefetch = () => qc.invalidateQueries({ queryKey: ["budget-buckets"] });

  const visible = useMemo(() => {
    return showArchived
      ? buckets.filter(b => b.archived_at)
      : buckets.filter(b => !b.archived_at);
  }, [buckets, showArchived]);

  const totalBudget = useMemo(() => visible.filter(b => b.status === "active").reduce((s, b) => s + (b.monthly_budget || 0), 0), [visible]);
  const totalUsed = useMemo(() => visible.filter(b => b.status === "active").reduce((s, b) => s + (b.used_amount || 0), 0), [visible]);
  const overBudgetCount = useMemo(() => visible.filter(b => (b.used_amount || 0) > (b.monthly_budget || 0)).length, [visible]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" /> Budget Buckets
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {visible.length} bucket{visible.length !== 1 ? "s" : ""}
            {totalBudget > 0 && ` · R${totalUsed.toLocaleString()} of R${totalBudget.toLocaleString()} used`}
            {overBudgetCount > 0 && ` · ${overBudgetCount} over budget`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="rounded" />
            Archived
          </label>
          {canManageBudgets(user) && (
            <Button size="sm" className="rounded-xl gap-1.5 bg-[#1a7a5e] hover:bg-[#155f4a] text-white"
              onClick={() => { setEditBucket(null); setShowDrawer(true); }}>
              <Plus className="w-3.5 h-3.5" /> Create Bucket
            </Button>
          )}
        </div>
      </div>

      {/* Over-budget warning */}
      {overBudgetCount > 0 && !showArchived && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>{overBudgetCount} bucket{overBudgetCount !== 1 ? "s are" : " is"} over budget.</strong>
            {" "}Review spending or adjust the monthly budget.
          </span>
        </div>
      )}

      {/* No expenses note */}
      {totalBudget > 0 && totalUsed === 0 && !showArchived && (
        <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            Budget buckets have a budget set but no amount used. Update the <strong>Used amount</strong> as you spend.
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-2xl">
          <Wallet className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">
            {showArchived ? "No archived buckets" : "No budget buckets yet"}
          </p>
          {!showArchived && canManageBudgets(user) && (
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Create buckets to plan monthly spending by category.
            </p>
          )}
          {!showArchived && canManageBudgets(user) && (
            <Button size="sm" className="rounded-xl gap-1.5 bg-[#1a7a5e] hover:bg-[#155f4a] text-white"
              onClick={() => { setEditBucket(null); setShowDrawer(true); }}>
              <Plus className="w-3.5 h-3.5" /> Create first bucket
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(bucket => (
            <BucketCard
              key={bucket.id}
              bucket={bucket}
              user={user}
              onEdit={() => { setEditBucket(bucket); setShowDrawer(true); }}
              onRefetch={onRefetch}
              highlighted={bucket.id === highlightBucketId}
              cardRef={el => { bucketRefs.current[bucket.id] = el; }}
            />
          ))}
        </div>
      )}

      {showDrawer && (
        <BucketDrawer
          bucket={editBucket}
          user={user}
          onClose={() => { setShowDrawer(false); setEditBucket(null); }}
          onSaved={onRefetch}
        />
      )}
    </div>
  );
}
