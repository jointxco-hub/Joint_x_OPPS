import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileSignature,
  Inbox,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  UserRoundPen,
} from "lucide-react";
import { toast } from "sonner";
import { listClientRequests, updateClientRequestStatus } from "@/api/clientRequests";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "quote_request", label: "Quotes" },
  { value: "reorder_request", label: "Reorders" },
  { value: "message", label: "Messages" },
  { value: "profile_update", label: "Profile updates" },
  { value: "tech_pack", label: "Brand setups" },
  { value: "special_instruction", label: "Instructions" },
  { value: "approval", label: "Approvals" },
  { value: "contract_acceptance", label: "Contracts" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "new", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "actioned", label: "Actioned" },
  { value: "closed", label: "Closed" },
  { value: "needs_client_approval", label: "Needs client approval" },
  { value: "approved", label: "Approved" },
  { value: "updated_needs_reapproval", label: "Needs reapproval" },
  { value: "active", label: "Active" },
  { value: "pending_review", label: "Pending review" },
];

const WORKFLOW_STATUSES = ["new", "reviewing", "actioned", "closed"];
const TECH_PACK_STATUSES = ["needs_client_approval", "approved", "updated_needs_reapproval", "archived"];
const INSTRUCTION_STATUSES = ["new", "reviewing", "actioned", "closed", "active", "archived"];
const PROFILE_STATUSES = ["new", "reviewing", "actioned", "closed", "pending_review"];

const TYPE_META = {
  quote_request: { label: "Quote", icon: ClipboardCheck, className: "bg-blue-50 text-blue-700 border-blue-100" },
  reorder_request: { label: "Reorder", icon: RefreshCw, className: "bg-violet-50 text-violet-700 border-violet-100" },
  message: { label: "Message", icon: MessageSquare, className: "bg-slate-50 text-slate-700 border-slate-200" },
  profile_update: { label: "Profile", icon: UserRoundPen, className: "bg-cyan-50 text-cyan-700 border-cyan-100" },
  tech_pack: { label: "Brand Setup", icon: ClipboardCheck, className: "bg-amber-50 text-amber-800 border-amber-100" },
  special_instruction: { label: "Instruction", icon: ShieldAlert, className: "bg-red-50 text-red-700 border-red-100" },
  approval: { label: "Approval", icon: CheckCircle2, className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  contract_acceptance: { label: "Contract", icon: FileSignature, className: "bg-zinc-50 text-zinc-700 border-zinc-200" },
};

function readable(value = "") {
  return String(value || "").replace(/_/g, " ");
}

function statusClass(status = "") {
  if (["new", "pending_review"].includes(status)) return "bg-primary text-primary-foreground";
  if (["reviewing", "needs_client_approval", "updated_needs_reapproval"].includes(status)) return "bg-amber-100 text-amber-800";
  if (["approved", "actioned", "accepted", "active"].includes(status)) return "bg-emerald-100 text-emerald-700";
  if (["closed", "archived"].includes(status)) return "bg-slate-100 text-slate-600";
  return "bg-secondary text-muted-foreground";
}

function riskBadges(request) {
  const payload = request.payload || {};
  const badges = [];
  const instructionType = payload.instruction_type;

  if (request.request_type === "special_instruction") {
    badges.push({ label: "Production note", className: "bg-red-50 text-red-700 border-red-100" });
    if (["sizing", "fit", "print", "quality_control"].includes(instructionType)) {
      badges.push({ label: `${readable(instructionType)} issue`, className: "bg-amber-50 text-amber-800 border-amber-100" });
    }
  }

  if (request.request_type === "tech_pack") {
    badges.push({ label: "Check before production", className: "bg-amber-50 text-amber-800 border-amber-100" });
  }

  if (request.request_type === "message" && /partner/i.test(`${payload.subject || ""} ${payload.message || ""}`)) {
    badges.push({ label: "Partner request", className: "bg-violet-50 text-violet-700 border-violet-100" });
  }

  if (request.request_type === "reorder_request") {
    badges.push({ label: "Repeat job", className: "bg-violet-50 text-violet-700 border-violet-100" });
  }

  return badges;
}

function statusOptionsFor(type) {
  if (type === "tech_pack") return TECH_PACK_STATUSES;
  if (type === "special_instruction") return INSTRUCTION_STATUSES;
  if (type === "profile_update") return PROFILE_STATUSES;
  if (["quote_request", "reorder_request", "message"].includes(type)) return WORKFLOW_STATUSES;
  return [];
}

export default function ClientRequests() {
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [sourceApp, setSourceApp] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const queryClient = useQueryClient();

  const { data: requests = [], isLoading, error, refetch } = useQuery({
    queryKey: ["clientRequests", type, status, sourceApp, search],
    queryFn: async () => {
      const result = await listClientRequests({ type, status, sourceApp, search, limit: 50 });
      if (result.error) throw new Error(result.error);
      return result.data;
    },
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: updateClientRequestStatus,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clientRequests"] });
      toast.success("Request status updated");
    },
    onError: (err) => toast.error(err?.message || "Could not update request"),
  });

  const counts = useMemo(() => ({
    total: requests.length,
    new: requests.filter((item) => ["new", "pending_review", "needs_client_approval"].includes(item.status)).length,
    productionRisk: requests.filter((item) => ["tech_pack", "special_instruction"].includes(item.request_type)).length,
  }), [requests]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 md:py-8">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Client Account</p>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Client Requests</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              X LAB account submissions that need review before production relies on them.
            </p>
          </div>
          <Button variant="outline" onClick={() => refetch()} className="rounded-xl">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Metric label="Visible requests" value={counts.total} />
          <Metric label="Needs review" value={counts.new} tone="primary" />
          <Metric label="Production-sensitive" value={counts.productionRisk} tone="risk" />
        </div>

        <div className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-apple-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            Filters
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_160px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search client, email, preview, specs..."
                className="pl-9"
              />
            </div>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPE_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUS_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={sourceApp} onValueChange={setSourceApp}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="xlab">X LAB</SelectItem>
                <SelectItem value="x1">X1</SelectItem>
                <SelectItem value="opps">OPPS</SelectItem>
                <SelectItem value="xlabos">XLABOS</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-card" />)}
          </div>
        ) : error ? (
          <EmptyState
            icon={AlertTriangle}
            title="Client Requests is not ready yet"
            text={error.message || "Apply the internal client requests migration, then refresh this page."}
          />
        ) : requests.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No client requests yet"
            text="When customers submit quotes, messages, brand setups, or special instructions from X LAB, they will appear here."
          />
        ) : (
          <div className="space-y-3">
            {requests.map((request) => (
              <RequestCard
                key={`${request.request_type}-${request.id}`}
                request={request}
                onOpen={() => setSelected(request)}
              />
            ))}
          </div>
        )}
      </div>

      <RequestDetailDialog
        request={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        onStatusChange={(nextStatus) => {
          if (!selected) return;
          updateMutation.mutate(
            { type: selected.request_type, id: selected.id, status: nextStatus },
            { onSuccess: () => setSelected((prev) => prev ? { ...prev, status: nextStatus } : prev) },
          );
        }}
        isUpdating={updateMutation.isPending}
      />
    </div>
  );
}

function Metric({ label, value, tone }) {
  const color = tone === "risk" ? "text-amber-700" : tone === "primary" ? "text-primary" : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-apple-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function RequestCard({ request, onOpen }) {
  const meta = TYPE_META[request.request_type] || TYPE_META.message;
  const Icon = meta.icon;
  const badges = riskBadges(request);
  const isNew = ["new", "pending_review", "needs_client_approval"].includes(request.status);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-2xl border bg-card p-4 text-left shadow-apple-sm transition-all hover:border-primary/30 hover:shadow-md ${
        isNew ? "border-primary/25" : "border-border"
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border ${meta.className}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
              <Badge className={statusClass(request.status)}>{readable(request.status)}</Badge>
              {request.source_app && <Badge variant="outline" className="uppercase">{request.source_app}</Badge>}
            </div>
            <p className="truncate text-sm font-semibold text-foreground">
              {request.client_name || request.client_email || "Unknown client"}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{request.client_email || "No email"}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{request.created_at ? new Date(request.created_at).toLocaleString() : ""}</p>
      </div>

      <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{request.preview || "No preview"}</p>

      {badges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {badges.map((badge) => (
            <span key={badge.label} className={`rounded-full border px-2 py-1 text-xs font-medium ${badge.className}`}>
              {badge.label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function RequestDetailDialog({ request, open, onOpenChange, onStatusChange, isUpdating }) {
  const [note, setNote] = useState("");
  const statusOptions = request ? statusOptionsFor(request.request_type) : [];
  const meta = request ? (TYPE_META[request.request_type] || TYPE_META.message) : TYPE_META.message;
  const Icon = meta.icon;

  React.useEffect(() => {
    if (open) setNote("");
  }, [open, request?.id]);

  if (!request) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {meta.label}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          <Info label="Client" value={request.client_name || "Unknown"} />
          <Info label="Email" value={request.client_email || "No email"} />
          <Info label="Source" value={(request.source_app || "xlab").toUpperCase()} />
          <Info label="Created" value={request.created_at ? new Date(request.created_at).toLocaleString() : "Unknown"} />
          <Info label="Client ID" value={request.client_id || "Not linked"} mono />
          <Info label="Request ID" value={request.id} mono />
        </div>

        <section className="rounded-xl border border-border bg-secondary/30 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Preview</p>
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{request.preview || "No preview"}</p>
        </section>

        <PayloadView request={request} />

        {statusOptions.length > 0 && (
          <section className="rounded-xl border border-border p-4">
            <Label>Status</Label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <Select value={request.status} onValueChange={onStatusChange} disabled={isUpdating}>
                <SelectTrigger className="sm:w-72"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>{readable(status)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isUpdating && <p className="text-sm text-muted-foreground">Updating...</p>}
            </div>
          </section>
        )}

        <section className="rounded-xl border border-border p-4">
          <Label>Internal action note</Label>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Temporary local note for this review. Full note saving can be added in Phase 2."
            className="mt-2"
          />
          <p className="mt-2 text-xs text-muted-foreground">This note is not saved yet. Use status updates for Phase 1.5 tracking.</p>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function PayloadView({ request }) {
  const payload = request.payload || {};

  if (request.request_type === "tech_pack") {
    const specs = payload.specs || {};
    return (
      <section className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-amber-800">Brand Setup / Tech Pack</p>
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <Info label="Title" value={payload.title || request.preview} />
          <Info label="Type" value={readable(payload.tech_pack_type)} />
          <Info label="Template" value={payload.template_name || "Template"} />
          <Info label="Updated" value={payload.updated_at ? new Date(payload.updated_at).toLocaleString() : "Unknown"} />
        </div>
        <KeyValueList data={specs} />
      </section>
    );
  }

  if (request.request_type === "special_instruction") {
    return (
      <section className="rounded-xl border border-red-100 bg-red-50/40 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-red-700">Production Instruction</p>
        <Info label="Instruction type" value={readable(payload.instruction_type)} />
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{payload.instruction}</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Details</p>
      <KeyValueList data={payload} />
    </section>
  );
}

function KeyValueList({ data }) {
  const entries = Object.entries(data || {}).filter(([, value]) => value !== null && value !== "" && value !== undefined);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No structured details.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-lg bg-background/80 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{readable(key)}</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
            {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}
          </p>
        </div>
      ))}
    </div>
  );
}

function Info({ label, value, mono }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`break-words text-sm text-foreground ${mono ? "font-mono" : ""}`}>{value || "-"}</p>
    </div>
  );
}

function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <h2 className="font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}
