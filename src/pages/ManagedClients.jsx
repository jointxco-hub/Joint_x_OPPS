import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Globe, ExternalLink, Github, Plus, RefreshCw, Rocket, Search, Users } from "lucide-react";
import { adminListManagedClients } from "@/api/managedClients";
import { CommerceProductsSection } from "@/components/commerce/CommerceProductsSection";
import {
  WorkspaceFormDialog,
  ProductsCapabilityCard,
  XosActivationCard,
  AddManagedBrandWizard,
} from "@/components/managedClients/ManagedClientOperations";
import { SiteBuildSection } from "@/components/managedClients/SiteBuildSection";

// OPPS internal control plane for Joint X-operated brands/sites/workspaces
// - reconciles two generations of managed-brand data (the surviving
// public.managed_client_workspaces table and the modern tenant/client/XOS
// architecture) into one unified view via admin_list_managed_clients (see
// supabase/migrations/20260823140000_managed_clients_control_plane.sql for
// the full reconciliation identity rule). Phase 0/1 was read-only
// recovery/reconciliation; Phase 2 (see
// supabase/migrations/20260824090000_managed_clients_phase2_operations.sql
// and src/components/managedClients/ManagedClientOperations.jsx) makes it
// operational - editing an existing legacy workspace, initializing a
// workspace for a modern tenant with none yet (GSB today), a real Add
// Managed Brand provisioning wizard, products capability control, and the
// explicit Vercel/XOS activation gate. Phase 3 (see
// supabase/migrations/20260827090000_managed_clients_phase3_site_builds.sql
// and src/components/managedClients/SiteBuildSection.jsx) adds a "Site
// Build" section for modern tenants - structured site-build
// configuration, a site-template registry, and deterministic, versioned,
// model-agnostic build-brief generation. No deploy/Vercel/DNS action
// exists yet - the brief is the reviewed output that makes those later
// actions deterministic. Legacy modernization (migrating historical
// workspace clients to their own dedicated tenants) is still explicitly
// out of scope - see docs/MANAGED_CLIENTS_CONTROL_PLANE.md.
//
// This is a SEPARATE page from Clients.jsx (Normal Clients = CRM/customer
// records) - it does not replace it. The Commerce Products section is
// reused as-is from src/components/commerce/CommerceProductsSection.jsx,
// the same component Clients.jsx uses - one Commerce product system, never
// duplicated per screen.

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function formatDate(value) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function capitalize(value) {
  const s = String(value || "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Commerce onboarding requires a genuine modern tenant identity - XOS 3B
// derives the Commerce tenant from public.clients.tenant_id, and every
// legacy-only row's client still belongs to the Joint X tenant (they were
// never migrated to a dedicated tenant - see the migration's header
// note). Exposing "Add product" for a legacy-only row would create/link
// Commerce/client_product state under Joint X, which is architecturally
// wrong (post-review blocker fix). A row is Commerce-eligible only when
// it carries a real tenant_id, i.e. source is 'modern' or 'both'.
function isCommerceEligible(row) {
  return Boolean(row.tenant_id) && (row.source === "modern" || row.source === "both");
}

// Frontend-only derived signals - deliberately not baked into the RPC as
// permanent stored state, since both are fully deterministic from fields
// the RPC already returns (matches the "derive, don't duplicate" pattern
// used throughout XOS 3B).
function isSiteLive(row) {
  return Boolean(row.live_url);
}
function isXosLive(row) {
  return Boolean(row.tenant_id) && row.xos_status === "active";
}
function needsAttention(row) {
  return Boolean(row.next_action) || (row.source === "modern" && !row.workspace_id);
}

export default function ManagedClients() {
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState(null);
  const [addingBrand, setAddingBrand] = useState(false);

  const { data: managedClients = [], isLoading, error, refetch } = useQuery({
    queryKey: ["managedClients"],
    queryFn: async () => {
      const { data, error: rpcError } = await adminListManagedClients();
      if (rpcError) throw new Error(rpcError);
      return data;
    },
  });

  const filtered = useMemo(() => {
    const q = normalizeKey(search);
    if (!q) return managedClients;
    return managedClients.filter((row) => {
      const haystack = [row.brand_name, row.client_name, row.tenant_slug, row.tenant_name, row.domain_name, row.xos_hostname]
        .map(normalizeKey)
        .join(" ");
      return haystack.includes(q);
    });
  }, [managedClients, search]);

  const selected = managedClients.find((row) => row.key === selectedKey) || null;

  const stats = useMemo(() => ({
    total: managedClients.length,
    sitesLive: managedClients.filter(isSiteLive).length,
    xosLive: managedClients.filter(isXosLive).length,
    needsAttention: managedClients.filter(needsAttention).length,
  }), [managedClients]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Managed Clients</h1>
            <p className="text-slate-500 mt-1">Brands, sites and client workspaces operated by Joint X</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => refetch()} variant="ghost" size="icon">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button onClick={() => setAddingBrand(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Managed Brand
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardContent className="p-4">
              <p className="text-xs text-slate-500">Managed brands</p>
              <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardContent className="p-4">
              <p className="text-xs text-slate-500">Sites live</p>
              <p className="text-2xl font-bold text-slate-900">{stats.sitesLive}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardContent className="p-4">
              <p className="text-xs text-slate-500">XOS live</p>
              <p className="text-2xl font-bold text-slate-900">{stats.xosLive}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardContent className="p-4">
              <p className="text-xs text-slate-500">Needs attention</p>
              <p className="text-2xl font-bold text-amber-600">{stats.needsAttention}</p>
            </CardContent>
          </Card>
        </div>

        <div className="bg-white rounded-xl p-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search managed brands..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <RefreshCw className="w-10 h-10 text-primary mx-auto mb-4 animate-spin" />
            <h3 className="text-lg font-medium text-slate-700">Loading managed clients...</h3>
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <h3 className="text-lg font-medium text-red-600 mb-2">Could not load managed clients</h3>
            <p className="text-slate-500">{error.message}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <Rocket className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700 mb-2">No managed brands found</h3>
            <p className="text-slate-500">Adjust your search, or add a new managed brand.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((row) => (
              <Card
                key={row.key}
                className="border-0 shadow-sm rounded-2xl hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => setSelectedKey(row.key)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-semibold text-slate-900 truncate">{row.brand_name}</h3>
                    {needsAttention(row) && <Badge className="bg-amber-100 text-amber-700 shrink-0">Needs attention</Badge>}
                  </div>
                  <p className="text-xs text-slate-500 mb-3">{row.client_type || "Managed client"}{row.site_type ? ` · ${row.site_type}` : ""}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className={row.tenant_id ? "text-emerald-700 border-emerald-300 bg-emerald-50" : "text-slate-500 border-slate-300"}>
                      {row.tenant_id ? `Tenant: ${row.tenant_slug}` : "No modern tenant yet"}
                    </Badge>
                    <Badge variant="outline" className={isXosLive(row) ? "text-emerald-700 border-emerald-300 bg-emerald-50" : "text-slate-500 border-slate-300"}>
                      {isXosLive(row) ? "XOS live" : "XOS not configured"}
                    </Badge>
                    <Badge variant="outline" className={row.workspace_id ? "text-slate-700 border-slate-300" : "text-slate-400 border-slate-200"}>
                      {row.workspace_id ? (row.site_status || "Workspace tracked") : "No legacy workspace"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selected && <ManagedClientDetailDialog row={selected} open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedKey(null)} />}
      {addingBrand && <AddManagedBrandWizard open={addingBrand} onOpenChange={setAddingBrand} />}
    </div>
  );
}

function StatusField({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm text-slate-800">{value || <span className="text-slate-400">Not configured</span>}</p>
    </div>
  );
}

function LinkField({ label, url, icon: Icon = ExternalLink }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
          <Icon className="w-3.5 h-3.5" /> {url}
        </a>
      ) : (
        <p className="text-sm text-slate-400">Not configured</p>
      )}
    </div>
  );
}

function ManagedClientDetailDialog({ row, open, onOpenChange }) {
  const xosUrl = row.xos_hostname ? `https://${row.xos_hostname}` : null;
  const [editingWorkspace, setEditingWorkspace] = useState(false);
  const isLegacyOnly = row.source === "legacy";
  const isModern = row.source === "modern" || row.source === "both";
  const hasWorkspace = Boolean(row.workspace_id);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle>{row.brand_name}</DialogTitle>
              <p className="text-sm text-slate-500">
                {row.source === "legacy"
                  ? "Legacy workspace record - not yet migrated to a dedicated XOS tenant."
                  : row.source === "both"
                    ? "Modern managed tenant with a linked legacy workspace record."
                    : "Modern managed tenant - no legacy workspace record yet (expected for a newly provisioned brand)."}
              </p>
            </div>
            {(isLegacyOnly || hasWorkspace) && (
              <Button size="sm" variant="outline" onClick={() => setEditingWorkspace(true)}>Edit Workspace</Button>
            )}
            {isModern && !hasWorkspace && (
              <Button size="sm" onClick={() => setEditingWorkspace(true)}>Set up workspace</Button>
            )}
          </div>
        </DialogHeader>

        {isLegacyOnly && (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-600">
              Legacy tenant reconciliation is a separate migration phase. This workspace's own site/readiness/work fields can be edited here, but it stays legacy-only - no Commerce onboarding, no XOS activation controls.
            </p>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold mb-3">Overview</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatusField label="Brand / client name" value={row.brand_name} />
            <StatusField label="Client type" value={row.client_type} />
            <StatusField label="Site type" value={row.site_type} />
            <StatusField label="Tenant" value={row.tenant_slug} />
            {/* Tenant status (the modern tenant's own active/inactive
                state) and Site status (the legacy workspace's site
                readiness) are two different concepts - conflating them
                under one "Status" field would misrepresent a modern
                tenant like GSB, whose tenant IS active even though it has
                no site/workspace status yet (post-review fix). */}
            <StatusField label="Tenant status" value={row.tenant_status ? capitalize(row.tenant_status) : null} />
            <StatusField label="Site status" value={row.site_status} />
            <StatusField label="Onboarding stage" value={row.onboarding_stage} />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold mb-3">Site / Website</h3>
          <div className="grid grid-cols-2 gap-4">
            <StatusField label="Site status" value={row.site_status} />
            <StatusField label="Storefront status" value={row.storefront_status} />
            <LinkField label="Preview URL" url={row.preview_url} icon={Globe} />
            <LinkField label="Live URL" url={row.live_url} icon={Globe} />
            <StatusField label="Domain name" value={row.domain_name} />
            <LinkField label="Repository URL" url={row.site_repo_url} icon={Github} />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold mb-3">Readiness</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatusField label="Assets" value={row.assets_status} />
            <StatusField label="Content" value={row.content_status} />
            <StatusField label="Products / services" value={row.products_services_status} />
            <StatusField label="Pricing" value={row.pricing_status} />
            <StatusField label="Mockups" value={row.mockup_status} />
            <StatusField label="Domain" value={row.domain_status} />
            <StatusField label="Launch readiness" value={row.launch_readiness_status} />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold mb-3">Work</h3>
          <div className="grid grid-cols-2 gap-4">
            <StatusField label="Next action" value={row.next_action} />
            <StatusField label="Owner" value={row.next_action_owner} />
            <StatusField label="Due date" value={formatDate(row.next_action_due_at)} />
            <StatusField label="Launch target" value={formatDate(row.launch_target_date)} />
          </div>
          {row.internal_notes && (
            <div className="mt-3">
              <p className="text-xs text-slate-500 mb-1">Internal notes</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap rounded-md bg-slate-50 p-3">{row.internal_notes}</p>
            </div>
          )}
        </section>

        {isModern && <SiteBuildSection row={row} />}

        <section className="rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">XOS</h3>
            {xosUrl && (
              <a href={xosUrl} target="_blank" rel="noreferrer">
                <Button size="sm" variant="outline"><ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Open XOS</Button>
              </a>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StatusField label="Tenant name / slug" value={row.tenant_name ? `${row.tenant_name} (${row.tenant_slug})` : null} />
            <StatusField label="XOS hostname" value={row.xos_hostname} />
            <StatusField label="XOS status" value={row.xos_status} />
            <StatusField label="Products capability" value={row.products_capability_enabled ? "Enabled" : "Not enabled"} />
          </div>
        </section>

        {isModern && <XosActivationCard row={row} />}
        {isModern && <ProductsCapabilityCard row={row} />}

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold mb-3">Access</h3>
          {(row.access || []).length === 0 ? (
            <p className="text-sm text-slate-500">No tenant membership records yet.</p>
          ) : (
            <div className="space-y-2">
              {row.access.map((member, idx) => (
                <div key={idx} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 p-3 text-sm">
                  <span className="flex items-center gap-2"><Users className="w-3.5 h-3.5 text-slate-400" /> {member.email || "Unknown"}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">{member.role}</Badge>
                    <Badge variant="outline" className="capitalize">{member.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {isCommerceEligible(row) ? (
          row.client_id && <CommerceProductsSection clientId={row.client_id} />
        ) : (
          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold mb-2">Commerce Products</h3>
            <p className="text-sm text-slate-500">
              Commerce onboarding becomes available after this legacy workspace is reconciled to a dedicated managed tenant.
            </p>
          </section>
        )}
      </DialogContent>
    </Dialog>

    {editingWorkspace && (
      <WorkspaceFormDialog
        open={editingWorkspace}
        onOpenChange={setEditingWorkspace}
        mode={hasWorkspace ? "edit" : "init"}
        row={row}
      />
    )}
    </>
  );
}
