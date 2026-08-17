import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  CreditCard,
  ExternalLink,
  FileSignature,
  FileText,
  Inbox,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  UserRoundPen,
} from "lucide-react";
import { toast } from "sonner";
import {
  addInternalClientMessageReply,
  approveClientQuoteRequest,
  getClientQuoteRequestOrder,
  getInternalClientFileLibrary,
  listClientOrdersAwaitingPayment,
  listClientRequests,
  updateClientRequestStatus,
} from "@/api/clientRequests";
import {
  CLIENT_ORDERS_AWAITING_PAYMENT_QUERY_KEY,
  CLIENT_REQUESTS_QUERY_KEY,
  MAX_QUANTITY,
  MAX_UNIT_PRICE,
  buildApprovalPayload,
  computeApprovalTotal,
  formatAwaitingPaymentOrder,
  formatLinkedOrder,
  invalidateAfterApproval,
  isApprovedStatusLocked,
  refreshAllSections,
  resolveApprovalMutationResult,
  validateApprovalItems,
} from "@/features/clientRequests/quoteApprovalCalculations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getSignedFileUrl, useSignedFileUrl } from "@/lib/privateFiles";

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

// Used by collectPayloadReferences() when a scanned URL has no accompanying
// name/file_name/title metadata (e.g. a bare URL parsed out of a free-text
// "details" line). Was missing entirely, which threw a ReferenceError on
// first render for any request with that shape — with no error boundary
// wrapping the route, that unmounted the whole page, which is what showed
// up as a blank screen. Mirrors the existing helper in Orders.jsx /
// NewOrderDrawer.jsx for consistency.
function fileNameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    return decodeURIComponent(pathname.split("/").filter(Boolean).pop() || url);
  } catch {
    return decodeURIComponent(String(url).split("/").filter(Boolean).pop() || String(url));
  }
}

function titleCase(value = "") {
  return readable(value)
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function valueText(value) {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (typeof value === "object") {
    const label = value.name || value.title || value.label || value.url || value.href;
    return label ? String(label) : JSON.stringify(value, null, 2);
  }
  return String(value);
}

function pickFirst(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    const text = valueText(value);
    if (text) return text;
  }
  return "";
}

function parseDetailLines(details = "") {
  const parsed = {};
  String(details || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(/^([^:]{2,60}):\s*(.+)$/);
      if (!match) return;
      parsed[match[1].toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")] = match[2].trim();
    });
  return parsed;
}

function requestSections(request) {
  const payload = request.payload || {};
  const details = parseDetailLines(payload.details);
  const specs = payload.specs || {};
  const merged = { ...payload, ...details, ...specs };

  if (request.request_type === "tech_pack") {
    return [
      {
        title: "Brand Kit / Product Setup",
        rows: [
          ["Setup title", payload.title || request.preview],
          ["Setup type", readable(payload.tech_pack_type)],
          ["Template", payload.template_name],
          ["Approval status", readable(request.status)],
          ["Updated", payload.updated_at ? new Date(payload.updated_at).toLocaleString() : ""],
        ],
      },
      {
        title: "Product",
        rows: [
          ["Selected product", pickFirst(merged, ["selected_product_name", "product_name", "product", "product_type"])],
          ["Product ID", pickFirst(merged, ["selected_product_id", "product_id"])],
          ["Fabric / GSM", pickFirst(merged, ["preferred_gsm", "gsm", "fabric", "fabric_preference"])],
          ["Colours", pickFirst(merged, ["color_preferences", "colour_preferences", "colours", "colors"])],
        ],
      },
      {
        title: "Design / Print",
        rows: [
          ["Print method", pickFirst(merged, ["print_method", "method"])],
          ["Placement", pickFirst(merged, ["print_placement", "placement", "placements"])],
          ["Print size", pickFirst(merged, ["print_size", "size"])],
          ["Artwork", pickFirst(merged, ["artwork_note", "artwork_file", "artwork"])],
        ],
      },
      {
        title: "Sizing",
        rows: [
          ["Fit preference", pickFirst(merged, ["preferred_fit", "fit_preference", "fit"])],
          ["Sizing rules", pickFirst(merged, ["fit_sizing_rules", "sizing_rules", "size_notes", "sizing"])],
        ],
      },
      {
        title: "Labels & Packaging",
        rows: [
          ["Labels", pickFirst(merged, ["label_packaging_rules", "neck_label_care_label_notes", "labels", "label_notes"])],
          ["Packaging", pickFirst(merged, ["packaging_notes", "packaging"])],
          ["Add-ons", pickFirst(merged, ["selected_add_ons", "add_ons", "addons"])],
        ],
      },
      {
        title: "Production Notes",
        rows: [
          ["Special instructions", pickFirst(merged, ["special_instructions", "special_production_notes", "production_notes", "notes"])],
          ["Quality control", pickFirst(merged, ["quality_control_notes", "quality_control"])],
          ["Substitution rules", pickFirst(merged, ["substitution_rules", "substitutions"])],
        ],
      },
    ];
  }

  if (request.request_type === "special_instruction") {
    return [
      {
        title: "Production Note",
        rows: [
          ["Title", payload.title || request.preview],
          ["Type", readable(payload.instruction_type)],
          ["Instruction", payload.instruction],
          ["Client approval", payload.requires_approval ? (payload.approved_by_client ? "Approved" : "Required") : "Not required"],
          ["Visibility", readable(payload.visibility)],
        ],
      },
    ];
  }

  return [
    {
      title: "Request Summary",
      rows: [
        ["Project / subject", pickFirst(merged, ["project_name", "subject"]) || request.preview],
        ["Request type", readable(request.request_type)],
        ["Status", readable(request.status)],
      ],
    },
    {
      title: "Product / Item",
      rows: [
        ["Selected product", pickFirst(merged, ["selected_product", "selected_product_name", "product_name", "product", "product_type"])],
        ["Product ID", pickFirst(merged, ["selected_product_id", "product_id"])],
        ["Variant / size / colour", pickFirst(merged, ["variant", "size", "colour", "color", "sizes", "colours"])],
        ["Custom item", pickFirst(merged, ["custom_item", "custom_item_name", "item_name"])],
        ["Custom category", pickFirst(merged, ["custom_category", "category"])],
        ["Custom details", pickFirst(merged, ["custom_details", "description"])],
        ["Repeat order", pickFirst(merged, ["repeat_order", "repeat_order_number", "previous_order", "order_number"])],
      ],
    },
    {
      title: "Print & Add-ons",
      rows: [
        ["Print method", pickFirst(merged, ["print_method", "method"])],
        ["Placements", pickFirst(merged, ["placements", "print_placement", "front_print", "back_print", "sleeve_print"])],
        ["Labels", pickFirst(merged, ["labels", "neck_label", "care_label", "label_notes"])],
        ["Packaging", pickFirst(merged, ["packaging", "packaging_notes"])],
        ["Selected add-ons", pickFirst(merged, ["selected_add_ons", "add_ons", "addons"])],
        ["Print notes", pickFirst(merged, ["print_notes", "print_add_on_notes"])],
      ],
    },
    {
      title: "Timing",
      rows: [
        ["Quantity", pickFirst(merged, ["quantity"])],
        ["Deadline", pickFirst(merged, ["deadline", "preferred_date", "required_date"])],
        ["Priority", pickFirst(merged, ["priority"])],
        ["Rush note", pickFirst(merged, ["rush_note", "rush_request"])],
      ],
    },
    {
      title: "Estimate & Price Review",
      rows: [
        ["Estimate", pickFirst(merged, ["estimate"])],
        ["Price review", pickFirst(merged, ["price_review_requested"])],
        ["Budget range", pickFirst(merged, ["budget_range", "budget"])],
        ["Reason", pickFirst(merged, ["price_review_reason", "reason"])],
        ["Price note", pickFirst(merged, ["price_review_note", "customer_price_note"])],
      ],
    },
    {
      title: "Files & References",
      rows: [
        ["Reference URL", pickFirst(merged, ["reference_url", "reference_link", "url"])],
        ["Mockups", pickFirst(merged, ["mockups", "mockup"])],
        ["Artwork / graphic files", pickFirst(merged, ["artwork_files", "artwork", "graphic_files"])],
        ["Brand assets", pickFirst(merged, ["brand_assets"])],
        ["References", pickFirst(merged, ["references", "reference_notes"])],
        ["Production documents", pickFirst(merged, ["production_documents"])],
      ],
    },
    {
      title: "Notes",
      rows: [
        ["Customer notes", pickFirst(merged, ["notes", "message", "details"])],
        ["Production notes", pickFirst(merged, ["production_notes", "special_instructions"])],
      ],
    },
  ];
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
  const details = parseDetailLines(payload.details);
  const specs = payload.specs || {};
  const merged = { ...payload, ...details, ...specs };
  const badges = [];
  const instructionType = payload.instruction_type;
  const priority = String(pickFirst(merged, ["priority", "rush_request"]) || "").toLowerCase();
  const deadline = pickFirst(merged, ["deadline", "preferred_date", "required_date"]);
  const priceReview = pickFirst(merged, ["price_review_requested"]);
  const customItem = pickFirst(merged, ["custom_item", "custom_item_name", "item_name"]);
  const references = collectPayloadReferences(request);

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

  if (priority.includes("rush")) {
    badges.push({ label: "Rush request", className: "bg-red-50 text-red-700 border-red-100" });
  }

  if (deadline && String(deadline).toLowerCase() !== "no deadline") {
    badges.push({ label: "Deadline set", className: "bg-amber-50 text-amber-800 border-amber-100" });
  }

  if (priceReview === true || String(priceReview).toLowerCase() === "true" || String(priceReview).toLowerCase() === "yes") {
    badges.push({ label: "Price review", className: "bg-blue-50 text-blue-700 border-blue-100" });
  }

  if (customItem) {
    badges.push({ label: "Custom item", className: "bg-slate-50 text-slate-700 border-slate-200" });
  }

  if (references.length > 0) {
    badges.push({ label: `${references.length} reference${references.length === 1 ? "" : "s"}`, className: "bg-emerald-50 text-emerald-700 border-emerald-100" });
  }

  return badges.slice(0, 6);
}

// Once a quote_request/reorder_request is actioned/closed, it is fully
// read-only: no Status selector at all (see isApprovedStatusLocked). The
// resulting order's lifecycle belongs to the order/payment workflow, not to
// moving the source request around manually. This mirrors the DB-side guard
// in 202608060003_quote_approval_regression_guard_and_order_lookup.sql
// (update_internal_client_request_status_unscoped independently rejects a
// linked request moving back to new/reviewing) as defence in depth, not a
// replacement for it - the database still enforces this even if some other
// caller bypasses this UI.
function statusOptionsFor(type, request) {
  if (type === "tech_pack") return TECH_PACK_STATUSES;
  if (type === "special_instruction") return INSTRUCTION_STATUSES;
  if (type === "profile_update") return PROFILE_STATUSES;
  if (type === "message") return WORKFLOW_STATUSES;
  if (["quote_request", "reorder_request"].includes(type)) {
    return isApprovedStatusLocked(type, request?.status) ? [] : WORKFLOW_STATUSES;
  }
  return [];
}

export default function ClientRequests() {
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [sourceApp, setSourceApp] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const queryClient = useQueryClient();

  const { data: requests = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [...CLIENT_REQUESTS_QUERY_KEY, type, status, sourceApp, search],
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
      queryClient.invalidateQueries({ queryKey: CLIENT_REQUESTS_QUERY_KEY });
      toast.success("Request status updated");
    },
    onError: (err) => toast.error(err?.message || "Could not update request"),
  });

  const counts = useMemo(() => ({
    total: requests.length,
    new: requests.filter((item) => ["new", "pending_review", "needs_client_approval"].includes(item.status)).length,
    productionRisk: requests.filter((item) => ["tech_pack", "special_instruction"].includes(item.request_type)).length,
  }), [requests]);

  const {
    data: awaitingPayment = [],
    isLoading: awaitingPaymentLoading,
    error: awaitingPaymentError,
    refetch: refetchAwaitingPayment,
    isFetching: awaitingPaymentFetching,
  } = useQuery({
    queryKey: CLIENT_ORDERS_AWAITING_PAYMENT_QUERY_KEY,
    queryFn: async () => {
      const result = await listClientOrdersAwaitingPayment({ limit: 50 });
      if (result.error) throw new Error(result.error);
      return result.data;
    },
    staleTime: 30_000,
  });

  const isRefreshing = isFetching || awaitingPaymentFetching;

  const handleRefresh = async () => {
    const { hasError } = await refreshAllSections({
      refetchRequests: refetch,
      refetchAwaitingPayment,
    });
    if (hasError) {
      toast.error("Could not refresh all sections. Check your connection and try again.");
    }
  };

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
          <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing} className="rounded-xl">
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Metric label="Visible requests" value={counts.total} />
          <Metric label="Needs review" value={counts.new} tone="primary" />
          <Metric label="Production-sensitive" value={counts.productionRisk} tone="risk" />
        </div>

        <AwaitingPaymentSection orders={awaitingPayment} loading={awaitingPaymentLoading} error={awaitingPaymentError} />

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
        onReplySent={() => setSelected((prev) => prev ? { ...prev, status: "actioned" } : prev)}
        onStatusChange={(nextStatus) => {
          if (!selected) return;
          updateMutation.mutate(
            { type: selected.request_type, id: selected.id, status: nextStatus },
            { onSuccess: () => setSelected((prev) => prev ? { ...prev, status: nextStatus } : prev) },
          );
        }}
        isUpdating={updateMutation.isPending}
        onApproved={(order) => {
          invalidateAfterApproval(queryClient);
          toast.success(`Order ${order.order_number} created - awaiting payment`);
          setSelected((prev) => prev ? { ...prev, status: "actioned" } : prev);
        }}
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

function AwaitingPaymentSection({ orders, loading, error }) {
  if (loading) {
    return (
      <div className="mb-5 h-20 animate-pulse rounded-2xl bg-card" />
    );
  }

  if (error) {
    return (
      <div className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Could not load orders awaiting payment: {error.message || "Unknown error"}
      </div>
    );
  }

  if (!orders.length) return null;

  return (
    <section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-apple-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <CreditCard className="h-4 w-4" />
          Awaiting payment
        </div>
        <Badge variant="outline" className="rounded-full border-amber-300 bg-white text-amber-800">
          {orders.length} order{orders.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <p className="mb-3 text-xs text-amber-800">
        Approved X LAB orders sitting in pending_payment. They stay here until the client pays and sync-to-opps
        promotes them into the normal Orders workflow.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {orders.map((rawOrder) => {
          const order = formatAwaitingPaymentOrder(rawOrder);
          return (
            <div key={order.id} className="rounded-xl border border-amber-200 bg-white p-3">
              <p className="text-sm font-semibold text-foreground">{order.orderNumber}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{order.customerLabel}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-amber-800">{order.amountLabel}</span>
                <span className="text-[11px] text-muted-foreground">
                  {order.createdAt ? order.createdAt.toLocaleDateString() : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function QuoteApprovalSection({ request, onApproved }) {
  const payload = request.payload || {};
  const details = parseDetailLines(payload.details);
  const specs = payload.specs || {};
  const merged = { ...payload, ...details, ...specs };
  const alreadyActioned = ["actioned", "closed"].includes(request.status);

  const defaultItem = () => ({
    product_name: pickFirst(merged, ["selected_product_name", "product_name", "product", "custom_item_name", "custom_item"]) || request.preview || "Item",
    quantity: Number(pickFirst(merged, ["quantity"])) || 1,
    unit_price: "",
  });

  const [items, setItems] = useState([defaultItem()]);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  React.useEffect(() => {
    setItems([defaultItem()]);
    setNote("");
    setTouched(false);
  }, [request.id]);

  const total = computeApprovalTotal(items);
  const validation = validateApprovalItems(items);

  const { data: linkedOrder, isLoading: linkedOrderLoading } = useQuery({
    queryKey: ["clientQuoteRequestOrder", request.id],
    queryFn: async () => {
      const result = await getClientQuoteRequestOrder({ requestId: request.id });
      if (result.error) throw new Error(result.error);
      return result.data;
    },
    enabled: alreadyActioned,
    staleTime: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: async (payload) => resolveApprovalMutationResult(await approveClientQuoteRequest(payload)),
    onSuccess: (result) => onApproved?.(result),
    onError: (err) => toast.error(err?.message || "Could not approve this quote request"),
  });

  const updateItem = (index, patch) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const removeItem = (index) => {
    setItems((current) => current.filter((_, i) => i !== index));
  };

  const submitApproval = () => {
    setTouched(true);
    if (!validation.valid) return;
    const payload = buildApprovalPayload({ requestId: request.id, items, note });
    approveMutation.mutate(payload);
  };

  if (alreadyActioned) {
    if (linkedOrderLoading) {
      return <section className="h-24 animate-pulse rounded-xl border border-emerald-200 bg-emerald-50" />;
    }

    if (!linkedOrder) {
      return (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <BadgeCheck className="h-4 w-4" /> This request has already been actioned
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            No linked order was found - it may have been closed without approval, or approved before this order
            lookup was added.
          </p>
        </section>
      );
    }

    const order = formatLinkedOrder(linkedOrder);
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <BadgeCheck className="h-4 w-4" /> Approved - order {order.orderNumber} ({readable(order.status)})
        </p>
        <p className="mt-1 text-xs text-emerald-700">
          This request was already approved. The saved pricing below is read-only - it stays here on the Awaiting
          Payment list above until the client pays.
        </p>

        <div className="mt-3 space-y-2">
          {order.items.map((item, index) => (
            <div key={index} className="grid grid-cols-[1fr_70px_90px_90px] gap-2 rounded-lg bg-white px-3 py-2 text-sm">
              <span className="truncate text-foreground">{item.productName}</span>
              <span className="text-muted-foreground">{item.quantity ?? "-"}</span>
              <span className="text-muted-foreground">{item.unitPrice != null ? `R${item.unitPrice.toLocaleString()}` : "-"}</span>
              <span className="text-right font-medium text-foreground">
                {item.lineTotal != null ? `R${item.lineTotal.toLocaleString()}` : "-"}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-3 text-right text-sm font-semibold text-emerald-800">Total: {order.totalAmountLabel}</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
        <BadgeCheck className="h-4 w-4 text-primary" /> Approve &amp; create payable order
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Review and price the line items, then approve. This creates an X LAB order in pending_payment and messages
        the client a payment link - it does not touch PayFast or OPPS directly.
      </p>

      <div className="space-y-2">
        {items.map((item, index) => {
          const rowError = touched ? validation.itemErrors[index] : null;
          return (
            <div key={index}>
              <div className="grid grid-cols-[1fr_70px_90px_auto] items-center gap-2">
                <Input
                  value={item.product_name}
                  onChange={(event) => updateItem(index, { product_name: event.target.value })}
                  placeholder="Item name"
                  className={`h-9 ${rowError ? "border-destructive" : ""}`}
                />
                <Input
                  value={item.quantity}
                  onChange={(event) => updateItem(index, { quantity: event.target.value })}
                  type="number"
                  min="1"
                  max={MAX_QUANTITY}
                  placeholder="Qty"
                  className={`h-9 ${rowError ? "border-destructive" : ""}`}
                />
                <Input
                  value={item.unit_price}
                  onChange={(event) => updateItem(index, { unit_price: event.target.value })}
                  type="number"
                  min="0"
                  max={MAX_UNIT_PRICE}
                  step="0.01"
                  placeholder="Price"
                  className={`h-9 ${rowError ? "border-destructive" : ""}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={items.length === 1}
                  onClick={() => removeItem(index)}
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {rowError && <p className="mt-1 text-xs text-destructive">{rowError}</p>}
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setItems((current) => [...current, { product_name: "", quantity: 1, unit_price: "" }])}
        className="mt-2 rounded-xl"
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Add item
      </Button>

      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Optional note to the client"
        className="mt-3"
      />

      {touched && !validation.valid && (
        <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <p className="font-semibold">Fix before approving:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {validation.errors.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">Total: R{total.toLocaleString()}</p>
        <Button
          type="button"
          disabled={(touched && !validation.valid) || approveMutation.isPending}
          onClick={submitApproval}
        >
          {approveMutation.isPending ? "Approving..." : "Approve & create order"}
        </Button>
      </div>
    </section>
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

function RequestDetailDialog({ request, open, onOpenChange, onStatusChange, onReplySent, isUpdating, onApproved }) {
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [previewFile, setPreviewFile] = useState(null);
  const queryClient = useQueryClient();
  const statusOptions = request ? statusOptionsFor(request.request_type, request) : [];
  const meta = request ? (TYPE_META[request.request_type] || TYPE_META.message) : TYPE_META.message;
  const Icon = meta.icon;
  const { data: fileLibrary = { folders: [], files: [] }, isLoading: filesLoading } = useQuery({
    queryKey: ["clientFileLibrary", request?.client_email],
    queryFn: async () => {
      const result = await getInternalClientFileLibrary({ clientEmail: request?.client_email, limit: 80 });
      if (result.error) throw new Error(result.error);
      return result.data;
    },
    enabled: Boolean(open && request?.client_email),
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (open) setNote("");
    if (open) setReply("");
    if (open) setPreviewFile(null);
  }, [open, request?.id]);

  const replyMutation = useMutation({
    mutationFn: addInternalClientMessageReply,
    onSuccess: () => {
      setReply("");
      onReplySent?.();
      queryClient.invalidateQueries({ queryKey: ["clientRequests"] });
      toast.success("Reply sent to client account");
    },
    onError: (err) => toast.error(err?.message || "Could not send reply"),
  });

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

        <PayloadView request={request} onPreview={setPreviewFile} />

        {["quote_request", "reorder_request"].includes(request.request_type) && (
          <QuoteApprovalSection request={request} onApproved={onApproved} />
        )}

        {request.request_type === "message" && (
          <section className="rounded-xl border border-border p-4">
            <Label>Reply to client</Label>
            <Textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Write a client-visible reply. It will appear in the X LAB account messages."
              className="mt-2"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Client-visible. Internal notes stay separate.</p>
              <Button
                type="button"
                disabled={replyMutation.isPending || reply.trim().length < 2}
                onClick={() => replyMutation.mutate({
                  clientEmail: request.client_email,
                  subject: request.payload?.subject ? `Re: ${request.payload.subject}` : "Joint X reply",
                  message: reply,
                  parentMessageId: request.id,
                })}
              >
                {replyMutation.isPending ? "Sending..." : "Send reply"}
              </Button>
            </div>
          </section>
        )}

        <ClientFilesSection library={fileLibrary} loading={filesLoading} onPreview={setPreviewFile} />
        {previewFile && <FilePreviewPanel file={previewFile} onClose={() => setPreviewFile(null)} />}

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

function PayloadView({ request, onPreview }) {
  const payload = request.payload || {};
  const sections = requestSections(request).filter((section) =>
    section.rows.some(([, value]) => valueText(value))
  );
  const references = collectPayloadReferences(request);

  return (
    <div className="space-y-3">
      {sections.length === 0 ? (
        <section className="rounded-xl border border-border p-4">
          <p className="text-sm text-muted-foreground">No structured details.</p>
        </section>
      ) : (
        sections.map((section) => (
          <section key={section.title} className="rounded-xl border border-border p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{section.title}</p>
            <div className="grid gap-2 md:grid-cols-2">
              {section.rows
                .filter(([, value]) => valueText(value))
                .map(([label, value]) => (
                  <Info key={label} label={label} value={valueText(value)} />
                ))}
            </div>
          </section>
        ))
      )}

      {references.length > 0 && <PayloadReferencesSection references={references} onPreview={onPreview} />}

      <details className="rounded-xl border border-border p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Technical payload
          <ChevronDown className="h-4 w-4" />
        </summary>
        <div className="mt-3">
          <KeyValueList data={payload} />
        </div>
      </details>
    </div>
  );
}

function collectPayloadReferences(request) {
  const payload = request.payload || {};
  const details = parseDetailLines(payload.details);
  const specs = payload.specs || {};
  const merged = { ...payload, ...details, ...specs };
  const keys = [
    "reference_url",
    "reference_link",
    "url",
    "mockups",
    "mockup",
    "artwork_files",
    "artwork_file",
    "artwork",
    "graphic_files",
    "brand_assets",
    "references",
    "reference_files",
    "uploaded_files",
    "files",
    "production_documents",
  ];
  const seen = new Set();
  const refs = [];
  const urlRegex = /https?:\/\/[^\s,]+/gi;

  const addRef = (url, meta = {}) => {
    // Regex-extracted URLs (see urlRegex below) grab trailing punctuation
    // from surrounding prose, e.g. the closing ")" in "(https://...jpg)" -
    // trim it so the link actually resolves instead of 404ing on a
    // mangled object key.
    const cleanUrl = String(url || "").trim().replace(/[)\].,;]+$/, "");
    if (!cleanUrl || seen.has(cleanUrl)) return;
    seen.add(cleanUrl);
    refs.push({
      url: cleanUrl,
      name: meta.name || meta.file_name || meta.title || fileNameFromUrl(cleanUrl),
      type: meta.type || meta.file_type || meta.bucket || "Reference",
    });
  };

  const scan = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(scan);
      return;
    }
    if (typeof value === "object") {
      const url = value.url || value.file_url || value.fileUrl || value.href || value.link || value.reference_url;
      if (url) addRef(url, value);
      Object.entries(value).forEach(([key, nested]) => {
        if (["url", "file_url", "fileUrl", "href", "link", "reference_url"].includes(key)) return;
        if (Array.isArray(nested) || typeof nested === "object") scan(nested);
      });
      return;
    }
    String(value).match(urlRegex)?.forEach((url) => addRef(url));
  };

  keys.forEach((key) => scan(merged[key]));
  return refs.slice(0, 20);
}

function canShowImageFile(url = "", type = "") {
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(url) || String(type || "").toLowerCase().startsWith("image/");
}

function SecureFileThumb({ url, type, name }) {
  const { url: signedUrl, loading, error, isPrivate } = useSignedFileUrl(url);
  const displayUrl = signedUrl || (isPrivate ? "" : url);
  const canRender = displayUrl && !loading && !error && canShowImageFile(url, type);

  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary">
      {canRender ? (
        <img src={displayUrl} alt={name || ""} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <FileText className="h-4 w-4 text-muted-foreground" />
      )}
    </span>
  );
}

function PayloadReferencesSection({ references, onPreview }) {

  return (
    <section className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Request references</p>
        <Badge variant="outline" className="rounded-full">{references.length} link{references.length === 1 ? "" : "s"}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {references.map((ref) => (
          <button
            key={ref.url}
            type="button"
            onClick={() => onPreview?.({ file_url: ref.url, file_name: ref.name, file_type: ref.type })}
            className="flex items-center gap-3 rounded-xl border border-border bg-background p-2 text-left text-sm hover:border-primary/30"
          >
            <SecureFileThumb url={ref.url} type={ref.type} name={ref.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{ref.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{ref.type}</span>
            </span>
            <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </section>
  );
}

function ClientFilesSection({ library, loading, onPreview }) {
  const folders = Array.isArray(library?.folders) ? library.folders : [];
  const files = Array.isArray(library?.files) ? library.files : [];
  const folderName = (folderId) => folders.find((folder) => folder.id === folderId)?.name || "References";
  const grouped = files.reduce((acc, file) => {
    const name = folderName(file.folder_id);
    if (!acc[name]) acc[name] = [];
    acc[name].push(file);
    return acc;
  }, {});

  if (loading) {
    return (
      <section className="rounded-xl border border-border p-4">
        <p className="text-sm text-muted-foreground">Loading client files...</p>
      </section>
    );
  }

  if (!files.length) {
    return (
      <section className="rounded-xl border border-border p-4">
        <div className="mb-2 flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-primary" />
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Client files</p>
        </div>
        <p className="text-sm text-muted-foreground">No persistent account files uploaded by this client yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-primary" />
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Client files</p>
        </div>
        <Badge variant="outline" className="rounded-full">{files.length} file{files.length === 1 ? "" : "s"}</Badge>
      </div>
      <div className="space-y-3">
        {Object.entries(grouped).map(([folder, folderFiles]) => (
          <div key={folder} className="rounded-xl bg-secondary/30 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">{folder}</p>
              <span className="text-xs text-muted-foreground">{folderFiles.length} item{folderFiles.length === 1 ? "" : "s"}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {folderFiles.map((file) => (
                <button
                  type="button"
                  key={file.id}
                  onClick={() => onPreview?.(file)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background p-2 text-left text-sm hover:border-primary/30"
                >
                  <SecureFileThumb url={file.file_url} type={file.file_type} name={file.file_name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{file.file_name || "File"}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {file.file_type || "file"} {file.created_at ? `- ${new Date(file.created_at).toLocaleDateString()}` : ""}
                    </span>
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FilePreviewPanel({ file, onClose }) {
  const url = file?.file_url || "";
  const name = file?.file_name || "Client file";
  const type = String(file?.file_type || name || url).toLowerCase();
  const { url: signedUrl, loading, error, isPrivate } = useSignedFileUrl(url);
  const displayUrl = signedUrl || (isPrivate ? "" : url);
  const canPreview = displayUrl && !loading && !error;
  const canShowImage = canPreview && canShowImageFile(url, type);
  const canShowPdf = canPreview && (/\.pdf(\?|#|$)/i.test(url) || type.includes("pdf"));

  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Preview</p>
          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Close</Button>
          {url && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                const copyUrl = isPrivate ? await getSignedFileUrl(url) : displayUrl;
                await navigator.clipboard?.writeText(copyUrl || url);
                toast.success(isPrivate ? "Secure file link copied" : "File link copied");
              }}
            >
              Copy link
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-background">
        {canShowImage ? (
          <img src={displayUrl} alt={name} className="max-h-[60vh] w-full object-contain" loading="lazy" />
        ) : canShowPdf ? (
          <iframe title={name} src={displayUrl} className="h-[60vh] w-full bg-white" />
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold text-foreground">Preview is not available for this file type.</p>
              <p className="mt-1 text-sm text-muted-foreground">{error ? "You do not have access to this file." : loading ? "Preparing secure file link..." : "Copy the file link if this file type needs a specialist app."}</p>
            </div>
          </div>
        )}
      </div>
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
      <p className={`whitespace-pre-wrap break-words text-sm text-foreground ${mono ? "font-mono" : ""}`}>{value || "-"}</p>
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
