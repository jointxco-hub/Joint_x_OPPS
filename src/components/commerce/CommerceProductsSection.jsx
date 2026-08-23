import { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Package, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { SearchSelect } from "@/pages/Inventory";
import { adminOnboardClientCommerceProduct, adminGetClientCommerceProducts, adminGetClientCommerceOnboardingOptions } from "@/api/commerceOnboarding";

// XOS 3B - internal staff onboarding for the tenant-wide Commerce catalog
// (commerce.products), connecting a client's managed product across
// Commerce, the client-account layer (client_products), OPPS, and X LAB via
// admin_onboard_client_commerce_product/admin_get_client_commerce_products
// (see supabase/migrations/20260823120000_xos_3b_product_onboarding.sql).
// Read-only for XOS itself - nothing here is reachable outside this staff
// admin surface.
//
// Shared between src/pages/Clients.jsx (Normal Clients) and
// src/pages/ManagedClients.jsx (the OPPS control plane, see
// supabase/migrations/20260823140000_managed_clients_control_plane.sql) -
// one Commerce product system, reused everywhere a clientId is available,
// never duplicated per screen.
export function CommerceProductsSection({ clientId }) {
  const [onboarding, setOnboarding] = useState(false);
  const queryClient = useQueryClient();

  const { data: commerceProducts = [], isLoading } = useQuery({
    queryKey: ['clientCommerceProducts', clientId],
    queryFn: async () => {
      const { data, error } = await adminGetClientCommerceProducts({ clientId });
      if (error) throw new Error(error);
      return data;
    },
    enabled: Boolean(clientId),
  });

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Commerce Products</h3>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOnboarding(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Add product
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : commerceProducts.length === 0 ? (
        <p className="text-sm text-slate-500">No commerce products onboarded yet.</p>
      ) : (
        <div className="space-y-2">
          {commerceProducts.map((entry) => (
            <div key={entry.commerce_product.id} className="rounded-md bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-sm">{entry.commerce_product.name}</p>
                <Badge variant="outline" className="capitalize">{entry.commerce_product.status}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">Commerce Connected</Badge>
                <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">Client Account Connected</Badge>
                <Badge variant="outline" className={entry.xlab.linked ? "text-emerald-700 border-emerald-300 bg-emerald-50" : "text-slate-500 border-slate-300"}>
                  {entry.xlab.linked ? "X LAB Connected" : "X LAB Not Linked"}
                </Badge>
                <Badge variant="outline" className={entry.opps.linked ? "text-emerald-700 border-emerald-300 bg-emerald-50" : "text-amber-700 border-amber-300 bg-amber-50"}>
                  {entry.opps.linked ? "OPPS Connected" : "OPPS Mapping Pending"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      {onboarding && (
        <ProductOnboardingDialog
          clientId={clientId}
          onClose={() => setOnboarding(false)}
          onSaved={() => {
            setOnboarding(false);
            queryClient.invalidateQueries({ queryKey: ['clientCommerceProducts', clientId] });
          }}
        />
      )}
    </section>
  );
}

function emptyOnboardingForm() {
  return {
    name: "", description: "", price: "", sale_price: "", currency: "ZAR",
    primary_image_url: "", availability: "available", status: "draft",
    client_price: "", requires_quote: false, visible_in_account: false, reorder_enabled: true,
    existing_client_product_id: "", existing_opps_product_id: "", existing_xlab_product_id: "",
  };
}

function emptyOnboardingVariant(sortOrder) {
  return { title: "", size: "", color: "", sku: "", price_override: "", availability: "available", sort_order: sortOrder };
}

function ProductOnboardingDialog({ clientId, onClose, onSaved }) {
  const [managedSource, setManagedSource] = useState("new"); // "new" | "existing"
  const [form, setForm] = useState(emptyOnboardingForm());
  const [variants, setVariants] = useState([]);
  const [variantsTouched, setVariantsTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  // Generated ONCE when this dialog mounts and held for its whole
  // lifetime (including retries after a transient failure) - regenerating
  // per click would defeat idempotency, since a retry would then look like
  // a brand new operation to the RPC instead of a safe replay. Closing and
  // reopening the dialog unmounts/remounts this component, which is what
  // gives the next onboarding session a fresh key.
  const [idempotencyKey] = useState(() => (
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `xos-onboard-${clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  ));

  const { data: options } = useQuery({
    queryKey: ['clientCommerceOnboardingOptions', clientId],
    queryFn: async () => {
      const { data, error } = await adminGetClientCommerceOnboardingOptions({ clientId });
      if (error) throw new Error(error);
      return data;
    },
    enabled: Boolean(clientId),
  });
  const clientProducts = options?.client_products || [];
  const oppsProducts = options?.opps_products || [];
  const xlabTemplates = options?.xlab_templates || [];
  const unlinkedClientProducts = clientProducts.filter((cp) => !cp.linked);
  // The picked managed product's own established OPPS/X LAB mapping, if
  // any - prefilled and locked below so a staff selection can never
  // silently conflict with it (see ONBOARD_EXISTING_MAPPING_CONFLICT).
  const selectedExistingClientProduct = managedSource === "existing"
    ? clientProducts.find((cp) => cp.id === form.existing_client_product_id) || null
    : null;
  const oppsLocked = Boolean(selectedExistingClientProduct?.opps_product_id);
  const xlabLocked = Boolean(selectedExistingClientProduct?.xlab_product_id);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const addVariant = () => { setVariantsTouched(true); setVariants((v) => [...v, emptyOnboardingVariant(v.length)]); };
  const updateVariant = (idx, patch) => { setVariantsTouched(true); setVariants((v) => v.map((row, i) => (i === idx ? { ...row, ...patch } : row))); };
  const removeVariant = (idx) => { setVariantsTouched(true); setVariants((v) => v.filter((_, i) => i !== idx)); };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const { file_url } = await dataClient.integrations.Core.UploadFile({ file, visibility: "public" });
      set({ primary_image_url: file_url });
    } catch {
      toast.error("Failed to upload image");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Product name is required");
      return;
    }
    if (managedSource === "existing" && !form.existing_client_product_id) {
      toast.error("Choose an existing managed product to link");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await adminOnboardClientCommerceProduct({
        clientId,
        product: {
          name: form.name.trim(),
          description: form.description || undefined,
          price: form.price === "" ? undefined : Number(form.price),
          sale_price: form.sale_price === "" ? undefined : Number(form.sale_price),
          currency: form.currency,
          primary_image_url: form.primary_image_url || undefined,
          availability: form.availability,
          status: form.status,
          client_price: form.client_price === "" ? undefined : Number(form.client_price),
          requires_quote: form.requires_quote,
          visible_in_account: form.visible_in_account,
          reorder_enabled: form.reorder_enabled,
        },
        // Untouched variants -> undefined -> RPC NULL ("preserve") rather
        // than an empty array, which would read as "deliberately clear".
        variants: variantsTouched
          ? variants.map((v, i) => ({
              title: v.title || undefined,
              size: v.size || undefined,
              color: v.color || undefined,
              sku: v.sku || undefined,
              price_override: v.price_override === "" ? undefined : Number(v.price_override),
              availability: v.availability,
              sort_order: i,
            }))
          : undefined,
        existingClientProductId: managedSource === "existing" ? form.existing_client_product_id : undefined,
        existingOppsProductId: form.existing_opps_product_id || undefined,
        existingXlabProductId: form.existing_xlab_product_id || undefined,
        idempotencyKey,
      });
      if (error || !data) {
        toast.error(error || "Could not onboard product");
        return;
      }
      toast.success("Product onboarded to Commerce");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">Add Commerce Product</h2>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="space-y-4">
            <div className="space-y-2 rounded-xl border border-slate-200 p-4">
              <Label className="mb-0">Managed Product Source</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={managedSource === "new" ? "default" : "outline"}
                  className={managedSource === "new" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                  onClick={() => {
                    setManagedSource("new");
                    set({ existing_client_product_id: "", name: "", existing_opps_product_id: "", existing_xlab_product_id: "" });
                  }}
                >
                  Create new managed product
                </Button>
                <Button
                  type="button"
                  variant={managedSource === "existing" ? "default" : "outline"}
                  className={managedSource === "existing" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                  onClick={() => setManagedSource("existing")}
                >
                  Link existing managed product
                </Button>
              </div>
              {managedSource === "existing" && (
                <div className="space-y-2 pt-1">
                  <Label className="text-xs text-slate-500">Existing Managed Product</Label>
                  <SearchSelect
                    options={unlinkedClientProducts}
                    value={form.existing_client_product_id}
                    onChange={(id) => {
                      const cp = unlinkedClientProducts.find((c) => c.id === id);
                      set({
                        existing_client_product_id: id,
                        name: cp?.client_facing_name || "",
                        existing_opps_product_id: cp?.opps_product_id || "",
                        existing_xlab_product_id: cp?.xlab_product_id || "",
                      });
                    }}
                    getLabel={(cp) => cp.client_facing_name}
                    placeholder={unlinkedClientProducts.length ? "Select a managed product to link" : "No unlinked managed products for this client"}
                  />
                  <p className="text-xs text-slate-500">Only managed products not already connected to a commerce product are shown.</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Product Name *</Label>
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. GSB Signature Hoodie" />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={3} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Retail Price</Label>
                <Input type="number" value={form.price} onChange={(e) => set({ price: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Sale Price</Label>
                <Input type="number" value={form.sale_price} onChange={(e) => set({ sale_price: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Input value={form.currency} onChange={(e) => set({ currency: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Primary Image</Label>
              {form.primary_image_url && (
                <img src={form.primary_image_url} alt="" className="w-full h-40 object-cover rounded-lg" />
              )}
              <Button variant="outline" className="w-full" disabled={uploadingImage} onClick={() => document.getElementById('onboard-primary-image').click()}>
                <Upload className="w-4 h-4 mr-2" />
                {uploadingImage ? "Uploading..." : "Upload Primary Image"}
              </Button>
              <input id="onboard-primary-image" type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Availability</Label>
                <Select value={form.availability} onValueChange={(v) => set({ availability: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="out_of_stock">Out of stock</SelectItem>
                    <SelectItem value="preorder">Preorder</SelectItem>
                    <SelectItem value="unavailable">Unavailable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => set({ status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="mb-0">Variants</Label>
                <Button variant="outline" size="sm" onClick={addVariant}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add variant
                </Button>
              </div>
              {variants.map((v, idx) => (
                <div key={idx} className="grid grid-cols-6 gap-1.5 items-center rounded-md bg-slate-50 p-2">
                  <Input className="col-span-2" placeholder="Title" value={v.title} onChange={(e) => updateVariant(idx, { title: e.target.value })} />
                  <Input placeholder="Size" value={v.size} onChange={(e) => updateVariant(idx, { size: e.target.value })} />
                  <Input placeholder="Color" value={v.color} onChange={(e) => updateVariant(idx, { color: e.target.value })} />
                  <Input placeholder="SKU" value={v.sku} onChange={(e) => updateVariant(idx, { sku: e.target.value })} />
                  <Button variant="ghost" size="icon" onClick={() => removeVariant(idx)}>
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <Label className="mb-0">Managed Client Fields</Label>
              <p className="text-xs text-slate-500">Separate from the retail price above - only applies when a new client account product is created.</p>
              <div className="space-y-2">
                <Label>Client / Service Price</Label>
                <Input type="number" value={form.client_price} onChange={(e) => set({ client_price: e.target.value })} placeholder="Leave blank unless staff sets a distinct managed price" />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.requires_quote} onCheckedChange={(v) => set({ requires_quote: Boolean(v) })} />
                <Label className="mb-0">Requires quote</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.visible_in_account} onCheckedChange={(v) => set({ visible_in_account: Boolean(v) })} />
                <Label className="mb-0">Visible in client account</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.reorder_enabled} onCheckedChange={(v) => set({ reorder_enabled: Boolean(v) })} />
                <Label className="mb-0">Reorder enabled</Label>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <Label className="mb-0">Integration</Label>
              <div className="space-y-2">
                <Label className="text-xs text-slate-500">OPPS Product (optional)</Label>
                {oppsLocked ? (
                  <>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      {selectedExistingClientProduct?.opps_product_name || selectedExistingClientProduct?.opps_product_id}
                    </div>
                    <p className="text-xs text-slate-500">Existing managed-product mapping - changing an already-established OPPS mapping is a separate reconciliation action, not part of onboarding.</p>
                  </>
                ) : (
                  <SearchSelect
                    options={oppsProducts}
                    value={form.existing_opps_product_id}
                    onChange={(id) => set({ existing_opps_product_id: id })}
                    getLabel={(p) => p.name}
                    placeholder="Not linked - onboarding will show 'OPPS mapping pending'"
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-500">X LAB Template (optional)</Label>
                {xlabLocked ? (
                  <>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      {selectedExistingClientProduct?.xlab_product_name || selectedExistingClientProduct?.xlab_product_id}
                    </div>
                    <p className="text-xs text-slate-500">Existing managed-product mapping - changing an already-established X LAB mapping is a separate reconciliation action, not part of onboarding.</p>
                  </>
                ) : (
                  <SearchSelect
                    options={xlabTemplates}
                    value={form.existing_xlab_product_id}
                    onChange={(id) => set({ existing_xlab_product_id: id })}
                    getLabel={(x) => x.category ? `${x.name} (${x.category})` : x.name}
                    placeholder="Not linked - reusable across multiple products in this tenant"
                  />
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !form.name.trim()} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                {saving ? "Onboarding..." : "Onboard Product"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
