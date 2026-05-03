import { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Sparkles, Plus, ChevronUp, ChevronDown } from "lucide-react";
import AdminOnly from "@/components/common/AdminOnly";
import HelperHint from "@/components/common/HelperHint";
import ResponsiveModal from "@/components/common/ResponsiveModal";

function valueScore(o) {
  const num = (o.dream_outcome ?? 5) * (o.perceived_likelihood ?? 5);
  const den = (o.time_delay ?? 5) * (o.effort_sacrifice ?? 5);
  return den === 0 ? 0 : Math.round((num / den) * 10) / 10;
}

const SCORE_FIELDS = [
  { key: "dream_outcome",         label: "Dream Outcome",          hint: "How vivid and desired is the result? (1–10)" },
  { key: "perceived_likelihood",  label: "Perceived Likelihood",   hint: "How believable is the promise? (1–10)" },
  { key: "time_delay",            label: "Time Delay",             hint: "How long to see results? Lower = better for buyer. (1–10)" },
  { key: "effort_sacrifice",      label: "Effort & Sacrifice",     hint: "How hard is it for the buyer? Lower = better. (1–10)" },
];

const EMPTY_FORM = { offer_key: "", offer_name: "", dream_outcome: "", perceived_likelihood: "", time_delay: "", effort_sacrifice: "", notes: "" };

function OfferFormModal({ open, onClose, existing }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(existing ?? EMPTY_FORM);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (data) =>
      existing
        ? dataClient.entities.OfferScore.update(existing.id, data)
        : dataClient.entities.OfferScore.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offerScores"] });
      toast.success(existing ? "Offer updated" : "Offer scored!");
      onClose();
    },
    onError: (err) => toast.error(err?.message || "Failed to save"),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.offer_key.trim() || !form.offer_name.trim()) {
      toast.error("Key and name are required");
      return;
    }
    mutation.mutate({
      offer_key: form.offer_key.trim(),
      offer_name: form.offer_name.trim(),
      dream_outcome: Number(form.dream_outcome) || null,
      perceived_likelihood: Number(form.perceived_likelihood) || null,
      time_delay: Number(form.time_delay) || null,
      effort_sacrifice: Number(form.effort_sacrifice) || null,
      notes: form.notes,
    });
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={existing ? "Edit Offer Score" : "Score Your First Offer"}
      description="Rate each dimension 1–10. The Value Equation calculates your offer's appeal automatically."
      size="md"
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : existing ? "Save" : "Add Offer"}
          </Button>
        </div>
      }
    >
      <form className="space-y-4 py-2" onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Offer key *</label>
            <Input value={form.offer_key} onChange={set("offer_key")} placeholder="x1_basic" className="h-11 md:h-10" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Offer name *</label>
            <Input value={form.offer_name} onChange={set("offer_name")} placeholder="X1 Basic Pack" className="h-11 md:h-10" />
          </div>
        </div>
        {SCORE_FIELDS.map(({ key, label, hint }) => (
          <div key={key}>
            <label className="text-xs font-medium text-foreground block mb-1">
              {label} <span className="text-muted-foreground font-normal">(1–10)</span>
            </label>
            <p className="text-[11px] text-muted-foreground mb-1">{hint}</p>
            <Input
              type="number"
              min={1}
              max={10}
              value={form[key]}
              onChange={set(key)}
              className="h-11 md:h-10"
              placeholder="5"
            />
          </div>
        ))}
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Notes</label>
          <textarea
            value={form.notes}
            onChange={set("notes")}
            rows={2}
            className="w-full text-sm bg-secondary/50 rounded-xl px-3 py-2 resize-none border border-border outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </form>
    </ResponsiveModal>
  );
}

function OffersTable({ offers }) {
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState("desc");

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const sorted = [...offers].sort((a, b) => {
    const va = sortKey === "score" ? valueScore(a) : (a[sortKey] ?? 0);
    const vb = sortKey === "score" ? valueScore(b) : (b[sortKey] ?? 0);
    return sortDir === "asc" ? va - vb : vb - va;
  });

  const SortIcon = ({ k }) => {
    if (sortKey !== k) return null;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const cols = [
    { key: "offer_name", label: "Offer" },
    { key: "dream_outcome", label: "Dream" },
    { key: "perceived_likelihood", label: "Likely" },
    { key: "time_delay", label: "Delay ↓" },
    { key: "effort_sacrifice", label: "Effort ↓" },
    { key: "score", label: "Value Score" },
  ];

  return (
    <div className="overflow-x-auto rounded-2xl border border-border shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-secondary/40 border-b border-border">
            {cols.map(({ key, label }) => (
              <th
                key={key}
                onClick={() => toggleSort(key)}
                className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none"
              >
                <span className="flex items-center gap-1">{label}<SortIcon k={key} /></span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(o => {
            const score = valueScore(o);
            return (
              <tr key={o.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{o.offer_name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{o.offer_key}</p>
                </td>
                <td className="px-4 py-3 text-center">{o.dream_outcome ?? "—"}</td>
                <td className="px-4 py-3 text-center">{o.perceived_likelihood ?? "—"}</td>
                <td className="px-4 py-3 text-center">{o.time_delay ?? "—"}</td>
                <td className="px-4 py-3 text-center">{o.effort_sacrifice ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${
                    score >= 4 ? "bg-green-100 text-green-700" :
                    score >= 2 ? "bg-amber-100 text-amber-700" :
                    "bg-red-100 text-red-700"
                  }`}>
                    {score}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OffersDashboardInner() {
  const [showForm, setShowForm] = useState(false);
  const { data: offers = [], isLoading } = useQuery({
    queryKey: ["offerScores"],
    queryFn: () => dataClient.entities.OfferScore.list("-scored_at", 100),
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">Offers</h1>
              <HelperHint
                storageKey="value_equation"
                title="Value Equation"
                body="(Dream outcome × likelihood) ÷ (delay × effort) = how compelling an offer is."
                learnMore="Alex Hormozi, $100M Offers — score your offers to know which to prioritise."
              />
            </div>
            <p className="text-muted-foreground text-sm mt-0.5">
              Score your offers using the Value Equation
            </p>
          </div>
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Score offer
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-card rounded-2xl animate-pulse" />)}
          </div>
        ) : offers.length === 0 ? (
          <div className="text-center py-20 bg-card rounded-2xl border border-border">
            <Sparkles className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">Score your first offer</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
              Use the Value Equation to rank your offers. High dream outcome + high likelihood − delay − effort = irresistible.
            </p>
            <Button onClick={() => setShowForm(true)} variant="outline">
              + Add first offer
            </Button>
          </div>
        ) : (
          <OffersTable offers={offers} />
        )}
      </div>

      {showForm && (
        <OfferFormModal open={showForm} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}

export default function OffersDashboard() {
  return <AdminOnly><OffersDashboardInner /></AdminOnly>;
}
