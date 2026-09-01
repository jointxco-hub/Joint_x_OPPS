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
import { Package, Plus, X, ExternalLink, Image as ImageIcon, Eye, Sparkles } from "lucide-react";
import SecureImage from "@/components/common/SecureImage";
import QuickImagePreview from "@/components/common/QuickImagePreview";
import ClientAssetPickerModal from "@/components/files/ClientAssetPickerModal";
import { SearchSelect } from "@/pages/Inventory";
import {
  buildClientProductCreatePayload,
  CLIENT_PRODUCT_STATUSES,
  canReviewTenant,
} from "@/api/clientProducts";
import {
  getClientProductFull,
  setClientProductProductionComponents,
  setClientProductThumbnailFromAsset,
  setClientProductMockupFromAsset,
  linkClientProductArtworkFromAsset,
  previewClientProductSourceImport,
  importClientProductFromSource,
  createClientProductFromOrder,
  getClientOrderLinesForImport,
  mapXosCpError,
  resolveProductThumbRef,
  formatPlacementName,
  PRODUCT_READINESS_ROWS,
} from "@/api/xosClientProduct";
import CanonicalProductionEditor from "@/components/clients/CanonicalProductionEditor";

// The canonical Client Product is ONE shared record (X LAB migration
// 20260901150000). OPPS reads it via get_client_product_full and writes
// production / thumbnail / mockup / artwork through the shared RPCs.
// "Open in X LAB Admin" stays a secondary escape hatch, never the
// primary staff workflow.
const XLAB_ADMIN_BASE = "https://xlab.jointx.co.za/admin/client-products";

const IMG_FALLBACK = (
  <div className="flex h-full w-full items-center justify-center text-slate-300"><ImageIcon className="h-4 w-4" /></div>
);

function StatusBadge({ status }) {
  return <Badge variant="outline" className="capitalize">{String(status || "draft").replace(/_/g, " ")}</Badge>;
}

function ReadinessPill({ productReadiness }) {
  if (!productReadiness || typeof productReadiness !== "object") {
    return <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Readiness —</span>;
  }
  if (productReadiness.ready) {
    return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Ready</span>;
  }
  const n = productReadiness.missing_count ?? 0;
  return <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{n} to finish</span>;
}

function readinessRowText(key, check) {
  if (!check) return "—";
  if (key === "artwork") return check.ready ? `Ready (${check.ready_count}/${check.required_count})` : `${check.ready_count}/${check.required_count} ready`;
  if (key === "thumbnail") return check.ready ? (check.source === "mockup_fallback" ? "Using mockup" : "Set") : "Not set";
  if (key === "client_price") return check.ready ? "Set" : (check.reason === "pricing_pending" ? "Pricing pending" : "Not set");
  if (key === "production") return check.ready ? `${check.component_count} component${check.component_count === 1 ? "" : "s"}` : "Not configured";
  return check.ready ? "Ready" : "Not ready";
}

function CanonicalReadinessPanel({ productReadiness, artworkReadiness }) {
  const checks = productReadiness?.checks || {};
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">Product readiness</p>
        <ReadinessPill productReadiness={productReadiness} />
      </div>
      <ul className="space-y-1 text-xs">
        {PRODUCT_READINESS_ROWS.map(([key, label]) => {
          const check = checks[key];
          const ok = check?.ready;
          return (
            <li key={key} className="flex items-center justify-between">
              <span className="text-slate-500">{label}</span>
              <span className={ok ? "text-emerald-700" : "text-slate-600"}>{readinessRowText(key, check)}</span>
            </li>
          );
        })}
      </ul>
      {artworkReadiness?.blocking_reasons?.length > 0 && (
        <div className="mt-2 rounded-md bg-amber-50/70 p-2 text-[11px] text-amber-800">
          <p className="font-semibold">Blocking artwork readiness:</p>
          <ul className="list-inside list-disc">
            {artworkReadiness.blocking_reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

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
            <ProductCard key={product.id} product={product} onOpen={() => setOpenProductId(product.id)} />
          ))}
        </div>
      )}

      {creating && (
        <CreateClientProductDialog
          clientId={clientId}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            invalidateProducts();
            if (id) setOpenProductId(id);
          }}
        />
      )}

      {openProduct && (
        <ConfigureClientProductDrawer
          product={openProduct}
          clientId={clientId}
          onClose={() => setOpenProductId("")}
          onChanged={invalidateProducts}
        />
      )}
    </section>
  );
}

function ProductCard({ product, onOpen }) {
  const { data: fullRes } = useQuery({
    queryKey: ["xosClientProductFull", product.id],
    queryFn: () => getClientProductFull(product.id),
    enabled: Boolean(product.id),
    staleTime: 30_000,
  });
  const full = fullRes?.data || null;
  const thumbRef = resolveProductThumbRef(full) || product.thumbnail_url || product.primary_mockup_url;

  return (
    <div className="flex w-full items-center gap-3 rounded-md bg-slate-50 p-2.5">
      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-white">
        <SecureImage value={thumbRef} alt="" className="h-full w-full object-cover" fallback={IMG_FALLBACK} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{product.client_facing_name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={full?.flags?.status || product.status} />
          {full && <ReadinessPill productReadiness={full.product_readiness} />}
          {(full?.flags?.visible_in_account ?? product.visible_in_account) && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Customer-visible</span>
          )}
        </div>
      </div>
      <Button size="sm" onClick={onOpen}>Configure</Button>
    </div>
  );
}

// ─── Create ──────────────────────────────────────────────────────────
function CreateClientProductDialog({ clientId, onClose, onCreated }) {
  const [tab, setTab] = useState("blank");
  const [name, setName] = useState("");
  const [internalName, setInternalName] = useState("");
  const [orderId, setOrderId] = useState("");
  const [lineId, setLineId] = useState("");

  const blankMutation = useMutation({
    mutationFn: async () => {
      const payload = buildClientProductCreatePayload({ clientId, clientFacingName: name, internalName });
      return dataClient.entities.ClientProduct.create(payload);
    },
    onSuccess: (created) => {
      toast.success("Client product created");
      onCreated(created?.id);
    },
    onError: (error) => toast.error(error?.message || "Could not create client product"),
  });

  const { data: ordersRes = [] } = useQuery({
    queryKey: ["clientOrdersForCpCreate", clientId],
    queryFn: () => dataClient.entities.Order.filter({ client_id: clientId }, "-created_date", 100),
    enabled: tab === "order" && Boolean(clientId),
  });
  const orders = Array.isArray(ordersRes) ? ordersRes : [];

  const { data: linesRes } = useQuery({
    queryKey: ["clientOrderLinesForCpCreate", orderId],
    queryFn: () => getClientOrderLinesForImport(orderId),
    enabled: tab === "order" && Boolean(orderId),
  });
  const lines = Array.isArray(linesRes?.data) ? linesRes.data : [];

  const fromOrderMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await createClientProductFromOrder(orderId, lineId, {});
      if (error) throw new Error(error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(
        data?.deduplicated
          ? "Existing Client Product found for this order item — opening it."
          : "Client Product created from order",
      );
      onCreated(data?.client_product_id);
    },
    onError: (error) => toast.error(mapXosCpError(error?.message)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">New Client Product</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="order">From an order</TabsTrigger>
            <TabsTrigger value="blank">Blank</TabsTrigger>
          </TabsList>

          <TabsContent value="order" className="mt-3 space-y-3">
            <p className="text-xs text-slate-500">
              Creates ONE canonical Client Product from an order line, pre-configured from what the order already knows. If that line already has a Client Product, it just opens it.
            </p>
            <div className="space-y-1.5">
              <Label>Order</Label>
              <SearchSelect
                options={orders}
                value={orderId}
                onChange={(id) => { setOrderId(id); setLineId(""); }}
                getLabel={(o) => `${o.order_number || o.id?.slice(0, 8)} · ${o.status || ""}`}
                placeholder={orders.length ? "Select an order" : "No orders for this client"}
              />
            </div>
            {orderId && (
              <div className="space-y-1.5">
                <Label>Order line</Label>
                <SearchSelect
                  options={lines}
                  value={lineId}
                  onChange={setLineId}
                  getLabel={(l) => `${l.name || "Untitled"}${l.color ? ` · ${l.color}` : ""}${l.size ? ` · ${l.size}` : ""}${l.existing_client_product_id ? "  (already linked)" : ""}`}
                  placeholder={lines.length ? "Select a line" : "No lines on this order"}
                />
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!orderId || !lineId || fromOrderMutation.isPending}
                onClick={() => fromOrderMutation.mutate()}
              >
                {fromOrderMutation.isPending ? "Working…" : "Create / open"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="blank" className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label>Client-facing name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SFR Signature Tee" />
            </div>
            <div className="space-y-1.5">
              <Label>Internal name</Label>
              <Input value={internalName} onChange={(e) => setInternalName(e.target.value)} placeholder="Optional staff-only label" />
            </div>
            <p className="text-xs text-slate-500">
              Only a name is required. The product isn&apos;t visible to the customer until you publish it.
            </p>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button className="flex-1" disabled={blankMutation.isPending || !name.trim()} onClick={() => blankMutation.mutate()}>
                {blankMutation.isPending ? "Creating…" : "Create & open"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─── Drawer ──────────────────────────────────────────────────────────
function ConfigureClientProductDrawer({ product, clientId, onClose, onChanged }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const fullQueryKey = ["xosClientProductFull", product.id];
  const { data: fullRes, isLoading } = useQuery({
    queryKey: fullQueryKey,
    queryFn: () => getClientProductFull(product.id),
    enabled: Boolean(product.id),
  });
  const full = fullRes?.data || null;
  const fullError = fullRes?.error || null;

  const { data: canConfigureRes } = useQuery({
    queryKey: ["canReviewTenant", product.tenant_id],
    queryFn: () => canReviewTenant({ tenantId: product.tenant_id }),
    enabled: Boolean(product.tenant_id),
    staleTime: 60_000,
  });
  const canConfigureProduction = canConfigureRes?.data === true;

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: fullQueryKey });
    queryClient.invalidateQueries({ queryKey: ["clientProductsForClient", clientId] });
    onChanged?.();
  };

  const thumbRef = resolveProductThumbRef(full) || product.primary_mockup_url;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-slate-200 p-4">
          <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
            <SecureImage value={thumbRef} alt="" className="h-full w-full object-cover" fallback={IMG_FALLBACK} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{full?.identity?.client_facing_name || product.client_facing_name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={full?.flags?.status || product.status} />
              {full && <ReadinessPill productReadiness={full.product_readiness} />}
              {full?.flags?.visible_in_account && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Customer-visible</span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              {full?.source_order && (
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  <Sparkles className="h-3 w-3" /> Import missing information
                </button>
              )}
              <a
                href={`${XLAB_ADMIN_BASE}/${product.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600"
              >
                <ExternalLink className="h-3 w-3" /> Open in X LAB Admin
              </a>
            </div>
            {full?.source_order && (
              <p className="mt-1 text-[11px] text-slate-400">
                Created from {full.source_order.order_number}
                {full.source_order.line_id ? ` · line ${full.source_order.line_id}` : ""}
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
        </div>

        {isLoading ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : fullError ? (
          <p className="p-4 text-sm text-red-600">{mapXosCpError(fullError)}</p>
        ) : (
          <Tabs defaultValue="details" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-4 mt-3 grid w-auto grid-cols-4">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="production">Production</TabsTrigger>
              <TabsTrigger value="artwork">Artwork</TabsTrigger>
              <TabsTrigger value="status">Status</TabsTrigger>
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <TabsContent value="details" className="mt-0">
                <DetailsTab product={product} full={full} clientId={clientId} onChanged={refetchAll} onPreview={setPreview} />
              </TabsContent>
              <TabsContent value="production" className="mt-0">
                <ProductionTab product={product} full={full} canConfigure={canConfigureProduction} onChanged={refetchAll} />
              </TabsContent>
              <TabsContent value="artwork" className="mt-0">
                <ArtworkTab product={product} full={full} clientId={clientId} onChanged={refetchAll} onPreview={setPreview} />
              </TabsContent>
              <TabsContent value="status" className="mt-0">
                <StatusTab product={product} full={full} onChanged={refetchAll} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </div>

      {importOpen && (
        <ImportPreviewDialog
          product={product}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); refetchAll(); }}
        />
      )}

      <QuickImagePreview open={Boolean(preview)} onClose={() => setPreview(null)} value={preview?.value} title={preview?.title} />
    </div>
  );
}

// ─── Details tab ─────────────────────────────────────────────────────
// Pure client_products columns only — RLS-gated ORM update (tenant/client
// scope already correct). print_method / placement / print_locations /
// production_instructions are DERIVED from structured production and are
// never edited here. Thumbnail + mockup go through the shared RPCs.
const DETAIL_TEXT_FIELDS = [
  ["client_facing_name", "Client-facing name"],
  ["internal_name", "Internal name (staff only)"],
  ["garment_material", "Garment material"],
  ["garment_gsm", "Garment GSM"],
  ["garment_color", "Garment colour"],
  ["print_size", "Print size"],
];

function DetailsTab({ product, full, clientId, onChanged, onPreview }) {
  const queryClient = useQueryClient();
  const [picker, setPicker] = useState(null); // 'thumbnail' | 'mockup'
  const [linking, setLinking] = useState(false);
  const details = full?.details || {};
  const [form, setForm] = useState(() => ({
    client_facing_name: full?.identity?.client_facing_name ?? product.client_facing_name ?? "",
    internal_name: full?.identity?.internal_name ?? "",
    garment_material: details.garment_material ?? "",
    garment_gsm: details.garment_gsm ?? "",
    garment_color: details.garment_color ?? "",
    print_size: details.print_size ?? "",
    currency: full?.pricing?.currency ?? "ZAR",
    packaging_instructions: details.packaging_instructions ?? "",
    special_instructions: details.special_instructions ?? "",
    internal_notes: details.internal_notes ?? "",
  }));
  const set = (patch) => setForm((c) => ({ ...c, ...patch }));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["xosClientProductFull", product.id] });
    queryClient.invalidateQueries({ queryKey: ["clientProductsForClient", clientId] });
    onChanged?.();
  };

  const saveMutation = useMutation({
    mutationFn: async () => dataClient.entities.ClientProduct.update(product.id, {
      client_facing_name: form.client_facing_name.trim() || product.client_facing_name,
      internal_name: form.internal_name.trim(),
      garment_material: form.garment_material.trim(),
      garment_gsm: form.garment_gsm.trim(),
      garment_color: form.garment_color.trim(),
      print_size: form.print_size.trim(),
      currency: form.currency.trim() || "ZAR",
      packaging_instructions: form.packaging_instructions.trim(),
      special_instructions: form.special_instructions.trim(),
      internal_notes: form.internal_notes.trim(),
    }),
    onSuccess: () => { toast.success("Details saved"); invalidate(); },
    onError: (error) => toast.error(error?.message || "Could not save details"),
  });

  const thumbMutation = useMutation({
    mutationFn: async (asset) => {
      const { error } = await setClientProductThumbnailFromAsset(product.id, asset.id);
      if (error) throw new Error(error);
    },
    onSuccess: () => { toast.success("Thumbnail set"); setPicker(null); invalidate(); },
    onError: (error) => toast.error(mapXosCpError(error?.message)),
    onSettled: () => setLinking(false),
  });

  const mockupMutation = useMutation({
    mutationFn: async (asset) => {
      const { error } = await setClientProductMockupFromAsset(product.id, asset.id);
      if (error) throw new Error(error);
    },
    onSuccess: () => { toast.success("Mockup set"); setPicker(null); invalidate(); },
    onError: (error) => toast.error(mapXosCpError(error?.message)),
    onSettled: () => setLinking(false),
  });

  const removeMutation = useMutation({
    mutationFn: async (which) => dataClient.entities.ClientProduct.update(product.id, which === "thumbnail"
      ? { thumbnail_asset_id: null, thumbnail_url: null }
      : { primary_mockup_asset_id: null, primary_mockup_url: null }),
    onSuccess: (_d, which) => { toast.success(`${which === "thumbnail" ? "Thumbnail" : "Mockup"} removed`); invalidate(); },
    onError: (error) => toast.error(error?.message || "Could not remove"),
  });

  const thumb = full?.thumbnail || {};
  const mockup = full?.mockup || {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {/* Thumbnail — product visual identity */}
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-medium">Thumbnail</p>
          <p className="text-[11px] text-slate-500">The product&apos;s visual identity.</p>
          <div className="mt-2 h-20 w-20 overflow-hidden rounded-lg bg-slate-100">
            <SecureImage value={thumb.url} alt="" className="h-full w-full object-cover" fallback={IMG_FALLBACK} />
          </div>
          {thumb.source === "mockup_fallback" && (
            <p className="mt-1 text-[11px] text-amber-600">No explicit thumbnail — showing the mockup.</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setPicker("thumbnail")}>Use existing file</Button>
            {thumb.source === "thumbnail" && (
              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => removeMutation.mutate("thumbnail")}>Remove</Button>
            )}
            {thumb.url && (
              <Button variant="ghost" size="sm" onClick={() => onPreview({ value: thumb.url, title: "Thumbnail" })}>
                <Eye className="mr-1 h-3.5 w-3.5" /> View
              </Button>
            )}
          </div>
        </div>

        {/* Mockup — client review / approval image */}
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-medium">Mockup</p>
          <p className="text-[11px] text-slate-500">The client review / approval image.</p>
          <div className="mt-2 h-20 w-20 overflow-hidden rounded-lg bg-slate-100">
            <SecureImage value={mockup.url} alt="" className="h-full w-full object-cover" fallback={IMG_FALLBACK} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setPicker("mockup")}>Use existing file</Button>
            {mockup.url && (
              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => removeMutation.mutate("mockup")}>Remove</Button>
            )}
            {mockup.url && (
              <Button variant="ghost" size="sm" onClick={() => onPreview({ value: mockup.url, title: "Mockup" })}>
                <Eye className="mr-1 h-3.5 w-3.5" /> View
              </Button>
            )}
          </div>
        </div>
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
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-xs text-slate-600">
        <p className="font-medium text-slate-700">Production (derived, read-only)</p>
        <p className="mt-0.5">
          {full?.production?.summary?.print_method || "—"}
          {full?.production?.summary?.placement ? ` · ${full.production.summary.placement}` : ""}
        </p>
        <p className="mt-1 text-[11px] text-slate-400">Edit these in the Production tab.</p>
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
        <Textarea rows={3} value={form.internal_notes} onChange={(e) => set({ internal_notes: e.target.value })} />
      </div>

      <Button className="w-full" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
        {saveMutation.isPending ? "Saving…" : "Save details"}
      </Button>

      {picker && (
        <ClientAssetPickerModal
          clientId={clientId}
          selectionMode="single"
          defaultCategory={picker === "thumbnail" ? "Mockups" : "Mockups"}
          uploadCategory="Mockups"
          title={picker === "thumbnail" ? "Set thumbnail" : "Set mockup"}
          description="Pick an existing client file (orders, requests, library) or upload a new one. Nothing is re-uploaded when the file already exists."
          confirmVerb="Use"
          onClose={() => setPicker(null)}
          onConfirm={([asset]) => {
            if (!asset) return;
            setLinking(true);
            (picker === "thumbnail" ? thumbMutation : mockupMutation).mutate(asset);
          }}
        />
      )}
      {linking && <p className="text-center text-xs text-slate-400">Linking…</p>}
    </div>
  );
}

// ─── Production tab ──────────────────────────────────────────────────
function ProductionTab({ product, full, canConfigure, onChanged }) {
  const queryClient = useQueryClient();
  const saveMutation = useMutation({
    mutationFn: async (components) => {
      const { error } = await setClientProductProductionComponents(product.id, components);
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      toast.success("Production saved");
      queryClient.invalidateQueries({ queryKey: ["xosClientProductFull", product.id] });
      onChanged?.();
    },
    onError: (error) => toast.error(mapXosCpError(error?.message)),
  });

  return (
    <div className="space-y-3">
      <CanonicalProductionEditor
        full={full}
        saving={saveMutation.isPending}
        readOnly={!canConfigure}
        onSave={(components) => saveMutation.mutateAsync(components).catch(() => {})}
      />
      <CanonicalReadinessPanel productReadiness={full?.product_readiness} artworkReadiness={full?.artwork_readiness} />
    </div>
  );
}

// ─── Artwork tab ────────────────────────────────────────────────────
// Shells come from full.required_artwork_placements (DERIVED from
// production). Never renders a shell from a file-less artwork row and
// never creates an empty client_product_artwork row.
function ArtworkTab({ product, full, clientId, onChanged, onPreview }) {
  const queryClient = useQueryClient();
  const [pickerSlug, setPickerSlug] = useState("");
  const required = Array.isArray(full?.required_artwork_placements) ? full.required_artwork_placements : [];
  const artworkBySlug = useMemo(() => {
    const map = new Map();
    for (const entry of Array.isArray(full?.artwork) ? full.artwork : []) {
      map.set(entry.placement_slug || String(entry.placement || "").toLowerCase(), entry);
    }
    return map;
  }, [full]);
  const artReadiness = full?.artwork_readiness || {};

  const linkMutation = useMutation({
    mutationFn: async ({ slug, asset }) => {
      const hasCurrent = Boolean(artworkBySlug.get(slug)?.current);
      const { error } = await linkClientProductArtworkFromAsset(product.id, asset.id, slug, !hasCurrent);
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      toast.success("Artwork linked");
      setPickerSlug("");
      queryClient.invalidateQueries({ queryKey: ["xosClientProductFull", product.id] });
      onChanged?.();
    },
    onError: (error) => toast.error(mapXosCpError(error?.message)),
  });

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 p-2.5 text-xs text-slate-600">
        <p className="font-medium text-slate-700">
          Required placements: {required.length ? required.map(formatPlacementName).join(", ") : "none"}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Derived from print-service production components. Add or change them in the Production tab.
        </p>
      </div>

      {required.length === 0 ? (
        <p className="text-xs text-slate-400">
          No required artwork placements. Configure print-service production first.
        </p>
      ) : (
        <div className="space-y-2">
          {required.map((slug) => {
            const entry = artworkBySlug.get(slug);
            const current = entry?.current || null;
            const history = Array.isArray(entry?.history) ? entry.history : [];
            return (
              <div key={slug} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-slate-100">
                    {current ? (
                      <SecureImage value={current.file_path} alt="" className="h-full w-full object-cover" fallback={IMG_FALLBACK} />
                    ) : IMG_FALLBACK}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{formatPlacementName(slug)}</p>
                    {current ? (
                      <p className="truncate text-xs text-slate-500">
                        {current.file_name || "linked file"}
                        <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${current.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                          {current.status}
                        </span>
                        {history.length > 1 && <span className="ml-1.5 text-[10px] text-slate-400">Rev {current.revision} · {history.length} revisions</span>}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400">No artwork linked</p>
                    )}
                  </div>
                  {current && (
                    <Button variant="ghost" size="sm" onClick={() => onPreview({ value: current.file_path, title: `${formatPlacementName(slug)} artwork` })}>
                      <Eye className="mr-1 h-3.5 w-3.5" /> View
                    </Button>
                  )}
                  <Button variant="outline" size="sm" disabled={linkMutation.isPending} onClick={() => setPickerSlug(slug)}>
                    {current ? "Change" : "Link existing"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {artReadiness.blocking_reasons?.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800">
          <p className="mb-1 font-semibold">Blocking readiness:</p>
          <ul className="list-inside list-disc space-y-0.5">
            {artReadiness.blocking_reasons.map((reason, i) => <li key={i}>{reason}</li>)}
          </ul>
        </div>
      )}

      {pickerSlug && (
        <ClientAssetPickerModal
          clientId={clientId}
          selectionMode="single"
          defaultCategory="Artwork"
          uploadCategory="Artwork"
          showApprovalBadge
          title={`Link artwork — ${formatPlacementName(pickerSlug)}`}
          description="Pick an existing client file (orders, requests, library) or upload a new one. It becomes a revision for this placement; older revisions are kept and the current approved artwork is never silently replaced."
          confirmVerb="Use"
          onClose={() => setPickerSlug("")}
          onConfirm={([asset]) => asset && linkMutation.mutate({ slug: pickerSlug, asset })}
        />
      )}
    </div>
  );
}

// ─── Status tab ─────────────────────────────────────────────────────
// Pure client_products columns + DB lifecycle triggers — RLS-gated ORM
// update behind an explicit confirm, unchanged. Readiness comes from the
// canonical projection.
function StatusTab({ product, full, onChanged }) {
  const queryClient = useQueryClient();
  const [pendingChange, setPendingChange] = useState(null);
  const status = full?.flags?.status || product.status || "draft";
  const productReadiness = full?.product_readiness;

  const applyMutation = useMutation({
    mutationFn: async (payload) => dataClient.entities.ClientProduct.update(product.id, payload),
    onSuccess: () => {
      toast.success("Updated");
      setPendingChange(null);
      queryClient.invalidateQueries({ queryKey: ["xosClientProductFull", product.id] });
      queryClient.invalidateQueries({ queryKey: ["clientProductsForClient", product.client_id] });
      onChanged?.();
    },
    onError: (error) => { toast.error(error?.message || "Could not update"); setPendingChange(null); },
  });

  const requestChange = (label, payload) => setPendingChange({ label, payload });

  return (
    <div className="space-y-4">
      <CanonicalReadinessPanel productReadiness={productReadiness} artworkReadiness={full?.artwork_readiness} />

      <div className="rounded-lg border border-slate-200 p-3">
        <Label className="text-[11px] text-slate-500">Lifecycle status</Label>
        <Select
          value={status}
          onValueChange={(next) => {
            if (next === status) return;
            requestChange(`Change status to "${next.replace(/_/g, " ")}"`, { status: next });
          }}
        >
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CLIENT_PRODUCT_STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-[11px] text-slate-500">
          Marking &quot;ready to order&quot; is blocked by the database until required artwork is ready.
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Storefront-sensitive — changes what customers can do</p>

        <label className="flex items-center justify-between py-1.5 text-sm">
          <span>Visible in client account</span>
          <input
            type="checkbox"
            checked={Boolean(full?.flags?.visible_in_account ?? product.visible_in_account)}
            onChange={(e) => requestChange(
              `${e.target.checked ? "Show" : "Hide"} this product in the customer's account`,
              { visible_in_account: e.target.checked },
            )}
          />
        </label>

        <label className="flex items-center justify-between py-1.5 text-sm">
          <span>Reorder enabled</span>
          <input
            type="checkbox"
            checked={Boolean(full?.flags?.reorder_enabled ?? product.reorder_enabled)}
            onChange={(e) => requestChange(
              `${e.target.checked ? "Allow" : "Block"} customer reordering of this product`,
              { reorder_enabled: e.target.checked },
            )}
          />
        </label>

        <div className="py-1.5">
          <Label className="text-[11px] text-slate-500">Customer / service price</Label>
          <PriceField
            initial={full?.pricing?.client_price ?? product.client_price}
            onCommit={(value) => requestChange(`Set customer price to ${value === null ? "— (cleared)" : `R${value}`}`, { client_price: value ?? "" })}
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

// ─── Import missing information ──────────────────────────────────────
const DIFF_TONE = {
  add: "border-emerald-200 bg-emerald-50 text-emerald-700",
  normalize: "border-sky-200 bg-sky-50 text-sky-700",
  conflict: "border-red-200 bg-red-50 text-red-700",
  no_change: "border-slate-200 bg-slate-50 text-slate-500",
};

function ImportPreviewDialog({ product, onClose, onImported }) {
  const { data: previewRes, isLoading } = useQuery({
    queryKey: ["xosCpSourcePreview", product.id],
    queryFn: () => previewClientProductSourceImport(product.id),
    enabled: Boolean(product.id),
  });
  const preview = previewRes?.data || null;
  const previewError = previewRes?.error || null;

  const importMutation = useMutation({
    mutationFn: async () => {
      const { error } = await importClientProductFromSource(product.id);
      if (error) throw new Error(error);
    },
    onSuccess: () => { toast.success("Imported from source order"); onImported(); },
    onError: (error) => toast.error(mapXosCpError(error?.message)),
  });

  const diff = Array.isArray(preview?.diff) ? preview.diff : [];

  return (
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">Import missing information</p>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : previewError ? (
          <p className="text-sm text-red-600">{mapXosCpError(previewError)}</p>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              From {preview?.source_order?.order_number || "the source order"}
              {preview?.source_order?.line_id ? ` · line ${preview.source_order.line_id}` : ""}.
              Curated values are never overwritten, current artwork is never replaced, and no files are copied.
            </p>
            <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
              {diff.length === 0 ? (
                <p className="text-xs text-slate-400">Nothing to import — everything is already set.</p>
              ) : diff.map((row, i) => (
                <div key={i} className={`rounded-md border px-2.5 py-1.5 text-xs ${DIFF_TONE[row.op] || DIFF_TONE.no_change}`}>
                  <span className="font-semibold uppercase tracking-wide">{String(row.op || "").replace(/_/g, " ")}</span>
                  {" · "}
                  <span className="font-medium">{String(row.field || "").replace(/_/g, " ")}</span>
                  {row.to != null && row.to !== "" && <> → {String(row.to)}</>}
                  {row.reason && <span className="ml-1 opacity-70">({String(row.reason).replace(/_/g, " ")})</span>}
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={importMutation.isPending || diff.every((r) => r.op === "no_change")}
                onClick={() => importMutation.mutate()}
              >
                {importMutation.isPending ? "Importing…" : "Import missing information"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ClientProductsSection;
