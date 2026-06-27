import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  Printer,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  isValidReadinessOrderId,
  updateOrderProductionReadinessCheck,
} from "@/api/productionReadiness";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import SignedFileLink from "@/components/common/SignedFileLink";

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

function isReadinessAuthError(message = "") {
  const lower = String(message || "").toLowerCase();
  return lower.includes("not authorised")
    || lower.includes("not authorized")
    || lower.includes("permission denied")
    || lower.includes("row-level security");
}

export default function ProductionReadinessCard({ order, readinessQuery }) {
  const [notes, setNotes] = useState({});
  const [showPrintSheet, setShowPrintSheet] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["productionReadiness", order?.id];
  const canLoadReadiness = isValidReadinessOrderId(order?.id);
  const { data, isLoading, error, refetch, isAuthorizationBlocked } = readinessQuery || {};
  const authError = isAuthorizationBlocked || isReadinessAuthError(error?.message);

  const updateMutation = useMutation({
    mutationFn: updateOrderProductionReadinessCheck,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Production readiness updated");
    },
    onError: (err) => toast.error(err?.message || "Could not update readiness"),
  });

  if (!canLoadReadiness) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" />
          <div>
            <p className="font-semibold text-amber-900">Production Readiness is unavailable</p>
            <p className="mt-1 text-sm leading-6 text-amber-800">
              This order needs a saved Supabase order id before readiness checks can load.
            </p>
          </div>
        </div>
      </section>
    );
  }

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
            <p className="font-semibold text-amber-900">
              {authError ? "Production Readiness is restricted" : "Production Readiness is not ready yet"}
            </p>
            <p className="mt-1 text-sm leading-6 text-amber-800">
              {authError ? "Not authorised to view production readiness." : error.message}
            </p>
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowPrintSheet(true)}
            className="h-8 rounded-lg no-print"
          >
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            Print
          </Button>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={authError || !refetch}
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
                  <p className="mt-0.5 text-xs capitalize text-muted-foreground">{readable(item.tech_pack_type)} - {readable(item.status)}</p>
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

      {showPrintSheet && (
        <ProductionSheetModal
          order={order}
          readiness={data}
          onClose={() => setShowPrintSheet(false)}
        />
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

function ProductionSheetModal({ order, readiness, onClose }) {
  const readinessOrder = readiness.order || {};
  const checks = readiness.checks || [];
  const warnings = readiness.warnings || [];
  const techPacks = readiness.tech_packs || [];
  const instructions = readiness.special_instructions || [];
  const approvals = readiness.approvals || [];
  const contracts = readiness.contracts || [];
  const products = Array.isArray(order.products) ? order.products : [];
  const fileUrls = Array.isArray(order.file_urls) ? order.file_urls : [];
  const invoices = Array.isArray(order.invoice_files) ? order.invoice_files : [];
  const printedAt = new Date().toLocaleString();

  return (
    <div className="fixed inset-0 z-[90] bg-black/30 p-4 print:static print:bg-white print:p-0">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .production-sheet-print, .production-sheet-print * { visibility: visible !important; }
          .production-sheet-print {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            max-width: none !important;
            box-shadow: none !important;
            border: 0 !important;
            color: #111 !important;
            background: #fff !important;
          }
          .production-sheet-actions { display: none !important; }
          .production-sheet-section { break-inside: avoid; page-break-inside: avoid; }
          a { color: #111 !important; text-decoration: none !important; }
        }
      `}</style>
      <div className="mx-auto flex max-h-[92vh] max-w-4xl flex-col overflow-hidden rounded-2xl bg-card shadow-apple-xl production-sheet-print print:max-h-none print:overflow-visible print:rounded-none">
        <div className="production-sheet-actions flex items-center justify-between border-b border-border p-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Print Production Sheet</p>
            <p className="text-xs text-muted-foreground">Browser print, A4-friendly, no generated PDF.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => window.print()} className="rounded-xl">
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground hover:text-foreground"
              aria-label="Close production sheet"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-6 print:overflow-visible print:p-8">
          <header className="mb-6 border-b border-zinc-300 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Joint X / X LAB</p>
                <h1 className="mt-1 text-2xl font-bold text-zinc-950">Production Sheet</h1>
                <p className="mt-1 text-sm text-zinc-600">Confirm all details before production.</p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-sm font-semibold text-zinc-950">#{readinessOrder.order_number || order.order_number || order.id}</p>
                <p className="text-xs text-zinc-600">Printed {printedAt}</p>
              </div>
            </div>
          </header>

          <div className="grid gap-4 md:grid-cols-2">
            <PrintSection title="Client">
              <PrintRow label="Name" value={readinessOrder.client_name || order.client_name} />
              <PrintRow label="Email" value={readinessOrder.client_email || order.client_email} />
              <PrintRow label="Phone" value={order.client_phone || order.phone} />
              <PrintRow label="Company" value={order.company_name || order.brand_name} />
            </PrintSection>

            <PrintSection title="Order">
              <PrintRow label="Status" value={readable(readinessOrder.status || order.status)} />
              <PrintRow label="Pipeline" value={readable(readinessOrder.pipeline_stage || order.pipeline_stage)} />
              <PrintRow label="Total" value={order.total_amount ? `R${Number(order.total_amount).toLocaleString()}` : ""} />
              <PrintRow label="Balance due" value={readinessOrder.balance_due ? `R${Number(readinessOrder.balance_due).toLocaleString()}` : "R0"} />
            </PrintSection>
          </div>

          <PrintSection title="Product / Order Summary">
            {products.length > 0 ? (
              <div className="space-y-2">
                {products.map((product, index) => (
                  <div key={`${product.name || product.title || "product"}-${index}`} className="rounded-lg border border-zinc-200 p-3">
                    <p className="font-semibold text-zinc-950">{product.name || product.title || "Product"}</p>
                    <div className="mt-1 grid gap-1 text-sm text-zinc-700 sm:grid-cols-3">
                      <span>Qty: {product.quantity || product.qty || "-"}</span>
                      <span>Size: {product.size || product.sizes || "-"}</span>
                      <span>Colour: {product.color || product.colour || "-"}</span>
                    </div>
                    {product.notes && <p className="mt-2 text-sm text-zinc-700">{product.notes}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-600">{order.notes || "No structured products on this order yet."}</p>
            )}
          </PrintSection>

          {warnings.length > 0 && (
            <PrintSection title="Production Warnings" tone="warn">
              <div className="space-y-2">
                {warnings.map((warning, index) => (
                  <p key={`${warning.type}-${index}`} className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm font-medium text-amber-950">
                    {warning.message}
                  </p>
                ))}
              </div>
            </PrintSection>
          )}

          <PrintSection title="Production Notes">
            {instructions.length > 0 ? (
              <div className="space-y-2">
                {instructions.map((instruction) => (
                  <div key={instruction.id} className="rounded-lg border border-zinc-200 p-3">
                    <p className="font-semibold text-zinc-950">
                      {instruction.title || readable(instruction.instruction_type)}
                      {["sizing", "fit", "print", "quality_control"].includes(instruction.instruction_type) && (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">{readable(instruction.instruction_type)}</span>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-zinc-700">{instruction.instruction}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-600">No active production notes found.</p>
            )}
          </PrintSection>

          <PrintSection title="Brand Kit / Product Setup">
            {techPacks.length > 0 ? (
              <div className="space-y-2">
                {techPacks.map((pack) => (
                  <div key={pack.id} className="rounded-lg border border-zinc-200 p-3">
                    <p className="font-semibold text-zinc-950">{pack.title || "Brand Setup"}</p>
                    <p className="text-sm text-zinc-600">{readable(pack.tech_pack_type)} - {readable(pack.status)}</p>
                    {pack.specs && Object.keys(pack.specs).length > 0 && (
                      <div className="mt-2 grid gap-1 text-sm text-zinc-700 sm:grid-cols-2">
                        {Object.entries(pack.specs).slice(0, 8).map(([key, value]) => (
                          <span key={key}><strong>{titleCase(key)}:</strong> {formatPrintValue(value)}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-600">No linked product setup found.</p>
            )}
          </PrintSection>

          <div className="grid gap-4 md:grid-cols-2">
            <PrintSection title="Files">
              <PrintFileList files={fileUrls.map((url) => ({ name: fileName(url), url }))} empty="No artwork/files attached." />
            </PrintSection>
            <PrintSection title="Invoices">
              <PrintFileList files={invoices.map((file) => ({ name: file.name || file.invoice_number || file.url, url: file.url }))} empty="No invoice files attached." />
            </PrintSection>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <PrintSection title="Approvals">
              {approvals.length > 0 ? approvals.map((approval) => (
                <PrintRow
                  key={approval.id}
                  label={readable(approval.approval_type)}
                  value={readable(approval.status)}
                />
              )) : <p className="text-sm text-zinc-600">No approval records found.</p>}
            </PrintSection>
            <PrintSection title="Contracts">
              {contracts.length > 0 ? contracts.map((contract) => (
                <PrintRow
                  key={contract.id}
                  label={contract.contract_name || contract.contract_type || "Contract"}
                  value={contract.accepted_at ? `Accepted ${new Date(contract.accepted_at).toLocaleDateString()}` : "Accepted"}
                />
              )) : <p className="text-sm text-zinc-600">No contract acceptances found.</p>}
            </PrintSection>
          </div>

          <PrintSection title="Readiness Checklist">
            <div className="space-y-2">
              {checks.map((check) => (
                <div key={check.check_key} className="grid gap-2 rounded-lg border border-zinc-200 p-3 sm:grid-cols-[1fr_140px]">
                  <div>
                    <p className="font-semibold text-zinc-950">{check.label}</p>
                    {check.notes && <p className="mt-1 text-sm text-zinc-600">{check.notes}</p>}
                  </div>
                  <p className="text-sm font-semibold text-zinc-800">{readable(check.status || "pending")}</p>
                </div>
              ))}
            </div>
          </PrintSection>

          <footer className="mt-6 border-t border-zinc-300 pt-4 text-xs text-zinc-600">
            Confirm all details before production. OPPS order: {order.id}
          </footer>
        </div>
      </div>
    </div>
  );
}

function PrintSection({ title, children, tone }) {
  return (
    <section className={`production-sheet-section mt-4 rounded-xl border p-4 ${
      tone === "warn" ? "border-amber-300 bg-amber-50" : "border-zinc-200 bg-white"
    }`}>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

function PrintRow({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="mb-2 grid grid-cols-[120px_1fr] gap-3 text-sm">
      <span className="font-semibold text-zinc-500">{label}</span>
      <span className="break-words text-zinc-950">{value}</span>
    </div>
  );
}

function PrintFileList({ files, empty }) {
  const validFiles = files.filter((file) => file.url || file.name);
  if (validFiles.length === 0) return <p className="text-sm text-zinc-600">{empty}</p>;
  return (
    <div className="space-y-2">
      {validFiles.map((file, index) => (
        <div key={`${file.url || file.name}-${index}`} className="break-words rounded-lg border border-zinc-200 p-2 text-sm">
          {file.url ? (
            <SignedFileLink url={file.url} target="_blank" rel="noreferrer" className="text-zinc-950 underline underline-offset-2">
              {file.name || file.url}
            </SignedFileLink>
          ) : (
            <span>{file.name}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function formatPrintValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fileName(url = "") {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split("/").pop() || url);
  } catch {
    return String(url).split("/").pop() || String(url);
  }
}
