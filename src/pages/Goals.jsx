import { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Target, Plus, Star, Pencil, Archive, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import ResponsiveModal from "@/components/common/ResponsiveModal";

const SCOPES = ["company", "team", "personal"];
const STATUSES = ["active", "completed", "paused"];

const scopeColors = {
  company: "bg-violet-100 text-violet-700",
  team:    "bg-blue-100 text-blue-700",
  personal:"bg-emerald-100 text-emerald-700",
};

const EMPTY_FORM = {
  title: "", description: "", scope: "personal",
  status: "active", progress: 0, is_north_star: false,
  start_date: "", end_date: "", assigned_to: "",
};

function GoalFormModal({ open, onClose, existing }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(existing ?? EMPTY_FORM);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (data) =>
      existing
        ? dataClient.entities.Goal.update(existing.id, data)
        : dataClient.entities.Goal.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      toast.success(existing ? "Goal updated" : "Goal created");
      onClose();
    },
    onError: (err) => toast.error(err?.message || "Failed to save"),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    mutation.mutate({
      title: form.title.trim(),
      description: form.description,
      scope: form.scope || "personal",
      status: form.status || "active",
      progress: Math.min(100, Math.max(0, Number(form.progress) || 0)),
      is_north_star: !!form.is_north_star,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      assigned_to: form.assigned_to || null,
    });
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={existing ? "Edit Goal" : "New Goal"}
      size="md"
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : existing ? "Save" : "Create"}
          </Button>
        </div>
      }
    >
      <form className="space-y-4 py-2" onSubmit={handleSubmit}>
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Title *</label>
          <Input value={form.title} onChange={set("title")} placeholder="What do you want to achieve?" className="h-11 md:h-10" />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Description</label>
          <textarea value={form.description} onChange={set("description")} rows={2}
            className="w-full text-sm bg-secondary/50 rounded-xl px-3 py-2 resize-none border border-border outline-none focus:ring-1 focus:ring-primary/30" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Scope</label>
            <select value={form.scope} onChange={set("scope")}
              className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
              {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Status</label>
            <select value={form.status} onChange={set("status")}
              className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">
            Progress — <span className="text-primary font-semibold">{form.progress}%</span>
          </label>
          <input type="range" min={0} max={100} step={5}
            value={form.progress}
            onChange={e => setForm(f => ({ ...f, progress: Number(e.target.value) }))}
            className="w-full accent-primary" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Start date</label>
            <Input type="date" value={form.start_date} onChange={set("start_date")} className="h-11 md:h-10" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">End date</label>
            <Input type="date" value={form.end_date} onChange={set("end_date")} className="h-11 md:h-10" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Assigned to (email)</label>
          <Input value={form.assigned_to} onChange={set("assigned_to")} placeholder="name@jointx.co.za" className="h-11 md:h-10" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.is_north_star}
            onChange={e => setForm(f => ({ ...f, is_north_star: e.target.checked }))}
            className="accent-primary" />
          <span className="text-sm text-foreground">Mark as North Star goal</span>
          <Star className="w-4 h-4 text-amber-400" />
        </label>
      </form>
    </ResponsiveModal>
  );
}

function GoalCard({ goal, onEdit, onArchive, onProgressClick }) {
  const pct = goal.progress ?? 0;
  const barColor = pct >= 80 ? "bg-green-500" : pct >= 40 ? "bg-primary" : "bg-amber-400";

  return (
    <div className="bg-card rounded-2xl border border-border p-4 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {goal.is_north_star && <Star className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />}
          <p className="text-sm font-semibold text-foreground leading-snug">{goal.title}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${scopeColors[goal.scope] || "bg-secondary text-muted-foreground"}`}>
            {goal.scope}
          </span>
          <button onClick={() => onEdit(goal)} className="text-muted-foreground hover:text-foreground transition-all">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onArchive(goal.id)} className="text-muted-foreground hover:text-foreground transition-all">
            <Archive className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {goal.description && (
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{goal.description}</p>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Progress</span>
          <button
            onClick={() => onProgressClick(goal)}
            className="text-xs font-bold text-foreground hover:text-primary transition-all"
          >
            {pct}%
          </button>
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {(goal.start_date || goal.end_date) && (
        <p className="text-[10px] text-muted-foreground mt-2">
          {goal.start_date && `From ${new Date(goal.start_date).toLocaleDateString("en-ZA")}`}
          {goal.start_date && goal.end_date && " → "}
          {goal.end_date && new Date(goal.end_date).toLocaleDateString("en-ZA")}
        </p>
      )}
    </div>
  );
}

export default function Goals() {
  const [showForm, setShowForm] = useState(false);
  const [editGoal, setEditGoal] = useState(null);
  const [scopeFilter, setScopeFilter] = useState("all");
  const qc = useQueryClient();

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ["goals"],
    queryFn: () => dataClient.entities.Goal.list("-created_date", 200),
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => dataClient.entities.Goal.update(id, {
      is_archived: true, archived_at: new Date().toISOString(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      toast.success("Goal archived");
    },
  });

  const quickProgressMutation = useMutation({
    mutationFn: ({ id, progress }) => dataClient.entities.Goal.update(id, { progress }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });

  const active = goals.filter(g => !g.is_archived && g.status !== "completed");
  const completed = goals.filter(g => !g.is_archived && g.status === "completed");
  const northStar = active.find(g => g.is_north_star);

  const filtered = active.filter(g =>
    scopeFilter === "all" || g.scope === scopeFilter
  );

  const handleProgressClick = (goal) => {
    const input = prompt(`Progress for "${goal.title}" (0–100):`, goal.progress ?? 0);
    if (input === null) return;
    const val = Math.min(100, Math.max(0, Number(input) || 0));
    quickProgressMutation.mutate({ id: goal.id, progress: val });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 md:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">Goals</h1>
            </div>
            <p className="text-muted-foreground text-sm mt-0.5">
              {active.length} active · {completed.length} completed
            </p>
          </div>
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="w-4 h-4" /> New Goal
          </Button>
        </div>

        {/* North Star */}
        {northStar && (
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Star className="w-4 h-4 text-amber-500" />
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">North Star</p>
            </div>
            <p className="text-base font-bold text-foreground mb-3">{northStar.title}</p>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Progress</span>
                <span className="font-bold text-foreground">{northStar.progress ?? 0}%</span>
              </div>
              <div className="h-2 bg-amber-100 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full transition-all"
                  style={{ width: `${northStar.progress ?? 0}%` }} />
              </div>
            </div>
          </div>
        )}

        {/* Scope filter */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {["all", ...SCOPES].map(s => (
            <button key={s} onClick={() => setScopeFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all capitalize ${
                scopeFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border text-muted-foreground hover:text-foreground"
              }`}>
              {s}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-card rounded-2xl animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 bg-card rounded-2xl border border-border">
            <Target className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">No goals yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Set a goal to track your 12-week progress.</p>
            <Button onClick={() => setShowForm(true)} variant="outline">+ Add first goal</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {filtered.map(goal => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onEdit={setEditGoal}
                onArchive={(id) => { if (confirm("Archive this goal?")) archiveMutation.mutate(id); }}
                onProgressClick={handleProgressClick}
              />
            ))}
          </div>
        )}

        {completed.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Completed ({completed.length})
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {completed.map(goal => (
                <div key={goal.id} className="bg-card rounded-2xl border border-border px-4 py-3 opacity-60 flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground line-through">{goal.title}</p>
                  <span className="text-xs text-green-600 font-medium">100%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showForm && <GoalFormModal open={showForm} onClose={() => setShowForm(false)} />}
      {editGoal && <GoalFormModal open={!!editGoal} onClose={() => setEditGoal(null)} existing={editGoal} />}
    </div>
  );
}
