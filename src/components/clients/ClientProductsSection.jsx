import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Package, Plus, X, ExternalLink, Image as ImageIcon, Eye } from "lucide-react";
import SecureImage from "@/components/common/SecureImage";
import QuickImagePreview from "@/components/common/QuickImagePreview";
import ClientAssetPickerModal from "@/components/files/ClientAssetPickerModal";
import { PLACEMENT_PRESETS } from "@/lib/productionStages";
import { findOrCreateClientProductArtworkFromAsset } from "@/api/artworkLinking";
import {
  getClientProductArtworkReadiness,
  setClientProductRequiredArtworkPlacements,
  deriveReadinessState,
  READINESS_STATES,
  buildClientProductCreatePayload,
  CLIENT_PRODUCT_STATUSES,
  canReviewTenant,
  duplicateProductComposition,
  summarizeProduction,
  deriveProductionGaps,
  buildAllowedCombinationMatrix,
  PRODUCTION_READONLY_MESSAGE,
  PRICING_PREVIEW_BOUNDARY,
} from "@/api/clientProducts";
import { toStaffMessage } from "@/lib/pgErrorMessages";
import ScopedComponentsEditor from "@/components/composition/ScopedComponentsEditor";
import GarmentVariantsSection from "@/components/composition/GarmentVariantsSection";
import TreatmentsSection from "@/components/composition/TreatmentsSection";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";

const XLAB_ADMIN_BASE = "https://xlab.jointx.co.za/admin/client-products";

const TONE_CLASS = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  slate: "bg-slate-100 text-slate-600 border-slate-200",
};

function StatusBadge({ status }) {
  return <Badge variant="outline" className="capitalize">{String(status || "draft").replace(/_/g, " ")}</Badge>;
}

function ReadinessBadge({ state }) {
  const meta = READINESS_STATES[state] || READINESS_STATES.unknown;
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[meta.tone]}`}>{meta.label}</span>;
}

// ─────────────────────────────────────────────────────────────────────
// Phase 1F-A - the OPPS operational home for Client Products, mounted in
// Clients.jsx's ClientAccountDialog beside CommerceProductsSection. One
// shared record: this reads/writes the SAME client_products /
// client_product_artwork rows X LAB uses, via the existing RLS + RPCs.
// No new tables, no second artwork/readiness calculation, no new statuses.
// Production configuration (composition / variants / treatments / mapping)
// is Phase 1F-B and is intentionally NOT here.
// ─────────────────────────────────────────────────────────────────────
export function ClientProductsSection({ clientId }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [openProductId, setOpenProductId] = useState("");

  const productsQueryKey = ["clientProductsForClient", clientId];
  const { data: clientProducts = [], isLoading } = useQuery({
    queryKey: productsQueryKey,
    queryFn: () => dataClient.entities.ClientProduct.filter({ client_id: clientId }, "client_facing_name", 200),
    enabled: Boolean(clientId),
  });

  // Client-scope guard: never render or open a row that is not this
  // client's, even if a filter regression ever returned one.
  const scopedProducts = useMemo(
    () => (Array.isArray(clientProducts) ? clientProducts : []).filter((p) => p.client_id === clientId),
    [clientProducts, clientId],
  );
  const openProduct = scopedProducts.find((p) => p.id === openProductId) || null;

  const invalidateProducts = () => queryClient.invalidateQueries({ queryKey: productsQueryKey });

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Client Products</h3>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New Client Product
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : scopedProducts.length === 0 ? (
        <p className="text-sm text-slate-500">No client products yet.</p>
      ) : (
        <div className="space-y-2">
          {scopedProducts.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => setOpenProductId(product.id)}
              className="flex w-full items-center gap-3 rounded-md bg-slate-50 p-2.5 text-left hover:bg-slate-100"
            >
              <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-white">
                <SecureImage value={product.primary_mockup_url} alt="" className="h-full w-full object-cover" fallback={<div className="flex h-full w-full items-center justify-center text-slate-300"><ImageIcon className="h-4 w-4" /></div>} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{product.client_facing_name}</p>
                {product.internal_name && <p className="truncate text-xs text-slate-500">{product.internal_name}</p>}
              </div>
              <StatusBadge status={product.status} />
            </button>
          ))}
        </div>
      )}

      {creating && (
        <CreateClientProductDialog
          clientId={clientId}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            invalidateProducts();
            setOpenProductId(created.id);
          }}
        />
      )}

      {openProduct && (
        <ClientProductWorkspace
          product={openProduct}
          clientId={clientId}
          onClose={() => setOpenProductId("")}
          onChanged={invalidateProducts}
        />
      )}
    </section>
  );
}

function CreateClientProductDialog({ clientId, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [internalName, setInternalName] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = buildClientProductCreatePayload({ clientId, clientFacingName: name, internalName });
      return dataClient.entities.ClientProduct.create(payload);
    },
    onSuccess: (created) => {
      toast.success("Client product created");
      onCreated(created);
    },
    onError: (error) => toast.error(error?.message || "Could not create client product"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">New Client Product</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Client-facing name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SFR Signature Tee" />
          </div>
          <div className="space-y-1.5">
            <Label>Internal name</Label>
            <Input value={internalName} onChange={(e) => setInternalName(e.target.value)} placeholder="Optional staff-only label" />
          </div>
          <p className="text-xs text-slate-500">
            Only a name is required — matches the X LAB model. The new product is not visible to the customer until you publish it. You&apos;ll land in its workspace to finish files, artwork and readiness.
          </p>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" disabled={createMutation.isPending || !name.trim()} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Creating…" : "Create & open"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Workspace ──────────────────────────────────────────────────────────
function ClientProductWorkspace({ product, clientId, onClose, onChanged }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState(null);

  const readinessQueryKey = ["clientProductReadiness", product.id];
  const { data: readinessRes } = useQuery({
    queryKey: readinessQueryKey,
    queryFn: () => getClientProductArtworkReadiness({ clientProductId: product.id }),
    enabled: Boolean(product.id),
  });
  const readiness = readinessRes?.data || null;
  const readinessState = deriveReadinessState(readiness);

  const artworkQueryKey = ["clientProductArtworkAll", product.id];
  const { data: artworkRows = [] } = useQuery({
    queryKey: artworkQueryKey,
    queryFn: () => dataClient.entities.ClientProductArtwork.filter({ client_product_id: product.id }, "placement", 300),
    enabled: Boolean(product.id),
  });

  // Phase 1F-B - proactive read-only UX for the Production tab. This is
  // the EXACT RLS write-gate (inventory_can_review_tenant) for the
  // production-configuration tables, so the tab renders full editors only
  // when a write would actually be permitted; otherwise a read-only view
  // + banner. No grant change - a probe of an already-granted function.
  const { data: canConfigureRes } = useQuery({
    queryKey: ["canReviewTenant", product.tenant_id],
    queryFn: () => canReviewTenant({ tenantId: product.tenant_id }),
    enabled: Boolean(product.tenant_id),
    staleTime: 60_000,
  });
  const canConfigureProduction = canConfigureRes?.data === true;

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: readinessQueryKey });
    queryClient.invalidateQueries({ queryKey: artworkQueryKey });
    onChanged?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-slate-200 p-4">
          <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
            <SecureImage value={product.primary_mockup_url} alt="" className="h-full w-full object-cover" fallback={<div className="flex h-full w-full items-center justify-center text-slate-300"><ImageIcon className="h-5 w-5" /></div>} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{product.client_facing_name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={product.status} />
              <ReadinessBadge state={readinessState} />
              {product.visible_in_account && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Customer-visible</span>}
            </div>
            <a
              href={`${XLAB_ADMIN_BASE}/${product.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600"
            >
              <ExternalLink className="h-3 w-3" /> Advanced · open in X LAB Admin
            </a>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
        </div>

        <Tabs defaultValue="details" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-4 mt-3 grid w-auto grid-cols-4">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="artwork">Artwork</TabsTrigger>
            <TabsTrigger value="production">Production</TabsTrigger>
            <TabsTrigger value="status">Status</TabsTrigger>
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <TabsContent value="details" className="mt-0">
              <DetailsTab product={product} clientId={clientId} onSaved={onChanged} onPreview={setPreview} />
            </TabsContent>
            <TabsContent value="artwork" className="mt-0">
              <ArtworkTab
                product={product}
                clientId={clientId}
                readiness={readiness}
                artworkRows={Array.isArray(artworkRows) ? artworkRows : []}
                onChanged={refetchAll}
                onPreview={setPreview}
              />
            </TabsContent>
            <TabsContent value="production" className="mt-0">
              <ProductionTab
                product={product}
                readinessState={readinessState}
                canConfigure={canConfigureProduction}
              />
            </TabsContent>
            <TabsContent value="status" className="mt-0">
              <StatusTab product={product} onSaved={onChanged} readinessState={readinessState} />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <QuickImagePreview open={Boolean(preview)} onClose={() => setPreview(null)} value={preview?.value} title={preview?.title} />
    </div>
  );
}

// ── Details tab ───────────────────────────────────────────────────────
const DETAIL_TEXT_FIELDS = [
  ["client_facing_name", "Client-facing name"],
  ["internal_name", "Internal name (staff only)"],
  ["garment_material", "Garment material"],
  ["garment_gsm", "Garment GSM"],
  ["garment_color", "Garment colour"],
  ["print_method", "Print method"],
  ["placement", "Placement (legacy)"],
  ["print_size", "Print size"],
];

function DetailsTab({ product, clientId, onSaved, onPreview }) {
  const queryClient = useQueryClient();
  const [showThumbPicker, setShowThumbPicker] = useState(false);
  const [form, setForm] = useState(() => {
    const base = {};
    for (const [key] of DETAIL_TEXT_FIELDS) base[key] = product[key] ?? "";
    base.currency = product.currency ?? "ZAR";
    base.print_locations = product.print_locations != null ? String(product.print_locations) : "";
    base.production_instructions = product.production_instructions ?? "";
    base.packaging_instructions = product.packaging_instructions ?? "";
    base.special_instructions = product.special_instructions ?? "";
    base.internal_notes = product.internal_notes ?? "";
    return base;
  });
  const set = (patch) => setForm((c) => ({ ...c, ...patch }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Non-sensitive operational fields only. client_price /
      // visible_in_account / reorder_enabled are NOT here - they live in
      // the Status tab behind an explicit confirm.
      const payload = {
        client_facing_name: form.client_facing_name.trim() || product.client_facing_name,
        internal_name: form.internal_name.trim(),
        currency: form.currency.trim() || "ZAR",
        garment_material: form.garment_material.trim(),
        garment_gsm: form.garment_gsm.trim(),
        garment_color: form.garment_color.trim(),
        print_method: form.print_method.trim(),
        placement: form.placement.trim(),
        print_size: form.print_size.trim(),
        print_locations: form.print_locations,
        production_instructions: form.production_instructions.trim(),
        packaging_instructions: form.packaging_instructions.trim(),
        special_instructions: form.special_instructions.trim(),
        internal_notes: form.internal_notes.trim(),
      };
      return dataClient.entities.ClientProduct.update(product.id, payload);
    },
    onSuccess: () => {
      toast.success("Details saved");
      queryClient.invalidateQueries({ queryKey: ["clientProductsForClient", clientId] });
      onSaved?.();
    },
    onError: (error) => toast.error(error?.message || "Could not save details"),
  });

  const thumbnailMutation = useMutation({
    // Audited shared contract: set BOTH primary_mockup_asset_id AND
    // primary_mockup_url = asset.file_url (verbatim). X LAB and OPPS both
    // read this pair; the raw ref is resolved to a signed URL at display.
    mutationFn: async (asset) => dataClient.entities.ClientProduct.update(product.id, {
      primary_mockup_asset_id: asset.id,
      primary_mockup_url: asset.file_url,
    }),
    onSuccess: () => {
      toast.success("Thumbnail updated");
      setShowThumbPicker(false);
      queryClient.invalidateQueries({ queryKey: ["clientProductsForClient", clientId] });
      onSaved?.();
    },
    onError: (error) => toast.error(error?.message || "Could not set thumbnail"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
          <SecureImage value={product.primary_mockup_url} alt="" className="h-full w-full object-cover" fallback={<div className="flex h-full w-full items-center justify-center text-slate-300"><ImageIcon className="h-5 w-5" /></div>} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Thumbnail / mockup</p>
          <p className="text-xs text-slate-500">Pick an existing client file or upload a new one.</p>
        </div>
        {product.primary_mockup_url && (
          <Button variant="ghost" size="sm" onClick={() => onPreview({ value: product.primary_mockup_url, title: product.client_facing_name })}>
            <Eye className="mr-1 h-3.5 w-3.5" /> View
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowThumbPicker(true)}>
          {product.primary_mockup_asset_id ? "Change" : "Set"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {DETAIL_TEXT_FIELDS.map(([key, label]) => (
          <div key={key} className="space-y-1">
            <Label className="text-[11px] text-slate-500">{label}</Label>
            <Input value={form[key]} onChange={(e) => set({ [key]: e.target.value })} />
          </div>
        ))}
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-500">Currency</Label>
          <Input value={form.currency} onChange={(e) => set({ currency: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-500">Print locations</Label>
          <Input type="number" min="0" value={form.print_locations} onChange={(e) => set({ print_locations: e.target.value })} />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-slate-500">Production instructions</Label>
        <Textarea rows={2} value={form.production_instructions} onChange={(e) => set({ production_instructions: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-slate-500">Packaging instructions</Label>
        <Textarea rows={2} value={form.packaging_instructions} onChange={(e) => set({ packaging_instructions: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-slate-500">Special instructions</Label>
        <Textarea rows={2} value={form.special_instructions} onChange={(e) => set({ special_instructions: e.target.value })} />
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Internal only — never shown to the customer</p>
        <Textarea rows={3} value={form.internal_notes} onChange={(e) => set({ internal_notes: e.target.value })} placeholder="Staff notes, supplier context, margin reminders…" />
      </div>

      <Button className="w-full" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
        {saveMutation.isPending ? "Saving…" : "Save details"}
      </Button>

      {showThumbPicker && (
        <ClientAssetPickerModal
          clientId={clientId}
          selectionMode="single"
          defaultCategory="Mockups"
          uploadCategory="Mockups"
          title="Set thumbnail / mockup"
          description="Pick an existing client file (from orders, requests or the library) or upload a new one. Nothing is re-uploaded when the file already exists."
          confirmVerb="Use"
          onClose={() => setShowThumbPicker(false)}
          onConfirm={([asset]) => asset && thumbnailMutation.mutate(asset)}
        />
      )}
    </div>
  );
}

// ── Artwork tab ───────────────────────────────────────────────────────
function ArtworkTab({ product, clientId, readiness, artworkRows, onChanged, onPreview }) {
  const [pickerPlacement, setPickerPlacement] = useState("");
  const [editingRequirements, setEditingRequirements] = useState(false);

  const requiredFromRpc = Array.isArray(readiness?.required_placements) ? readiness.required_placements : [];
  const legacyFallback = readiness?.legacy_fallback === true;

  // Placements to show a row for: the authoritative required set, plus any
  // placement that already has artwork, plus the presets (so staff can add
  // one). Order: required first, then the rest.
  const artworkPlacements = Array.from(new Set(artworkRows.map((a) => a.placement).filter(Boolean)));
  const allPlacements = Array.from(new Set([...requiredFromRpc, ...artworkPlacements, ...PLACEMENT_PRESETS]));

  const currentByPlacement = new Map();
  const historyCountByPlacement = new Map();
  for (const row of artworkRows) {
    if (row.treatment_id) continue; // family scope only
    historyCountByPlacement.set(row.placement, (historyCountByPlacement.get(row.placement) || 0) + 1);
    if (row.is_current && !currentByPlacement.has(row.placement)) currentByPlacement.set(row.placement, row);
  }

  const linkMutation = useMutation({
    mutationFn: async ({ placement, asset }) => {
      const { data, error } = await findOrCreateClientProductArtworkFromAsset({
        tenantId: product.tenant_id,
        clientProductId: product.id,
        clientAssetId: asset.id,
        placement,
      });
      if (error) throw new Error(error);
      return data;
    },
    onSuccess: () => {
      toast.success("Artwork linked");
      setPickerPlacement("");
      onChanged?.();
    },
    onError: (error) => toast.error(error?.message || "Could not link artwork"),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Required placements</p>
          <Button variant="outline" size="sm" onClick={() => setEditingRequirements((v) => !v)}>
            {editingRequirements ? "Done" : "Edit"}
          </Button>
        </div>
        {legacyFallback ? (
          <p className="mt-1 text-xs text-amber-700">
            Requirements unconfirmed — inferred from existing artwork. Confirm the list to lock readiness.
          </p>
        ) : requiredFromRpc.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">Explicitly no artwork required for this product.</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">{requiredFromRpc.join(", ")}</p>
        )}
        {editingRequirements && (
          <RequiredPlacementsEditor
            product={product}
            initial={requiredFromRpc}
            onSaved={() => { setEditingRequirements(false); onChanged?.(); }}
          />
        )}
      </div>

      <div className="space-y-2">
        {allPlacements.map((placement) => {
          const current = currentByPlacement.get(placement);
          const historyCount = historyCountByPlacement.get(placement) || 0;
          const isRequired = requiredFromRpc.includes(placement);
          return (
            <div key={placement} className="rounded-lg border border-slate-200 p-2.5">
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-slate-100">
                  {current ? (
                    <SecureImage value={current.file_path} alt="" className="h-full w-full object-cover" fallback={<div className="flex h-full w-full items-center justify-center text-slate-300"><ImageIcon className="h-4 w-4" /></div>} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-300"><ImageIcon className="h-4 w-4" /></div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {placement}
                    {isRequired && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">required</span>}
                  </p>
                  {current ? (
                    <p className="truncate text-xs text-slate-500">
                      {current.file_name || "linked file"}
                      <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${current.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {current.status}
                      </span>
                      {historyCount > 1 && <span className="ml-1.5 text-[10px] text-slate-400">Rev {current.revision} · {historyCount} revisions</span>}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400">No artwork linked</p>
                  )}
                </div>
                {current && (
                  <Button variant="ghost" size="sm" onClick={() => onPreview({ value: current.file_path, title: `${placement} artwork` })}>
                    <Eye className="mr-1 h-3.5 w-3.5" /> View
                  </Button>
                )}
                <Button variant="outline" size="sm" disabled={linkMutation.isPending} onClick={() => setPickerPlacement(placement)}>
                  {current ? "Change" : "Link"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {readiness?.blocking_reasons?.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800">
          <p className="mb-1 font-semibold">Blocking readiness:</p>
          <ul className="list-inside list-disc space-y-0.5">
            {readiness.blocking_reasons.map((reason, i) => <li key={i}>{reason}</li>)}
          </ul>
        </div>
      )}

      {pickerPlacement && (
        <ClientAssetPickerModal
          clientId={clientId}
          selectionMode="single"
          defaultCategory="Artwork"
          uploadCategory="Artwork"
          showApprovalBadge
          title={`Link artwork — ${pickerPlacement}`}
          description="Pick an existing client file (orders, requests, library) or upload a new one. It becomes the current artwork revision for this placement; older revisions are kept."
          confirmVerb="Use"
          onClose={() => setPickerPlacement("")}
          onConfirm={([asset]) => asset && linkMutation.mutate({ placement: pickerPlacement, asset })}
        />
      )}
    </div>
  );
}

function RequiredPlacementsEditor({ product, initial, onSaved }) {
  const [selected, setSelected] = useState(() => new Set(initial));
  const options = Array.from(new Set([...PLACEMENT_PRESETS, ...initial]));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await setClientProductRequiredArtworkPlacements({
        clientProductId: product.id,
        placements: Array.from(selected),
      });
      if (error) throw new Error(error);
      return data;
    },
    onSuccess: () => {
      toast.success("Required placements updated");
      onSaved?.();
    },
    onError: (error) => toast.error(error?.message || "Could not update required placements"),
  });

  const toggle = (placement) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(placement)) next.delete(placement); else next.add(placement);
    return next;
  });

  return (
    <div className="mt-2 space-y-2 rounded-md bg-slate-50 p-2">
      <div className="grid grid-cols-2 gap-1">
        {options.map((placement) => (
          <label key={placement} className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={selected.has(placement)} onChange={() => toggle(placement)} />
            {placement}
          </label>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        Saving an empty list means &quot;explicitly no artwork required&quot;. This is the only readiness input — nothing is recalculated here.
      </p>
      <Button size="sm" className="w-full" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
        {saveMutation.isPending ? "Saving…" : `Save (${selected.size} placement${selected.size === 1 ? "" : "s"})`}
      </Button>
    </div>
  );
}

// ── Status tab ────────────────────────────────────────────────────────
function StatusTab({ product, onSaved, readinessState }) {
  const queryClient = useQueryClient();
  const [pendingChange, setPendingChange] = useState(null); // { kind, label, apply }
  const readyForCustomer = ["ready_for_client_review", "client_changes_requested", "client_approved", "ready_to_order", "active"].includes(product.status || "");

  const applyMutation = useMutation({
    mutationFn: async (payload) => dataClient.entities.ClientProduct.update(product.id, payload),
    onSuccess: () => {
      toast.success("Updated");
      setPendingChange(null);
      queryClient.invalidateQueries({ queryKey: ["clientProductsForClient", product.client_id] });
      queryClient.invalidateQueries({ queryKey: ["clientProductReadiness", product.id] });
      onSaved?.();
    },
    onError: (error) => {
      // Surfaces the DB ready-to-order artwork guard verbatim.
      toast.error(error?.message || "Could not update");
      setPendingChange(null);
    },
  });

  const requestChange = (kind, label, payload) => setPendingChange({ kind, label, payload });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] text-slate-500">Lifecycle status</Label>
          {readinessState && (
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
              Artwork: <ReadinessBadge state={readinessState} />
            </span>
          )}
        </div>
        <Select
          value={product.status || "draft"}
          onValueChange={(next) => {
            if (next === product.status) return;
            requestChange("status", `Change status to "${next.replace(/_/g, " ")}"`, { status: next });
          }}
        >
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CLIENT_PRODUCT_STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-[11px] text-slate-500">
          draft → ready for client review → client approved / changes requested → ready to order → active (plus archived).
          Marking &quot;ready to order&quot; is blocked by the database until required artwork placements are confirmed.
        </p>
        {readyForCustomer && readinessState !== "ready" && readinessState !== "no_artwork_required" && (
          <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
            This product is in a customer-facing status but its artwork is not ready — check the Artwork tab.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Storefront-sensitive — changes what customers can do</p>

        <label className="flex items-center justify-between py-1.5 text-sm">
          <span>Visible in client account</span>
          <input
            type="checkbox"
            checked={Boolean(product.visible_in_account)}
            onChange={(e) => requestChange(
              "visible_in_account",
              `${e.target.checked ? "Show" : "Hide"} this product in the customer's account`,
              { visible_in_account: e.target.checked },
            )}
          />
        </label>

        <label className="flex items-center justify-between py-1.5 text-sm">
          <span>Reorder enabled</span>
          <input
            type="checkbox"
            checked={Boolean(product.reorder_enabled)}
            onChange={(e) => requestChange(
              "reorder_enabled",
              `${e.target.checked ? "Allow" : "Block"} customer reordering of this product`,
              { reorder_enabled: e.target.checked },
            )}
          />
        </label>

        <div className="py-1.5">
          <Label className="text-[11px] text-slate-500">Customer / service price</Label>
          <PriceField
            initial={product.client_price}
            onCommit={(value) => requestChange("client_price", `Set customer price to ${value === null ? "— (cleared)" : `R${value}`}`, { client_price: value ?? "" })}
          />
        </div>
      </div>

      {pendingChange && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4" onClick={() => setPendingChange(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold">Confirm change</p>
            <p className="mt-1 text-sm text-slate-600">{pendingChange.label}</p>
            <p className="mt-2 text-xs text-slate-500">This affects what the customer sees or can order. It is applied immediately.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPendingChange(null)}>Cancel</Button>
              <Button className="flex-1" disabled={applyMutation.isPending} onClick={() => applyMutation.mutate(pendingChange.payload)}>
                {applyMutation.isPending ? "Applying…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PriceField({ initial, onCommit }) {
  const [value, setValue] = useState(initial != null ? String(initial) : "");
  return (
    <div className="mt-1 flex gap-2">
      <Input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const trimmed = value.trim();
          onCommit(trimmed === "" ? null : Number(trimmed));
        }}
      >
        Update price
      </Button>
    </div>
  );
}

// ── Production tab (Phase 1F-B) ───────────────────────────────────────
// Brings the EXISTING OPPS production engine into the 1F-A workspace -
// never a second engine. Every editor here is a Phase 2B component
// mounted against this Client Product's id; this tab only fetches the
// shared queries once, lays them out compactly, and gates editing on the
// same inventory_can_review_tenant() rule the tables' RLS already
// enforces.
function Section({ title, subtitle, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />}
        <span className="flex-1 text-sm font-semibold text-slate-800">{title}</span>
        {count != null && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">{count}</span>}
      </button>
      {open && (
        <div className="border-t border-slate-100 p-3">
          {subtitle && <p className="mb-2 text-xs text-slate-500">{subtitle}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

function ProductionTab({ product, readinessState, canConfigure }) {
  const queryClient = useQueryClient();

  const { data: components = [] } = useQuery({
    queryKey: ["productComponents", product.id],
    queryFn: () => dataClient.entities.ProductComponent.filter({ client_product_id: product.id }, "sort_order", 200),
    enabled: Boolean(product.id),
  });
  const { data: variants = [] } = useQuery({
    queryKey: ["garmentVariants", product.id],
    queryFn: () => dataClient.entities.GarmentVariant.filter({ client_product_id: product.id }, "sort_order", 200),
    enabled: Boolean(product.id),
  });
  const { data: treatments = [] } = useQuery({
    queryKey: ["treatmentsForFamily", product.id],
    queryFn: () => dataClient.entities.Treatment.filter({ client_product_id: product.id }, "sort_order", 200),
    enabled: Boolean(product.id),
  });
  const { data: mappings = [] } = useQuery({
    queryKey: ["variantTreatmentMappingsForFamily", product.id],
    queryFn: () => dataClient.entities.VariantTreatmentMapping.filter({ client_product_id: product.id }, "created_at", 500),
    enabled: Boolean(product.id),
  });
  const { data: internalProducts = [] } = useQuery({
    queryKey: ["inventoryProductsForProduction"],
    queryFn: () => dataClient.entities.InventoryProduct.list("internal_name", 300),
    enabled: canConfigure,
    staleTime: 60_000,
  });
  const { data: pricingDefaults = [] } = useQuery({
    queryKey: ["productionPricingDefaults"],
    queryFn: () => dataClient.entities.ProductionPricingDefault.filter({ is_active: true }, "production_method", 100),
    enabled: canConfigure,
    staleTime: 60_000,
  });
  const { data: currentArtwork = [] } = useQuery({
    queryKey: ["clientProductArtworkCurrent", product.id],
    queryFn: () => dataClient.entities.ClientProductArtwork.filter({ client_product_id: product.id, is_current: true }, "placement", 100),
    enabled: canConfigure && Boolean(product.id),
  });
  const pricingDefaultFor = (method) => (Array.isArray(pricingDefaults) ? pricingDefaults : []).find((d) => d.production_method === method);

  const safe = {
    components: Array.isArray(components) ? components : [],
    variants: Array.isArray(variants) ? variants : [],
    treatments: Array.isArray(treatments) ? treatments : [],
    mappings: Array.isArray(mappings) ? mappings : [],
  };
  const summary = summarizeProduction(safe);
  const gaps = deriveProductionGaps(safe);

  return (
    <div className="space-y-3">
      {/* Overview */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <span>Composition: <b className="text-slate-800">{summary.familyComponentCount}</b> family{summary.totalComponentCount !== summary.familyComponentCount ? ` (+${summary.totalComponentCount - summary.familyComponentCount} scoped)` : ""}</span>
          <span>Variants: <b className="text-slate-800">{summary.variantCount}</b></span>
          <span>Treatments: <b className="text-slate-800">{summary.treatmentCount}</b></span>
          <span>Mappings: <b className="text-slate-800">{summary.mappingCount}</b></span>
          <ReadinessBadge state={readinessState} />
        </div>
        {gaps.length > 0 && (
          <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-amber-700">
            {gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        )}
      </div>

      {!canConfigure ? (
        <>
          <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
            <span>{PRODUCTION_READONLY_MESSAGE}</span>
          </div>
          <ProductionReadOnlyView {...safe} />
        </>
      ) : (
        <>
          <Section title="Composition" subtitle="Family-level production components." count={summary.familyComponentCount} defaultOpen>
            <ScopedComponentsEditor
              clientProductId={product.id}
              scope={{ type: "family" }}
              allComponents={safe.components}
              queryKeyForInvalidation={["productComponents", product.id]}
              internalProducts={internalProducts}
              pricingDefaultFor={pricingDefaultFor}
              clientProduct={product}
              currentArtwork={currentArtwork}
              onArtworkLinked={() => queryClient.invalidateQueries({ queryKey: ["clientProductArtworkCurrent", product.id] })}
              addLabel="Add print option"
            />
            <div className="mt-3 border-t border-slate-100 pt-3">
              <DuplicateCompositionInline product={product} hasComposition={summary.familyComponentCount > 0} />
            </div>
          </Section>

          <Section title="Garment variants" subtitle="Reusable blank configurations - normalized inventory link where available, manual size fallback otherwise." count={summary.variantCount}>
            <GarmentVariantsSection
              clientProductId={product.id}
              clientProduct={product}
              internalProducts={internalProducts}
              pricingDefaultFor={pricingDefaultFor}
              allComponents={safe.components}
            />
          </Section>

          <Section title="Treatments" subtitle="Reusable print/production treatments, independent of the garment blank." count={summary.treatmentCount}>
            <TreatmentsSection
              clientProductId={product.id}
              clientProduct={product}
              internalProducts={internalProducts}
              pricingDefaultFor={pricingDefaultFor}
              allComponents={safe.components}
            />
          </Section>

          <Section title="Allowed combinations" subtitle="Which treatments are available on which garment variant. Edit the ticks inside each garment variant above; this is the family-level view." count={summary.mappingCount}>
            <AllowedCombinationsMatrix {...safe} />
          </Section>

          <Section title="Pricing preview" defaultOpen>
            <p className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">{PRICING_PREVIEW_BOUNDARY}</p>
            <p className="mt-2 text-xs text-slate-500">Per-variant previews (family price / variant override + treatment surcharge) appear inside each garment variant when expanded.</p>
          </Section>
        </>
      )}
    </div>
  );
}

function ProductionReadOnlyView({ components, variants, treatments, mappings }) {
  const family = components.filter((c) => !c.garment_variant_id && !c.treatment_id && c.is_active !== false);
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="mb-1.5 text-sm font-semibold text-slate-800">Composition</p>
        {family.length === 0 ? <p className="text-xs text-slate-400">No family components.</p> : (
          <ul className="space-y-1 text-xs text-slate-600">
            {family.map((c) => <li key={c.id}>{c.component_type}{c.placement ? ` · ${c.placement}` : ""}{c.label ? ` (${c.label})` : ""}</li>)}
          </ul>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="mb-1.5 text-sm font-semibold text-slate-800">Garment variants</p>
        {variants.length === 0 ? <p className="text-xs text-slate-400">None.</p> : (
          <ul className="space-y-1 text-xs text-slate-600">
            {variants.map((v) => <li key={v.id}>{v.name}{v.colour_name ? ` / ${v.colour_name}` : ""}{v.is_active === false ? " (inactive)" : ""}</li>)}
          </ul>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="mb-1.5 text-sm font-semibold text-slate-800">Treatments</p>
        {treatments.length === 0 ? <p className="text-xs text-slate-400">None.</p> : (
          <ul className="space-y-1 text-xs text-slate-600">
            {treatments.map((t) => <li key={t.id}>{t.name}{t.production_method ? ` · ${t.production_method}` : ""}{Number(t.surcharge) > 0 ? ` · +R${t.surcharge}` : ""}{t.is_active === false ? " (inactive)" : ""}</li>)}
          </ul>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="mb-1.5 text-sm font-semibold text-slate-800">Allowed combinations</p>
        <AllowedCombinationsMatrix components={components} variants={variants} treatments={treatments} mappings={mappings} />
      </div>
    </div>
  );
}

function AllowedCombinationsMatrix({ variants, treatments, mappings }) {
  const matrix = buildAllowedCombinationMatrix({ variants, treatments, mappings });
  if (matrix.length === 0) return <p className="text-xs text-slate-400">No active garment variants yet.</p>;
  const activeTreatments = treatments.filter((t) => t.is_active !== false);
  if (activeTreatments.length === 0) return <p className="text-xs text-slate-400">No active treatments yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[11px]">
        <thead>
          <tr className="text-slate-500">
            <th className="py-1 pr-2 font-medium">Garment variant</th>
            {activeTreatments.map((t) => <th key={t.id} className="px-1.5 py-1 font-medium">{t.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {matrix.map(({ variant, allowed }) => (
            <tr key={variant.id} className="border-t border-slate-100">
              <td className="py-1 pr-2 text-slate-700">{variant.name}</td>
              {allowed.map(({ treatment, allowed: ok }) => (
                <td key={treatment.id} className="px-1.5 py-1 text-center">{ok ? <span className="text-emerald-600">✓</span> : <span className="text-slate-300">–</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuplicateCompositionInline({ product, hasComposition }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");

  const { data: candidates = [] } = useQuery({
    queryKey: ["clientProductsForCompositionClone", product.client_id],
    queryFn: () => dataClient.entities.ClientProduct.filter({ client_id: product.client_id }, "client_facing_name", 200),
    enabled: open && Boolean(product.client_id),
  });
  const sources = (Array.isArray(candidates) ? candidates : []).filter((c) => c.id !== product.id && c.client_id === product.client_id);

  const dupMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await duplicateProductComposition({
        sourceClientProductId: sourceId,
        targetClientProductId: product.id,
      });
      if (error) throw new Error(error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["productComponents", product.id] });
      setOpen(false);
      setSourceId("");
      toast.success(`Composition copied — ${data?.cloned_count ?? 0} component${data?.cloned_count === 1 ? "" : "s"}. Artwork, variants, treatments and status are not copied.`);
    },
    onError: (error) => toast.error(toStaffMessage(error.message)),
  });

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
        Duplicate composition from another Client Product
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-2">
      <p className="text-[11px] text-slate-500">
        Copies family production components from another Client Product <b>for this same client</b> into this one. Artwork, garment variants, treatments and customer status are never copied.
      </p>
      {hasComposition && (
        <p className="text-[11px] text-amber-600">This product already has composition — the server will reject the copy until it is empty.</p>
      )}
      <Select value={sourceId} onValueChange={setSourceId}>
        <SelectTrigger className="h-8"><SelectValue placeholder={sources.length ? "Select source client product" : "No other client products for this client"} /></SelectTrigger>
        <SelectContent>
          {sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.client_facing_name}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => { setOpen(false); setSourceId(""); }}>Cancel</Button>
        <Button size="sm" className="flex-1" disabled={!sourceId || dupMutation.isPending} onClick={() => dupMutation.mutate()}>
          {dupMutation.isPending ? "Copying…" : "Copy composition"}
        </Button>
      </div>
    </div>
  );
}

export default ClientProductsSection;
