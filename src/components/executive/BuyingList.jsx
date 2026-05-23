import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dataClient } from "@/api/dataClient";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Plus, ShoppingCart, ChevronDown, Filter, Check,
  Edit, Archive, MoreHorizontal, AlertTriangle, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BUYING_CATEGORIES } from "./FinanceCategories";
import { canManageBuyingItems, canApproveBuyingItems } from "@/lib/financeAccess";

const PRIORITIES = {
  low:      { label: "Low",      cls: "bg-slate-100 text-slate-600" },
  medium:   { label: "Medium",   cls: "bg-blue-100 text-blue-700" },
  high:     { label: "High",     cls: "bg-orange-100 text-orange-700" },
  critical: { label: "Critical", cls: "bg-red-100 text-red-700" },
};

const STATUSES = {
  idea:      { label: "Idea",      cls: "bg-slate-100 text-slate-600" },
  planned:   { label: "Planned",   cls: "bg-blue-100 text-blue-700" },
  approved:  { label: "Approved",  cls: "bg-green-100 text-green-700" },
  bought:    { label: "Bought",    cls: "bg-teal-100 text-teal-700" },
  delayed:   { label: "Delayed",   cls: "bg-amber-100 text-amber-700" },
  cancelled: { label: "Cancelled", cls: "bg-red-100 text-red-600" },
};

function PriorityBadge({ p }) {
  const cfg = PRIORITIES[p] || { label: p, cls: "bg-secondary text-muted-foreground" };
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>;
}

function StatusBadge({ s }) {
  const cfg = STATUSES[s] || { label: s, cls: "bg-secondary text-muted-foreground" };
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>;
}

// ── Add / Edit drawer ─────────────────────────────────────────

function ItemDrawer({ item, user, buckets = [], onClose, onSaved }) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({
    item_name: item?.item_name || "",
    category: item?.category || "equipment",
    reason: item?.reason || "",
    estimated_cost: item?.estimated_cost ?? "",
    priority: item?.priority || "medium",
    status: item?.status || "idea",
    target_date: item?.target_date || "",
    budget_bucket_id: item?.budget_bucket_id || "",
    notes: item?.notes || "",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.item_name) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        estimated_cost: parseFloat(form.estimated_cost) || 0,
        budget_bucket_id: form.budget_bucket_id || null,
        added_by: user?.email || "",
      };
      if (!payload.budget_bucket_id) delete payload.budget_bucket_id;
      if (item?.id) {
        await dataClient.entities.FinanceBuyingItem.update(item.id, payload);
        toast.success("Item updated");
      } else {
        await dataClient.entities.FinanceBuyingItem.create(payload);
        toast.success("Item added");
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
      <div className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-apple-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="font-semibold text-foreground text-sm flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#1a7a5e] inline-block" />
            {item ? "Edit Item" : "Add Buying Item"}
          </h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Item Name *</Label>
            <Input value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })}
              placeholder="e.g. DTF Printer, Stock T-shirts…" required autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(BUYING_CATEGORIES).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Estimated Cost (R)</Label>
              <Input type="number" min="0" step="0.01" value={form.estimated_cost}
                onChange={e => setForm({ ...form, estimated_cost: e.target.value })}
                placeholder="0.00" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITIES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUSES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Why we need it</Label>
            <Input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
              placeholder="Reason / justification…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Target Date</Label>
              <Input type="date" value={form.target_date}
                onChange={e => setForm({ ...form, target_date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Budget Bucket</Label>
              <Select value={form.budget_bucket_id || "none"} onValueChange={v => setForm({ ...form, budget_bucket_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {buckets.filter(b => b.status === "active").map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional notes…" />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl">Cancel</Button>
            <Button type="submit" disabled={saving || !form.item_name} className="flex-1 rounded-xl bg-[#1a7a5e] hover:bg-[#155f4a] text-white">
              {saving ? "Saving…" : item ? "Save Changes" : "Add Item"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Row actions menu ──────────────────────────────────────────

function ItemMenu({ item, user, onEdit, onRefetch }) {
  const [open, setOpen] = useState(false);

  const update = async (patch) => {
    setOpen(false);
    try {
      await dataClient.entities.FinanceBuyingItem.update(item.id, patch);
      toast.success("Updated");
      onRefetch();
    } catch (err) {
      toast.error(err.message || "Update failed");
    }
  };

  const archive = async () => {
    setOpen(false);
    try {
      await dataClient.entities.FinanceBuyingItem.update(item.id, { archived_at: new Date().toISOString() });
      toast.success("Item archived");
      onRefetch();
    } catch (err) {
      toast.error(err.message || "Archive failed");
    }
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="w-6 h-6 rounded-lg hover:bg-secondary flex items-center justify-center text-muted-foreground">
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-7 z-40 bg-card border border-border rounded-xl shadow-apple-xl py-1 w-44 text-sm">
            {canManageBuyingItems(user) && (
              <button onClick={() => { setOpen(false); onEdit(); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary text-left text-xs">
                <Edit className="w-3.5 h-3.5 text-muted-foreground" /> Edit
              </button>
            )}
            {canApproveBuyingItems(user) && item.status !== "approved" && (
              <button onClick={() => update({ status: "approved" })}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary text-left text-xs">
                <Check className="w-3.5 h-3.5 text-green-600" /> Approve
              </button>
            )}
            {canManageBuyingItems(user) && item.status !== "bought" && (
              <button onClick={() => update({ status: "bought" })}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary text-left text-xs">
                <Check className="w-3.5 h-3.5 text-teal-600" /> Mark as Bought
              </button>
            )}
            {canManageBuyingItems(user) && (
              <>
                <div className="border-t border-border my-1" />
                <button onClick={archive}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary text-left text-xs text-muted-foreground">
                  <Archive className="w-3.5 h-3.5" /> Archive
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export default function BuyingList({ user }) {
  const qc = useQueryClient();
  const [showDrawer, setShowDrawer] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [showArchived, setShowArchived] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["buying-items"],
    queryFn: () => dataClient.entities.FinanceBuyingItem.list("-created_at", 200),
  });
  const { data: buckets = [] } = useQuery({
    queryKey: ["budget-buckets"],
    queryFn: () => dataClient.entities.FinanceBudgetBucket.list("-created_at", 50),
  });

  const onRefetch = () => qc.invalidateQueries({ queryKey: ["buying-items"] });

  const filtered = useMemo(() => {
    let rows = items;
    if (!showArchived) rows = rows.filter(i => !i.archived_at);
    else rows = rows.filter(i => !!i.archived_at);
    if (filterStatus !== "all") rows = rows.filter(i => i.status === filterStatus);
    if (filterPriority !== "all") rows = rows.filter(i => i.priority === filterPriority);
    if (filterCategory !== "all") rows = rows.filter(i => i.category === filterCategory);
    return rows;
  }, [items, showArchived, filterStatus, filterPriority, filterCategory]);

  const totalCost = useMemo(() => filtered.reduce((s, i) => s + (i.estimated_cost || 0), 0), [filtered]);
  const criticalCount = useMemo(() => filtered.filter(i => i.priority === "critical").length, [filtered]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-primary" /> Buying &amp; Investment List
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filtered.length} item{filtered.length !== 1 ? "s" : ""}
            {totalCost > 0 && ` · est. R${totalCost.toLocaleString()} total`}
            {criticalCount > 0 && ` · ${criticalCount} critical`}
          </p>
        </div>
        {canManageBuyingItems(user) && (
          <Button size="sm" className="rounded-xl gap-1.5 bg-[#1a7a5e] hover:bg-[#155f4a] text-white"
            onClick={() => { setEditItem(null); setShowDrawer(true); }}>
            <Plus className="w-3.5 h-3.5" /> Add Item
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-7 text-xs rounded-xl w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="h-7 text-xs rounded-xl w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {Object.entries(PRIORITIES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="h-7 text-xs rounded-xl w-36"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(BUYING_CATEGORIES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="rounded" />
          Archived
        </label>
      </div>

      {/* Critical alert */}
      {criticalCount > 0 && !showArchived && filterStatus === "all" && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span><strong>{criticalCount} critical item{criticalCount !== 1 ? "s" : ""}</strong> need attention.</span>
        </div>
      )}

      {/* Items list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-2xl">
          <ShoppingCart className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">
            {showArchived ? "No archived items" : "No items yet"}
          </p>
          {!showArchived && canManageBuyingItems(user) && (
            <p className="text-xs text-muted-foreground mt-1">
              Add things the business needs to buy or invest in.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
          {filtered.map(item => {
            const bucket = buckets.find(b => b.id === item.budget_bucket_id);
            return (
              <div key={item.id} className="px-4 py-3 flex items-start gap-3 hover:bg-secondary/20 group">
                {/* Priority dot */}
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                  item.priority === "critical" ? "bg-red-500" :
                  item.priority === "high" ? "bg-orange-400" :
                  item.priority === "medium" ? "bg-blue-400" : "bg-slate-300"
                }`} />

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{item.item_name}</span>
                    <PriorityBadge p={item.priority} />
                    <StatusBadge s={item.status} />
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {BUYING_CATEGORIES[item.category] && (
                      <span className="text-xs text-muted-foreground">{BUYING_CATEGORIES[item.category]}</span>
                    )}
                    {item.reason && (
                      <span className="text-xs text-muted-foreground truncate max-w-[240px]">{item.reason}</span>
                    )}
                    {bucket && (
                      <span className="text-xs text-muted-foreground">Bucket: {bucket.name}</span>
                    )}
                  </div>
                  {item.target_date && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Target: {format(new Date(item.target_date), "d MMM yyyy")}
                    </p>
                  )}
                  {item.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 italic">{item.notes}</p>
                  )}
                </div>

                {/* Amount */}
                <div className="text-right flex-shrink-0">
                  {item.estimated_cost > 0 && (
                    <p className="text-sm font-semibold text-foreground">
                      R{item.estimated_cost.toLocaleString()}
                    </p>
                  )}
                  {item.added_by && (
                    <p className="text-[10px] text-muted-foreground">{item.added_by}</p>
                  )}
                </div>

                {/* Actions */}
                <div onClick={e => e.stopPropagation()}>
                  <ItemMenu
                    item={item}
                    user={user}
                    onEdit={() => { setEditItem(item); setShowDrawer(true); }}
                    onRefetch={onRefetch}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Drawer */}
      {showDrawer && (
        <ItemDrawer
          item={editItem}
          user={user}
          buckets={buckets}
          onClose={() => { setShowDrawer(false); setEditItem(null); }}
          onSaved={onRefetch}
        />
      )}
    </div>
  );
}
