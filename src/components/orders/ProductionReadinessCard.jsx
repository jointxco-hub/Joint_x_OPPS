import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  getOrderProductionReadiness,
  updateOrderProductionReadinessCheck,
} from "@/api/productionReadiness";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "checked", label: "Checked" },
  { value: "not_required", label: "Not required" },
  { value: "needs_attention", label: "Needs attention" },
];

function readable(value = "") {
  return String(value || "").replace(/_/g, " ");
}

function statusClass(status = "") {
  if (status === "checked") return "bg-emerald-100 text-emerald-700";
  if (status === "not_required") return "bg-slate-100 text-slate-600";
  if (status === "needs_attention") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-800";
}

function stateCopy(state) {
  if (state === "ready") return { label: "Ready", className: "bg-emerald-100 text-emerald-700" };
  if (state === "needs_attention") return { label: "Needs attention", className: "bg-red-100 text-red-700" };
  return { label: "Pending review", className: "bg-amber-100 text-amber-800" };
}

export default function ProductionReadinessCard({ order }) {
  const [notes, setNotes] = useState({});
  const queryClient = useQueryClient();
  const queryKey = ["productionReadiness", order?.id];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await getOrderProductionReadiness(order.id);
      if (result.error) throw new Error(result.error);
      return result.data;
    },
    enabled: !!order?.id,
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: updateOrderProductionReadinessCheck,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Production readiness updated");
    },
    onError: (err) => toast.error(err?.message || "Could not update readiness"),
  });

  if (isLoading) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 shadow-apple-sm">
        <div className="h-5 w-44 animate-pulse rounded bg-secondary" />
        <div className="mt-4 space-y-2">
          {[1, 2, 3].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-secondary/60" />)}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" />
          <div>
            <p className="font-semibold text-amber-900">Production Readiness is not ready yet</p>
            <p className="mt-1 text-sm leading-6 text-amber-800">{error.message}</p>
          </div>
        </div>
      </section>
    );
  }

  if (!data) return null;

  const summary = data.summary || {};
  const state = stateCopy(summary.ready_state);
  const checks = data.checks || [];
  const warnings = data.warnings || [];
  const techPacks = data.tech_packs || [];
  const instructions = data.special_instructions || [];
  const approvals = data.approvals || [];
  const contracts = data.contracts || [];

  const updateCheck = (check, status) => {
    updateMutation.mutate({
      orderId: order.id,
      checkKey: check.check_key,
      status,
      notes: notes[check.check_key] ?? check.notes ?? "",
    });
  };

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-apple-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-foreground">Production Readiness</h3>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Check the production facts before this order moves forward.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Badge className={state.className}>{state.label}</Badge>
          <button
            type="button"
            onClick={() => refetch()}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground hover:text-foreground"
            title="Refresh readiness"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Checked" value={`${summary.checked_count || 0}/${summary.total_checks || checks.length}`} />
        <Metric label="Warnings" value={summary.warning_count || warnings.length} tone="warn" />
        <Metric label="Attention" value={summary.needs_attention_count || 0} tone="risk" />
      </div>

      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((warning, index) => (
            <div key={`${warning.type}-${index}`} className={`rounded-xl border p-3 ${
              warning.level === "high" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
            }`}>
              <div className="flex items-start gap-2">
                <ShieldAlert className={`mt-0.5 h-4 w-4 flex-shrink-0 ${warning.level === "high" ? "text-red-700" : "text-amber-700"}`} />
                <p className={`text-sm leading-6 ${warning.level === "high" ? "text-red-800" : "text-amber-800"}`}>
                  {warning.message}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {checks.map((check) => (
          <div key={check.check_key} className="rounded-xl border border-border bg-secondary/20 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{check.label}</p>
                {check.notes && <p className="mt-1 text-xs leading-5 text-muted-foreground">{check.notes}</p>}
              </div>
              <Select
                value={check.status || "pending"}
                onValueChange={(status) => updateCheck(check, status)}
                disabled={updateMutation.isPending}
              >
                <SelectTrigger className="h-8 rounded-xl sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Badge className={statusClass(check.status)}>{readable(check.status || "pending")}</Badge>
              {check.checked_at && <span className="text-xs text-muted-foreground">{new Date(check.checked_at).toLocaleString()}</span>}
            </div>
            <Textarea
              value={notes[check.check_key] ?? check.notes ?? ""}
              onChange={(event) => setNotes((current) => ({ ...current, [check.check_key]: event.target.value }))}
              placeholder="Internal note for this check"
              className="mt-2 min-h-16 text-sm"
            />
          </div>
        ))}
      </div>

      {(techPacks.length > 0 || instructions.length > 0) && (
        <div className="grid gap-3">
          {techPacks.length > 0 && (
            <LinkedSection
              icon={FileCheck2}
              title="Brand Setups / Tech Packs"
              items={techPacks}
              renderItem={(item) => (
                <>
                  <p className="text-sm font-semibold text-foreground">{item.title || "Brand Setup"}</p>
                  <p className="mt-0.5 text-xs capitalize text-muted-foreground">{readable(item.tech_pack_type)} · {readable(item.status)}</p>
                </>
              )}
            />
          )}

          {instructions.length > 0 && (
            <LinkedSection
              icon={AlertTriangle}
              title="Special Instructions"
              items={instructions}
              renderItem={(item) => (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{item.title || readable(item.instruction_type)}</p>
                    {["sizing", "fit", "print", "quality_control"].includes(item.instruction_type) && (
                      <Badge className="bg-red-100 text-red-700">{readable(item.instruction_type)}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.instruction}</p>
                </>
              )}
            />
          )}
        </div>
      )}

      {(approvals.length > 0 || contracts.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SmallList title="Approvals" items={approvals} empty="No approval records found" />
          <SmallList title="Contracts" items={contracts} empty="No contract acceptances found" />
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone }) {
  const color = tone === "risk" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-foreground";
  return (
    <div className="rounded-xl bg-secondary/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function LinkedSection({ icon: Icon, title, items, renderItem }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      <div className="space-y-2">
        {items.slice(0, 5).map((item) => (
          <div key={item.id} className="rounded-lg bg-secondary/40 p-3">
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

function SmallList({ title, items, empty }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 4).map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 p-2">
              <p className="truncate text-xs text-foreground">
                {item.approval_type || item.contract_name || item.contract_type || "Record"}
              </p>
              <Badge className={statusClass(item.status || "accepted")}>
                {readable(item.status || "accepted")}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
