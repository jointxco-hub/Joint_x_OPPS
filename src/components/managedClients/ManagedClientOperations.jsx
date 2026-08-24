import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import {
  adminUpdateManagedClientWorkspace,
  adminInitializeManagedClientWorkspace,
  adminPreviewManagedBrandProvisioning,
  adminProvisionManagedBrand,
  adminActivateManagedXosDomain,
  adminSetManagedTenantProductsCapability,
} from "@/api/managedClients";
import {
  EMPTY_WORKSPACE_FORM,
  workspaceRowToForm,
  formToUpdates,
  diffWorkspaceForm,
  fingerprintPreviewInput,
} from "@/lib/managedClientForms";

// Phase 2 operator surface for Managed Clients - workspace editing,
// modern-tenant workspace initialization, products capability control,
// XOS domain activation, and the Add Managed Brand wizard. Every mutation
// here is a thin call into a narrow, app-admin-only RPC (see
// supabase/migrations/20260824090000_managed_clients_phase2_operations.sql)
// - no browser INSERT/UPDATE ever touches tenants/clients/tenant_domains/
// tenant_memberships/tenant_capabilities/managed_client_workspaces
// directly.

export const CLIENT_TYPES = ["Photographer", "Fashion Brand", "Printing Client", "Service Business", "Other"];
export const SITE_TYPES = [
  "Portfolio / Booking", "Catalog", "Ecommerce", "Preorder", "Landing Page",
  "Quote Request", "Service Website", "Other",
];
export const ONBOARDING_STAGES = [
  "01 Intake", "02 Brand Assets", "03 Site Content", "04 Products / Services",
  "05 Pricing", "06 Mockups", "07 Build", "08 Review", "09 Live", "10 Monthly Management",
];

const UNSET = "__unset__";

function ConstrainedSelect({ label, value, onChange, options }) {
  return (
    <div>
      <Label className="text-xs text-slate-500">{label}</Label>
      <Select value={value || UNSET} onValueChange={(v) => onChange(v === UNSET ? "" : v)}>
        <SelectTrigger className="mt-1">
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>Not set</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TextField({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <Label className="text-xs text-slate-500">{label}</Label>
      <Input className="mt-1" type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// Shared by "Edit Workspace" (mode="edit") and "Set up workspace"
// (mode="init") - same field set, different RPC underneath.
export function WorkspaceFormDialog({ open, onOpenChange, mode, row }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => (mode === "edit" ? workspaceRowToForm(row) : { ...EMPTY_WORKSPACE_FORM }));
  // Pinned snapshot of the form as loaded, for EDIT mode's patch-style
  // diff - never updated after mount, so it always reflects what the
  // operator actually started from.
  const [originalForm] = useState(() => (mode === "edit" ? workspaceRowToForm(row) : null));
  const [saving, setSaving] = useState(false);

  const setField = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function handleSave() {
    setSaving(true);
    try {
      if (mode === "edit") {
        const { error } = await adminUpdateManagedClientWorkspace({
          workspaceId: row.workspace_id,
          updates: diffWorkspaceForm(form, originalForm),
        });
        if (error) {
          toast.error(error);
          return;
        }
        toast.success("Workspace updated");
      } else {
        const { error } = await adminInitializeManagedClientWorkspace({
          tenantId: row.tenant_id,
          workspace: formToUpdates(form),
        });
        if (error) {
          toast.error(error);
          return;
        }
        toast.success("Workspace initialized");
      }
      queryClient.invalidateQueries({ queryKey: ["managedClients"] });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit Workspace" : "Set up workspace"}</DialogTitle>
          <p className="text-sm text-slate-500">{row.brand_name}</p>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <ConstrainedSelect label="Client type" value={form.client_type} onChange={setField("client_type")} options={CLIENT_TYPES} />
          <ConstrainedSelect label="Site type" value={form.site_type} onChange={setField("site_type")} options={SITE_TYPES} />
          <ConstrainedSelect label="Onboarding stage" value={form.onboarding_stage} onChange={setField("onboarding_stage")} options={ONBOARDING_STAGES} />
          <TextField label="Site status" value={form.site_status} onChange={setField("site_status")} />
          <TextField label="Storefront status" value={form.storefront_status} onChange={setField("storefront_status")} />
          <TextField label="Domain status" value={form.domain_status} onChange={setField("domain_status")} />
          <TextField label="Assets status" value={form.assets_status} onChange={setField("assets_status")} />
          <TextField label="Content status" value={form.content_status} onChange={setField("content_status")} />
          <TextField label="Products / services status" value={form.products_services_status} onChange={setField("products_services_status")} />
          <TextField label="Pricing status" value={form.pricing_status} onChange={setField("pricing_status")} />
          <TextField label="Mockup status" value={form.mockup_status} onChange={setField("mockup_status")} />
          <TextField label="Launch readiness status" value={form.launch_readiness_status} onChange={setField("launch_readiness_status")} />
          <TextField label="Preview URL" value={form.preview_url} onChange={setField("preview_url")} />
          <TextField label="Live URL" value={form.live_url} onChange={setField("live_url")} />
          <TextField label="Domain name" value={form.domain_name} onChange={setField("domain_name")} />
          <TextField label="Repository URL" value={form.site_repo_url} onChange={setField("site_repo_url")} />
          <TextField label="Next action" value={form.next_action} onChange={setField("next_action")} />
          <TextField label="Next action owner" value={form.next_action_owner} onChange={setField("next_action_owner")} />
          <TextField label="Next action due" type="date" value={form.next_action_due_at} onChange={setField("next_action_due_at")} />
          <TextField label="Launch target date" type="date" value={form.launch_target_date} onChange={setField("launch_target_date")} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Internal notes</Label>
          <Textarea className="mt-1" rows={3} value={form.internal_notes} onChange={(e) => setField("internal_notes")(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Turning the capability off only controls the XOS-side flag - it never
// touches commerce.products (enforced server-side by
// admin_set_managed_tenant_products_capability; see that RPC's header).
export function ProductsCapabilityCard({ row }) {
  const queryClient = useQueryClient();
  const [toggling, setToggling] = useState(false);

  async function handleToggle(next) {
    setToggling(true);
    try {
      const { error } = await adminSetManagedTenantProductsCapability({ tenantId: row.tenant_id, enabled: next });
      if (error) {
        toast.error(error);
        return;
      }
      toast.success(`Products capability ${next ? "enabled" : "disabled"}`);
      queryClient.invalidateQueries({ queryKey: ["managedClients"] });
    } finally {
      setToggling(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Products capability</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Controls only the XOS products capability flag - turning this off does not delete or alter any existing Commerce product.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">{row.products_capability_enabled ? "Enabled" : "Disabled"}</span>
          <Switch checked={Boolean(row.products_capability_enabled)} disabled={toggling} onCheckedChange={handleToggle} />
        </div>
      </div>
    </section>
  );
}

// Vercel activation gate - the operator confirms the external hostname
// attachment BEFORE this can call admin_activate_managed_xos_domain. The
// two steps (database provisioning and XOS activation) are never
// combined automatically.
export function XosActivationCard({ row }) {
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [activating, setActivating] = useState(false);

  if (row.xos_status === "active") {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-medium text-emerald-900">XOS live at {row.xos_hostname}</p>
      </section>
    );
  }
  if (!row.xos_hostname) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(row.xos_hostname);
      toast.success("Hostname copied");
    } catch {
      toast.error("Could not copy - copy the hostname manually");
    }
  }

  async function handleActivate() {
    setActivating(true);
    try {
      const { error } = await adminActivateManagedXosDomain({ tenantId: row.tenant_id });
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("XOS domain activated");
      queryClient.invalidateQueries({ queryKey: ["managedClients"] });
    } finally {
      setActivating(false);
    }
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-amber-900">Database provisioning complete</p>
        <p className="text-xs text-amber-800 mt-1">
          External step required: attach this hostname to the joint-x-opps Vercel production project.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <code className="text-xs bg-white/70 px-2 py-1 rounded flex-1">{row.xos_hostname}</code>
        <Button size="sm" variant="outline" onClick={handleCopy}><Copy className="w-3.5 h-3.5" /></Button>
      </div>
      <label className="flex items-start gap-2 text-sm text-amber-900">
        <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(Boolean(v))} className="mt-0.5" />
        I confirm this hostname is attached to the correct Vercel project.
      </label>
      <Button size="sm" disabled={!confirmed || activating} onClick={handleActivate}>
        {activating ? "Activating..." : "Activate XOS"}
      </Button>
    </section>
  );
}

const WIZARD_STEPS = ["Brand", "Workspace", "Owner / Preflight", "Review", "Provision", "External activation"];

export function AddManagedBrandWizard({ open, onOpenChange }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [brand, setBrand] = useState({ workspace_name: "", client_name: "", client_email: "" });
  const [workspace, setWorkspace] = useState({ tenant_slug: "", client_type: "", site_type: "", products_enabled: false });
  const [preflight, setPreflight] = useState(null);
  const [preflightFingerprint, setPreflightFingerprint] = useState(null);
  const [checking, setChecking] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [activating, setActivating] = useState(false);

  // Generated once per wizard session (mount) - a fresh call to this
  // wizard (dialog remounts) gets a fresh key, matching the exact
  // convention already used by CommerceProductsSection.
  const [idempotencyKey] = useState(() => (
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `managed-brand-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  ));

  const previewInput = useMemo(() => ({
    workspace_name: brand.workspace_name,
    tenant_slug: workspace.tenant_slug,
    client_email: brand.client_email,
    client_name: brand.client_name,
  }), [brand, workspace.tenant_slug]);

  // Re-derived on every render from current form state - any edit to a
  // preflight-relevant field automatically changes this without any
  // manual "clear the preflight" plumbing.
  const currentFingerprint = useMemo(() => fingerprintPreviewInput(previewInput), [previewInput]);
  const preflightIsCurrent = Boolean(preflight) && preflightFingerprint === currentFingerprint;
  const canAdvanceFromPreflight = preflightIsCurrent && preflight?.can_provision === true;

  async function runPreflight() {
    setChecking(true);
    try {
      const { data, error } = await adminPreviewManagedBrandProvisioning({ input: previewInput });
      if (error) {
        toast.error(error);
        return;
      }
      setPreflight(data);
      setPreflightFingerprint(fingerprintPreviewInput(previewInput));
    } finally {
      setChecking(false);
    }
  }

  async function handleProvision() {
    // Defensive re-check, mirroring the Review/Next gating - provisioning
    // must always describe/execute the exact same payload the operator
    // reviewed. The backend independently re-validates everything
    // regardless (see admin_provision_managed_brand), this just prevents
    // the call from ever firing on stale UI state in the first place.
    if (!canAdvanceFromPreflight) {
      toast.error("Preflight is out of date for the current input - re-check availability before provisioning.");
      return;
    }
    setProvisioning(true);
    try {
      const { data, error } = await adminProvisionManagedBrand({
        input: {
          workspace_name: brand.workspace_name,
          tenant_slug: workspace.tenant_slug,
          client_email: brand.client_email,
          client_name: brand.client_name,
          client_type: workspace.client_type || null,
          site_type: workspace.site_type || null,
          products_enabled: workspace.products_enabled,
        },
        idempotencyKey,
      });
      if (error) {
        toast.error(error);
        return;
      }
      setProvisionResult(data);
      queryClient.invalidateQueries({ queryKey: ["managedClients"] });
      setStep(5);
    } finally {
      setProvisioning(false);
    }
  }

  async function handleActivate() {
    setActivating(true);
    try {
      const { error } = await adminActivateManagedXosDomain({ tenantId: provisionResult.tenant_id });
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("XOS domain activated");
      queryClient.invalidateQueries({ queryKey: ["managedClients"] });
      onOpenChange(false);
    } finally {
      setActivating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Managed Brand</DialogTitle>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {WIZARD_STEPS.map((label, idx) => (
              <Badge key={label} variant="outline" className={idx === step ? "border-primary text-primary" : "text-slate-400 border-slate-200"}>
                {idx + 1}. {label}
              </Badge>
            ))}
          </div>
        </DialogHeader>

        {step === 0 && (
          <div className="space-y-3">
            <TextField label="Brand / workspace name" value={brand.workspace_name} onChange={(v) => setBrand((b) => ({ ...b, workspace_name: v }))} />
            <TextField label="Client / contact name" value={brand.client_name} onChange={(v) => setBrand((b) => ({ ...b, client_name: v }))} />
            <TextField label="Canonical client / owner email" value={brand.client_email} onChange={(v) => setBrand((b) => ({ ...b, client_email: v }))} />
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <TextField label="Tenant slug" value={workspace.tenant_slug} onChange={(v) => setWorkspace((w) => ({ ...w, tenant_slug: v }))} />
            <ConstrainedSelect label="Client type" value={workspace.client_type} onChange={(v) => setWorkspace((w) => ({ ...w, client_type: v }))} options={CLIENT_TYPES} />
            <ConstrainedSelect label="Site type" value={workspace.site_type} onChange={(v) => setWorkspace((w) => ({ ...w, site_type: v }))} options={SITE_TYPES} />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={workspace.products_enabled} onCheckedChange={(v) => setWorkspace((w) => ({ ...w, products_enabled: Boolean(v) }))} />
              Enable Products capability
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <Button variant="outline" onClick={runPreflight} disabled={checking}>{checking ? "Checking..." : "Check availability"}</Button>
            {preflight && !preflightIsCurrent && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Brand/workspace name, tenant slug, contact name, or email changed since this preflight ran - it no longer describes your current input. Check availability again before continuing.
              </div>
            )}
            {preflight && (
              <div className="space-y-2 text-sm">
                <p>Normalized slug: <code className="bg-slate-100 px-1 rounded">{preflight.normalized_slug || "(invalid)"}</code></p>
                <p>Derived hostname: <code className="bg-slate-100 px-1 rounded">{preflight.derived_hostname || "(invalid)"}</code></p>
                {!preflight.owner_account_exists ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                    <p className="font-medium text-amber-900">Owner account required</p>
                    <p className="text-amber-800 text-xs mt-1">
                      The owner must sign in/create their XOS account with this exact email before the workspace can be provisioned.
                    </p>
                  </div>
                ) : (
                  <p className="text-emerald-700">Owner account found - email matches.</p>
                )}
                {(preflight.blockers || []).length > 0 && (
                  <ul className="list-disc list-inside text-red-600">
                    {preflight.blockers.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-2 text-sm">
            <p className="font-medium">This will create:</p>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              <li>Tenant "{brand.workspace_name}" (slug {preflight?.normalized_slug})</li>
              <li>Client "{brand.client_name}" ({brand.client_email})</li>
              <li>Pending XOS hostname {preflight?.derived_hostname}</li>
              <li>Owner membership for the existing account matching {brand.client_email}</li>
              <li>Products capability: {workspace.products_enabled ? "enabled" : "disabled"}</li>
              <li>Workspace ({workspace.client_type || "no client type"} / {workspace.site_type || "no site type"})</li>
            </ul>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Ready to provision. This is a real, atomic write - review the previous step before continuing.</p>
            <Button onClick={handleProvision} disabled={provisioning || !canAdvanceFromPreflight}>
              {provisioning ? "Provisioning..." : "Provision managed brand"}
            </Button>
          </div>
        )}

        {step === 5 && provisionResult && (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-medium text-emerald-900">Database provisioning complete</p>
              <p className="text-xs text-emerald-800 mt-1">XOS hostname: <code className="bg-white/70 px-1 rounded">{provisionResult.xos_hostname}</code></p>
            </div>
            <p className="text-sm text-slate-600">External step required: attach this hostname to the joint-x-opps Vercel production project.</p>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(Boolean(v))} className="mt-0.5" />
              I confirm this hostname is attached to the correct Vercel project.
            </label>
            <Button disabled={!confirmed || activating} onClick={handleActivate}>
              {activating ? "Activating..." : "Activate XOS"}
            </Button>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={() => (step === 0 ? onOpenChange(false) : setStep((s) => s - 1))} disabled={step === 5}>
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < 4 && (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (step === 0 && (!brand.workspace_name || !brand.client_name || !brand.client_email))
                // Review must always describe the exact same payload
                // Provision executes - block advancing past the
                // preflight step unless it exists, says can_provision,
                // AND still matches the current form values (post-review
                // blocker fix - see fingerprintPreviewInput above).
                || (step === 2 && !canAdvanceFromPreflight)
              }
            >
              Next
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
