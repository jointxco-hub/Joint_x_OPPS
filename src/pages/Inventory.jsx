import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { supabase } from "@/lib/supabaseClient";
import { getCurrentTenantId } from "@/lib/tenantContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Boxes, AlertTriangle, Archive, Pencil, LayoutGrid, List, Package, RefreshCw, Download, Trash2, X, ClipboardCheck, History, Tag, Rows3, LayoutList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import ResponsiveModal from "@/components/common/ResponsiveModal";

const INV_CATEGORIES = [
  "tees","hoodies","sweaters","bottoms","headwear","accessories",
  "vinyl","dtf_materials","embroidery_materials","ink","labels","packaging","other",
];

const CATALOG_CATEGORIES = [
  "all","tshirts","hoodies","sweaters","hats","bottoms","printing","labels","accessories","other",
];

const UNITS = ["pieces","meters","rolls","liters"];

const INVENTORY_CATEGORY_MAP = {
  tshirts: "tees",
  hats: "headwear",
  printing: "dtf_materials",
};

const getInventoryCategory = (category) => INVENTORY_CATEGORY_MAP[category] || category || "other";

const PRODUCT_IMAGE_FALLBACKS = {
  "5-panel cap": "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=800",
  "bucket hat": "https://images.unsplash.com/photo-1572307480813-ceb0e59d8325?w=800",
  "trucker cap": "https://images.unsplash.com/photo-1534215754734-18e55d13e346?w=800",
  "custom labels": "https://images.unsplash.com/photo-1607344645866-009c320b63e0?w=800",
  "jv1 t-shirt": "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800",
  "jet t-shirt": "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800",
  "jhg t-shirt": "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=800",
};

const CATEGORY_IMAGE_FALLBACKS = {
  tshirts: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800",
  hoodies: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=800",
  sweaters: "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=800",
  hats: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=800",
  bottoms: "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=800",
  labels: "https://images.unsplash.com/photo-1607344645866-009c320b63e0?w=800",
};

const getProductImageUrls = (product) => {
  const images = Array.isArray(product?.images) ? product.images : [];
  const galleryUrls = images
    .map(image => typeof image === "string" ? image : image?.src)
    .filter(Boolean);
  const nameFallback = PRODUCT_IMAGE_FALLBACKS[String(product?.name || "").trim().toLowerCase()];
  const categoryFallback = CATEGORY_IMAGE_FALLBACKS[product?.category];
  return [product?.image_url, ...galleryUrls, nameFallback, categoryFallback].filter(Boolean);
};

const getProductImageUrl = (product) => getProductImageUrls(product)[0] || "";

const dedupeProducts = (products) => {
  const byName = new Map();
  for (const product of products) {
    const key = `${product.name || ""}`.trim().toLowerCase();
    if (!key) continue;
    const current = byName.get(key);
    const productScore =
      (getProductImageUrl(product) ? 4 : 0) +
      ((product.addons?.length || 0) > 0 ? 2 : 0) +
      ((product.print_options?.length || 0) > 0 ? 2 : 0) +
      (product.store_visible !== false ? 1 : 0) +
      (Date.parse(product.updated_date || product.updated_at || product.created_date || product.created_at || 0) / 10000000000000);
    const currentScore = current
      ? (getProductImageUrl(current) ? 4 : 0) +
        ((current.addons?.length || 0) > 0 ? 2 : 0) +
        ((current.print_options?.length || 0) > 0 ? 2 : 0) +
        (current.store_visible !== false ? 1 : 0) +
        (Date.parse(current.updated_date || current.updated_at || current.created_date || current.created_at || 0) / 10000000000000)
      : -1;
    if (!current || productScore >= currentScore) byName.set(key, product);
  }
  return Array.from(byName.values());
};

const EMPTY_CATALOG_FORM = {
  name: "", description: "", category: "tshirts",
  price: "", image_url: "", code: "", gsm: "", material: "",
  status: "active", store_visible: true,
  addons: [], print_options: [], images: [],
};

const EMPTY_ADDON = { name: "", price: 0 };
const EMPTY_PRINT_OPTION = { name: "", type: "dtf", price: 0, locations: "Front, Back" };

function CatalogItemFormModal({ open, onClose, existing }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    ...EMPTY_CATALOG_FORM,
    ...(existing ?? {}),
    addons: Array.isArray(existing?.addons) ? existing.addons : [],
    print_options: Array.isArray(existing?.print_options) ? existing.print_options : [],
    images: Array.isArray(existing?.images) ? existing.images : [],
    store_visible: existing?.store_visible !== false,
  });
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const setChecked = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.checked }));

  const updateArrayItem = (key, index, field, value) => {
    setForm(f => ({
      ...f,
      [key]: f[key].map((item, i) => i === index ? { ...item, [field]: value } : item),
    }));
  };

  const removeArrayItem = (key, index) => {
    setForm(f => ({ ...f, [key]: f[key].filter((_, i) => i !== index) }));
  };

  const mutation = useMutation({
    mutationFn: (data) =>
      existing
        ? dataClient.entities.CatalogItem.update(existing.id, data)
        : dataClient.entities.CatalogItem.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogItems"] });
      toast.success(existing ? "Product updated" : "Product added");
      onClose();
    },
    onError: (err) => toast.error(err?.message || "Failed to save"),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    mutation.mutate({
      name: form.name.trim(),
      description: form.description || null,
      category: form.category || "other",
      price: form.price !== "" ? Number(form.price) : null,
      image_url: form.image_url || null,
      images: form.images,
      code: form.code || null,
      gsm: form.gsm || null,
      material: form.material || null,
      status: form.status || "active",
      store_visible: form.store_visible !== false,
      addons: form.addons
        .filter(addon => addon.name?.trim())
        .map(addon => ({ ...addon, name: addon.name.trim(), price: Number(addon.price) || 0 })),
      print_options: form.print_options
        .filter(option => option.name?.trim())
        .map(option => ({
          ...option,
          name: option.name.trim(),
          type: option.type || "dtf",
          price: Number(option.price) || 0,
          locations: String(Array.isArray(option.locations) ? option.locations.join(",") : option.locations || "")
            .split(",")
            .map(location => location.trim())
            .filter(Boolean),
        })),
    });
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={existing ? "Edit Product" : "Add Catalog Product"}
      size="md"
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : existing ? "Save" : "Add Product"}
          </Button>
        </div>
      }
    >
      <form className="space-y-3 py-2" onSubmit={handleSubmit}>
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Name *</label>
          <Input value={form.name} onChange={set("name")} placeholder="Cotton Tee" className="h-11 md:h-10" />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Description</label>
          <textarea value={form.description} onChange={set("description")}
            placeholder="Brief product description…"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none h-20" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Code</label>
            <Input value={form.code || ""} onChange={set("code")} placeholder="JV1" className="h-11 md:h-10" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">GSM</label>
            <Input value={form.gsm || ""} onChange={set("gsm")} placeholder="220gsm" className="h-11 md:h-10" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Material</label>
            <Input value={form.material || ""} onChange={set("material")} placeholder="Cotton" className="h-11 md:h-10" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Category</label>
            <select value={form.category} onChange={set("category")}
              className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
              {CATALOG_CATEGORIES.filter(c => c !== "all").map(c => (
                <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Price (R)</label>
            <Input type="number" value={form.price} onChange={set("price")} placeholder="0.00" className="h-11 md:h-10" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Image URL</label>
          <Input value={form.image_url} onChange={set("image_url")} placeholder="https://…" className="h-11 md:h-10" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Status</label>
            <select value={form.status} onChange={set("status")}
              className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
              <option value="active">Active</option>
              <option value="draft">Draft</option>
            </select>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-input px-3 text-sm">
            <input type="checkbox" checked={form.store_visible !== false} onChange={setChecked("store_visible")} />
            Visible on XLab store
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-foreground">Add-ons</label>
            <button type="button" className="text-xs text-primary font-medium" onClick={() => setForm(f => ({ ...f, addons: [...f.addons, EMPTY_ADDON] }))}>Add</button>
          </div>
          {form.addons.map((addon, index) => (
            <div key={index} className="grid grid-cols-[1fr_92px_28px] gap-2">
              <Input value={addon.name || ""} onChange={e => updateArrayItem("addons", index, "name", e.target.value)} placeholder="Neck tag" className="h-9" />
              <Input type="number" value={addon.price ?? 0} onChange={e => updateArrayItem("addons", index, "price", e.target.value)} className="h-9" />
              <button type="button" onClick={() => removeArrayItem("addons", index)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-foreground">Print Options</label>
            <button type="button" className="text-xs text-primary font-medium" onClick={() => setForm(f => ({ ...f, print_options: [...f.print_options, EMPTY_PRINT_OPTION] }))}>Add</button>
          </div>
          {form.print_options.map((option, index) => (
            <div key={index} className="rounded-xl border border-border p-2 space-y-2">
              <div className="grid grid-cols-[1fr_90px_28px] gap-2">
                <Input value={option.name || ""} onChange={e => updateArrayItem("print_options", index, "name", e.target.value)} placeholder="DTF Front" className="h-9" />
                <Input type="number" value={option.price ?? 0} onChange={e => updateArrayItem("print_options", index, "price", e.target.value)} className="h-9" />
                <button type="button" onClick={() => removeArrayItem("print_options", index)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={option.type || "dtf"} onChange={e => updateArrayItem("print_options", index, "type", e.target.value)} className="h-9 rounded-xl border border-input bg-background px-3 text-sm">
                  <option value="dtf">DTF</option>
                  <option value="vinyl">Vinyl</option>
                  <option value="embroidery">Embroidery</option>
                  <option value="screen">Screen</option>
                  <option value="other">Other</option>
                </select>
                <Input value={Array.isArray(option.locations) ? option.locations.join(", ") : option.locations || ""} onChange={e => updateArrayItem("print_options", index, "locations", e.target.value)} placeholder="Front, Back" className="h-9" />
              </div>
            </div>
          ))}
        </div>
      </form>
    </ResponsiveModal>
  );
}

const EMPTY_FORM = {
  name: "", sku: "", category: "other", unit: "pieces",
  current_stock: 0, reorder_point: 10, reorder_quantity: 0,
  cost_price: "", selling_price: "", location: "", preferred_supplier_id: "",
};

function ItemFormModal({ open, onClose, existing, suppliers }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(existing ?? EMPTY_FORM);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (data) =>
      existing
        ? dataClient.entities.InventoryItem.update(existing.id, data)
        : dataClient.entities.InventoryItem.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success(existing ? "Item updated" : "Item added");
      onClose();
    },
    onError: (err) => toast.error(err?.message || "Failed to save"),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    mutation.mutate({
      name: form.name.trim(),
      sku: form.sku || null,
      category: form.category || "other",
      unit: form.unit || "pieces",
      current_stock: Number(form.current_stock) || 0,
      reorder_point: Number(form.reorder_point) || null,
      reorder_quantity: Number(form.reorder_quantity) || null,
      cost_price: form.cost_price !== "" ? Number(form.cost_price) : null,
      selling_price: form.selling_price !== "" ? Number(form.selling_price) : null,
      location: form.location || null,
      preferred_supplier_id: form.preferred_supplier_id || null,
    });
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={existing ? "Edit Item" : "Add Inventory Item"}
      size="md"
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : existing ? "Save" : "Add Item"}
          </Button>
        </div>
      }
    >
      <form className="space-y-3 py-2" onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Name *</label>
            <Input value={form.name} onChange={set("name")} placeholder="Cotton Tee" className="h-11 md:h-10" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">SKU</label>
            <Input value={form.sku} onChange={set("sku")} placeholder="TEE-001" className="h-11 md:h-10" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Category</label>
            <select value={form.category} onChange={set("category")}
              className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
              {INV_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Unit</label>
            <select value={form.unit} onChange={set("unit")}
              className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Stock</label>
            <Input type="number" value={form.current_stock} onChange={set("current_stock")} className="h-11 md:h-10" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Reorder at</label>
            <Input type="number" value={form.reorder_point} onChange={set("reorder_point")} className="h-11 md:h-10" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Reorder qty</label>
            <Input type="number" value={form.reorder_quantity} onChange={set("reorder_quantity")} className="h-11 md:h-10" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Cost price (R)</label>
            <Input type="number" value={form.cost_price} onChange={set("cost_price")} placeholder="0.00" className="h-11 md:h-10" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Selling price (R)</label>
            <Input type="number" value={form.selling_price} onChange={set("selling_price")} placeholder="0.00" className="h-11 md:h-10" />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Location / bin</label>
          <Input value={form.location} onChange={set("location")} placeholder="Shelf A3" className="h-11 md:h-10" />
        </div>

        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Preferred Supplier</label>
          <select value={form.preferred_supplier_id} onChange={set("preferred_supplier_id")}
            className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
            <option value="">— None —</option>
            {(/** @type {any[]} */ (suppliers)).map((/** @type {any} */ s) => (
              <option key={s.id} value={s.id}>{s.name ?? s.vendor}</option>
            ))}
          </select>
        </div>
      </form>
    </ResponsiveModal>
  );
}

const MOVEMENT_TYPE_LABEL = {
  count: "Count",
  manual_adjust: "Manual adjustment",
  receive: "Received",
  order_pick: "Order pick",
  return: "Return",
  damage: "Damage",
  transfer: "Transfer",
};

function StockCountModal({ open, onClose, item, currentUser }) {
  const qc = useQueryClient();
  const [physicalQty, setPhysicalQty] = useState(String(item?.current_stock ?? 0));
  const [location, setLocation] = useState(item?.location || "");
  const [notes, setNotes] = useState("");

  const before = Number(item?.current_stock) || 0;
  const after = physicalQty === "" ? before : Number(physicalQty);
  const delta = after - before;

  const mutation = useMutation({
    mutationFn: async () => {
      await dataClient.entities.InventoryItem.update(item.id, {
        current_stock: after,
        location: location || null,
      });
      await dataClient.entities.InventoryMovement.create({
        inventory_id: item.id,
        movement_type: "count",
        quantity_before: before,
        quantity_after: after,
        quantity_delta: delta,
        location: location || null,
        reason: notes || null,
        created_by: currentUser?.id || null,
        created_by_name: currentUser?.full_name || currentUser?.email || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["inventoryMovements"] });
      toast.success(
        delta === 0 ? "Count confirmed — no change" : `Count saved — ${delta > 0 ? "+" : ""}${delta} ${item.unit || ""}`
      );
      onClose();
    },
    onError: (err) => toast.error((/** @type {any} */ (err))?.message || "Failed to save count"),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={`Count: ${item?.name ?? ""}`}
      size="sm"
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Confirm count"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 py-2">
        {item?.sku && <p className="text-xs text-muted-foreground font-mono">{item.sku}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">System stock</label>
            <div className="h-11 md:h-10 rounded-xl border border-input bg-secondary/40 px-3 flex items-center text-sm text-muted-foreground">
              {before} {item?.unit}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Physical count *</label>
            <Input type="number" value={physicalQty} onChange={e => setPhysicalQty(e.target.value)}
              autoFocus className="h-11 md:h-10" />
          </div>
        </div>
        {delta !== 0 && (
          <p className={`text-xs font-semibold ${delta > 0 ? "text-emerald-600" : "text-red-600"}`}>
            {delta > 0 ? "+" : ""}{delta} {item?.unit} difference from system stock
          </p>
        )}
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Location / bin</label>
          <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Shelf A3" className="h-11 md:h-10" />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Reason for the difference, if any…"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none h-16" />
        </div>
      </div>
    </ResponsiveModal>
  );
}

function MovementHistoryModal({ open, onClose, item, movements }) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={`History: ${item?.name ?? ""}`}
      size="sm"
      footer={<div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>}
    >
      <div className="py-2">
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No recorded movements yet for this item.</p>
        ) : (
          <div className="space-y-3">
            {movements.map((/** @type {any} */ m) => (
              <div key={m.id} className="border-b border-border last:border-0 pb-3 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {MOVEMENT_TYPE_LABEL[m.movement_type] || m.movement_type}
                  </span>
                  <span className={`text-sm font-semibold ${m.quantity_delta > 0 ? "text-emerald-600" : m.quantity_delta < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                    {m.quantity_delta > 0 ? "+" : ""}{m.quantity_delta}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {m.quantity_before} → {m.quantity_after}
                  {m.location && ` · ${m.location}`}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {m.created_by_name || "Unknown"} · {m.created_at ? new Date(m.created_at).toLocaleString() : ""}
                </p>
                {m.reason && <p className="text-xs text-foreground mt-1">{m.reason}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </ResponsiveModal>
  );
}

const NEW_OPTION = "__new__";

function MapIdentityModal({ open, onClose, item, suppliers, internalProducts, internalVariants, supplierProducts, supplierVariants }) {
  const qc = useQueryClient();

  const [productId, setProductId] = useState(NEW_OPTION);
  const [newProductCode, setNewProductCode] = useState("");
  const [newProductName, setNewProductName] = useState("");

  const [variantId, setVariantId] = useState(NEW_OPTION);
  const [newColour, setNewColour] = useState("");
  const [newSize, setNewSize] = useState("");

  const [supplierId, setSupplierId] = useState(item?.preferred_supplier_id || "");
  const [supplierProductId, setSupplierProductId] = useState(NEW_OPTION);
  const [newSupplierProductName, setNewSupplierProductName] = useState(item?.name || "");
  const [newSupplierProductCode, setNewSupplierProductCode] = useState("");

  const [supplierVariantId, setSupplierVariantId] = useState(NEW_OPTION);
  const [newSupplierSku, setNewSupplierSku] = useState(item?.sku || "");
  const [newSupplierColour, setNewSupplierColour] = useState("");
  const [newSupplierSize, setNewSupplierSize] = useState("");
  const [newUnitCost, setNewUnitCost] = useState(item?.cost_price ?? "");

  const [notes, setNotes] = useState("");

  const productsForTenant = (/** @type {any[]} */ (internalProducts));
  const variantsForProduct = (/** @type {any[]} */ (internalVariants)).filter(v => v.inventory_product_id === productId);
  const supplierProductsForCombo = (/** @type {any[]} */ (supplierProducts)).filter(
    sp => sp.supplier_id === supplierId && sp.inventory_product_id === productId
  );
  const supplierVariantsForProduct = (/** @type {any[]} */ (supplierVariants)).filter(
    sv => sv.inventory_supplier_product_id === supplierProductId
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const tenantId = await getCurrentTenantId();

      let finalProductId = productId;
      if (productId === NEW_OPTION) {
        if (!newProductCode.trim() || !newProductName.trim()) throw new Error("Internal product code and name are required");
        const created = await dataClient.entities.InventoryProduct.create({
          internal_code: newProductCode.trim(),
          internal_name: newProductName.trim(),
        });
        finalProductId = created.id;
      }

      let finalVariantId = variantId;
      if (variantId === NEW_OPTION) {
        if (!newColour.trim() || !newSize.trim()) throw new Error("Internal colour and size are required");
        const created = await dataClient.entities.InventoryVariant.create({
          inventory_product_id: finalProductId,
          colour_name: newColour.trim(),
          size_name: newSize.trim(),
          internal_sku: `${newProductCode.trim() || "SKU"}-${newColour.trim()}-${newSize.trim()}`.toUpperCase().replace(/\s+/g, "-"),
        });
        finalVariantId = created.id;
      }

      if (!supplierId) throw new Error("Choose a supplier");
      let finalSupplierProductId = supplierProductId;
      if (supplierProductId === NEW_OPTION) {
        if (!newSupplierProductName.trim()) throw new Error("Supplier product name is required");
        const created = await dataClient.entities.InventorySupplierProduct.create({
          inventory_product_id: finalProductId,
          supplier_id: supplierId,
          official_product_name: newSupplierProductName.trim(),
          official_product_code: newSupplierProductCode.trim() || null,
        });
        finalSupplierProductId = created.id;
      }

      let finalSupplierVariantId = supplierVariantId;
      if (supplierVariantId === NEW_OPTION) {
        if (!newSupplierSku.trim() || !newSupplierColour.trim() || !newSupplierSize.trim()) {
          throw new Error("Supplier SKU, colour, and size are required");
        }
        const created = await dataClient.entities.InventorySupplierVariant.create({
          inventory_supplier_product_id: finalSupplierProductId,
          inventory_variant_id: finalVariantId,
          supplier_sku: newSupplierSku.trim(),
          official_colour_name: newSupplierColour.trim(),
          official_size_name: newSupplierSize.trim(),
          unit_cost: newUnitCost !== "" ? Number(newUnitCost) : undefined,
        });
        finalSupplierVariantId = created.id;
      }

      const { data, error } = await supabase.rpc("inventory_reviewer_map_legacy_item", {
        p_tenant_id: tenantId,
        p_legacy_inventory_id: item.id,
        p_inventory_product_id: finalProductId,
        p_inventory_variant_id: finalVariantId,
        p_inventory_supplier_product_id: finalSupplierProductId,
        p_inventory_supplier_variant_id: finalSupplierVariantId,
        p_review_notes: notes || null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventoryProducts"] });
      qc.invalidateQueries({ queryKey: ["inventoryVariants"] });
      qc.invalidateQueries({ queryKey: ["inventorySupplierProducts"] });
      qc.invalidateQueries({ queryKey: ["inventorySupplierVariants"] });
      qc.invalidateQueries({ queryKey: ["inventoryLegacyCompat"] });
      toast.success("Identity mapped");
      onClose();
    },
    onError: (err) => toast.error((/** @type {any} */ (err))?.message || "Failed to map identity"),
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={`Map identity: ${item?.name ?? ""}`}
      size="md"
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Confirm mapping"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 py-2">
        <div className="text-xs text-muted-foreground bg-secondary/40 rounded-xl p-3">
          Source: <span className="font-medium text-foreground">{item?.name}</span>
          {item?.sku && <> · SKU {item.sku}</>}
          {" "}— this stays visible forever for traceability. Mapping only adds an internal + supplier identity; it does not change stock.
        </div>

        {/* Internal product */}
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Internal product (Joint X identity)</label>
          <select value={productId} onChange={e => { setProductId(e.target.value); setVariantId(NEW_OPTION); }}
            className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
            <option value={NEW_OPTION}>+ Create new internal product</option>
            {productsForTenant.map(p => <option key={p.id} value={p.id}>{p.internal_code} — {p.internal_name}</option>)}
          </select>
          {productId === NEW_OPTION && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Input value={newProductCode} onChange={e => setNewProductCode(e.target.value)} placeholder="Code, e.g. JET" className="h-10" />
              <Input value={newProductName} onChange={e => setNewProductName(e.target.value)} placeholder="Name, e.g. Joint X Essential Tee" className="h-10" />
            </div>
          )}
        </div>

        {/* Internal variant */}
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Internal colour / size</label>
          <select value={variantId} onChange={e => setVariantId(e.target.value)}
            className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
            <option value={NEW_OPTION}>+ Create new variant</option>
            {productId !== NEW_OPTION && variantsForProduct.map(v => <option key={v.id} value={v.id}>{v.colour_name} / {v.size_name}</option>)}
          </select>
          {variantId === NEW_OPTION && (
            <>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input value={newColour} onChange={e => setNewColour(e.target.value)} placeholder="One exact colour, e.g. Black" className="h-10" />
                <Input value={newSize} onChange={e => setNewSize(e.target.value)} placeholder="One exact size, e.g. XL" className="h-10" />
              </div>
              <button type="button" onClick={() => { setNewColour("Standard"); setNewSize("Standard"); }}
                className="text-xs text-primary mt-1.5 hover:underline">
                Not a garment? Use "Standard" for colour and size
              </button>
              {(newColour.includes(",") || newSize.includes(",")) && (
                <p className="text-xs text-amber-600 mt-1.5">
                  This looks like more than one colour/size. Each combination needs its own mapping — this field should be one exact value, not a list.
                </p>
              )}
            </>
          )}
        </div>

        <div className="h-px bg-border" />

        {/* Supplier */}
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Supplier</label>
          <select value={supplierId} onChange={e => { setSupplierId(e.target.value); setSupplierProductId(NEW_OPTION); }}
            className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
            <option value="">— Choose supplier —</option>
            {(/** @type {any[]} */ (suppliers)).map((/** @type {any} */ s) => <option key={s.id} value={s.id}>{s.name ?? s.vendor}</option>)}
          </select>
        </div>

        {/* Supplier product */}
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Exact supplier product</label>
          <select value={supplierProductId} onChange={e => setSupplierProductId(e.target.value)} disabled={!supplierId}
            className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-50">
            <option value={NEW_OPTION}>+ Create new supplier product</option>
            {supplierProductsForCombo.map(sp => <option key={sp.id} value={sp.id}>{sp.official_product_name}</option>)}
          </select>
          {supplierProductId === NEW_OPTION && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Input value={newSupplierProductName} onChange={e => setNewSupplierProductName(e.target.value)} placeholder="Supplier's product name" className="h-10" />
              <Input value={newSupplierProductCode} onChange={e => setNewSupplierProductCode(e.target.value)} placeholder="Supplier product code" className="h-10" />
            </div>
          )}
        </div>

        {/* Supplier variant */}
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Exact supplier colour / size / SKU</label>
          <select value={supplierVariantId} onChange={e => setSupplierVariantId(e.target.value)}
            className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
            <option value={NEW_OPTION}>+ Create new supplier variant</option>
            {supplierProductId !== NEW_OPTION && supplierVariantsForProduct.map(sv => (
              <option key={sv.id} value={sv.id}>{sv.official_colour_name} / {sv.official_size_name} — {sv.supplier_sku}</option>
            ))}
          </select>
          {supplierVariantId === NEW_OPTION && (
            <>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Input value={newSupplierSku} onChange={e => setNewSupplierSku(e.target.value)} placeholder="Supplier SKU" className="h-10" />
                <Input value={newUnitCost} onChange={e => setNewUnitCost(e.target.value)} type="number" placeholder="Unit cost (R)" className="h-10" />
                <Input value={newSupplierColour} onChange={e => setNewSupplierColour(e.target.value)} placeholder="One exact supplier colour" className="h-10" />
                <Input value={newSupplierSize} onChange={e => setNewSupplierSize(e.target.value)} placeholder="One exact supplier size" className="h-10" />
              </div>
              <button type="button" onClick={() => { setNewSupplierColour("Standard"); setNewSupplierSize("Standard"); }}
                className="text-xs text-primary mt-1.5 hover:underline">
                Not a garment? Use "Standard" for colour and size
              </button>
              {(newSupplierColour.includes(",") || newSupplierSize.includes(",")) && (
                <p className="text-xs text-amber-600 mt-1.5">
                  This looks like more than one colour/size. Each combination needs its own mapping — this field should be one exact value, not a list.
                </p>
              )}
            </>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Why this mapping, any substitution caveats…"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none h-16" />
        </div>
      </div>
    </ResponsiveModal>
  );
}

function StockRow({ item, supplierMap, countedToday, mapped, onCount, onHistory, onMap, onEdit, onArchive }) {
  const i = /** @type {any} */ (item);
  const isLow = i.reorder_point != null && i.current_stock <= i.reorder_point;
  const supplierName = i.preferred_supplier_id ? supplierMap[i.preferred_supplier_id] : null;
  const cost = Number(i.cost_price) || 0;
  const selling = Number(i.selling_price) || 0;
  const margin = selling > 0 ? Math.round(((selling - cost) / selling) * 100) : null;

  return (
    <div className={`border-b border-border last:border-0 hover:bg-secondary/30 transition-all ${isLow ? "bg-red-50/30" : ""}`}>
      {/* Mobile */}
      <div className="md:hidden px-5 py-4 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{i.name}</p>
          {i.sku && <p className="text-xs text-muted-foreground">SKU: {i.sku}</p>}
          {supplierName && <p className="text-xs text-primary mt-0.5">{supplierName}</p>}
          <p className={`text-xs mt-1 font-semibold ${isLow ? "text-red-600" : "text-foreground"}`}>
            {i.current_stock ?? 0} {i.unit}
            {isLow && " — Low stock"}
          </p>
          {(cost > 0 || selling > 0) && (
            <p className="text-xs text-muted-foreground mt-1">
              Cost R{cost.toFixed(2)} / Sell R{selling.toFixed(2)}
              {margin !== null && ` / ${margin}% margin`}
            </p>
          )}
          {countedToday && <p className="text-xs text-emerald-600 font-medium mt-1">✓ Counted today</p>}
        </div>
        <div className="flex items-center gap-2.5 mt-0.5">
          <button onClick={() => onCount(i)} title="Count stock" className="text-muted-foreground hover:text-primary">
            <ClipboardCheck className="w-4 h-4" />
          </button>
          <button onClick={() => onHistory(i)} title="Movement history" className="text-muted-foreground hover:text-foreground">
            <History className="w-4 h-4" />
          </button>
          <button onClick={() => onMap(i)} title="Map identity" className={mapped ? "text-emerald-600" : "text-muted-foreground hover:text-primary"}>
            <Tag className="w-4 h-4" />
          </button>
          <button onClick={() => onEdit(i)} className="text-muted-foreground hover:text-foreground">
            <Pencil className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden md:grid grid-cols-12 items-center px-5 py-4 gap-2">
        <div className="col-span-3">
          <p className="text-sm font-medium text-foreground">{i.name}</p>
          {i.sku && <p className="text-xs text-muted-foreground font-mono">{i.sku}</p>}
        </div>
        <div className="col-span-2 text-center">
          <span className={`text-sm font-bold ${isLow ? "text-red-600" : "text-foreground"}`}>
            {i.current_stock ?? 0} {i.unit}
          </span>
        </div>
        <div className="col-span-2 text-center text-xs text-muted-foreground">
          {(cost > 0 || selling > 0) ? `R${cost.toFixed(0)} / R${selling.toFixed(0)}${margin !== null ? ` · ${margin}%` : ""}` : "—"}
        </div>
        <div className="col-span-2">
          {supplierName ? (
            <span className="text-xs text-primary font-medium truncate block">{supplierName}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
        <div className="col-span-2 flex justify-center">
          {isLow ? (
            <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Low Stock</Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-green-600 border-green-200 bg-green-50">OK</Badge>
          )}
        </div>
        <div className="col-span-1 flex items-center gap-1.5 justify-end">
          <button onClick={() => onCount(i)} title="Count stock"
            className={`transition-all ${countedToday ? "text-emerald-600" : "text-muted-foreground hover:text-primary"}`}>
            <ClipboardCheck className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onHistory(i)} title="Movement history" className="text-muted-foreground hover:text-foreground transition-all">
            <History className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onMap(i)} title="Map identity"
            className={`transition-all ${mapped ? "text-emerald-600" : "text-muted-foreground hover:text-primary"}`}>
            <Tag className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onEdit(i)} className="text-muted-foreground hover:text-foreground transition-all">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onArchive(i)} className="text-muted-foreground hover:text-foreground transition-all">
            <Archive className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductImage({ urls, url, name }) {
  const candidates = Array.isArray(urls) && urls.length > 0 ? urls : [url].filter(Boolean);
  const [index, setIndex] = useState(0);
  const currentUrl = candidates[index];
  if (!currentUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-secondary">
        <Package className="w-8 h-8 text-muted-foreground/30" />
      </div>
    );
  }
  return <img src={currentUrl} alt={name} className="w-full h-full object-cover" onError={() => setIndex(i => i + 1)} />;
}

function getStoreStatus(product) {
  if (product.is_archived) return { label: "Archived", className: "bg-slate-100 text-slate-500" };
  if (product.status === "draft") return { label: "Draft", className: "bg-yellow-100 text-yellow-700" };
  if (product.store_visible === false) return { label: "Hidden", className: "bg-slate-100 text-slate-600" };
  return { label: "Live", className: "bg-emerald-100 text-emerald-700" };
}

function CatalogGrid({ products, onAddToStock, addingId, onEdit, onDelete }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {(/** @type {any[]} */ (products)).map((/** @type {any} */ p) => (
        <div key={p.id} className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-apple-sm transition-all group">
          <div className="aspect-square overflow-hidden relative">
            <ProductImage urls={getProductImageUrls(p)} name={p.name} />
            <span className={`absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${getStoreStatus(p).className}`}>{getStoreStatus(p).label}</span>
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => onEdit(p)}
                className="w-6 h-6 rounded-lg bg-background/90 backdrop-blur flex items-center justify-center shadow-sm hover:bg-background transition-all">
                <Pencil className="w-3 h-3 text-foreground" />
              </button>
              <button onClick={() => { if (window.confirm(`Delete "${p.name}"?`)) onDelete(p.id); }}
                className="w-6 h-6 rounded-lg bg-background/90 backdrop-blur flex items-center justify-center shadow-sm hover:bg-red-50 transition-all">
                <Trash2 className="w-3 h-3 text-red-500" />
              </button>
            </div>
          </div>
          <div className="p-3">
            <p className="text-xs font-semibold text-foreground leading-tight truncate">{p.name}</p>
            {p.category && (
              <p className="text-[10px] text-muted-foreground mt-0.5 capitalize">{p.category.replace(/_/g, " ")}</p>
            )}
            {p.price > 0 && (
              <p className="text-xs font-bold text-primary mt-1">R{Number(p.price).toLocaleString()}</p>
            )}
            {(p.addons?.length > 0 || p.print_options?.length > 0) && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {p.addons?.length || 0} add-ons / {p.print_options?.length || 0} print opts
              </p>
            )}
            <button
              onClick={() => onAddToStock(p)}
              disabled={addingId === p.id}
              className="mt-2 w-full text-[10px] py-1.5 rounded-lg bg-primary/10 text-primary font-semibold hover:bg-primary hover:text-primary-foreground transition-all disabled:opacity-50"
            >
              {addingId === p.id ? "Adding…" : "+ Add to Stock"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function CatalogList({ products, onAddToStock, addingId, onEdit, onDelete }) {
  return (
    <div className="bg-card rounded-2xl border border-border shadow-apple-sm overflow-hidden">
      {(/** @type {any[]} */ (products)).map((/** @type {any} */ p, i) => (
        <div key={p.id} className={`flex items-center gap-4 px-4 py-3 hover:bg-secondary/30 transition-all ${i > 0 ? "border-t border-border" : ""}`}>
          <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 border border-border">
            <ProductImage urls={getProductImageUrls(p)} name={p.name} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
            <p className="text-xs text-muted-foreground capitalize">{p.category?.replace(/_/g, " ") || "—"}</p>
          </div>
          {p.price > 0 && (
            <p className="text-sm font-bold text-primary flex-shrink-0">R{Number(p.price).toLocaleString()}</p>
          )}
          <button
            onClick={() => onAddToStock(p)}
            disabled={addingId === p.id}
            className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-semibold hover:bg-primary hover:text-primary-foreground transition-all disabled:opacity-50"
          >
            {addingId === p.id ? "…" : "+ Stock"}
          </button>
          <button onClick={() => onEdit(p)} className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-all">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { if (window.confirm(`Delete "${p.name}"?`)) onDelete(p.id); }}
            className="flex-shrink-0 text-muted-foreground hover:text-red-500 transition-all">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// Static XLab shop product list — same items as ClientCatalog.jsx
const XLAB_SHOP_PRODUCTS = [
  { name: "JV1 T-Shirt",     category: "tshirts",  price: 95,  description: "180gsm · 100% Cotton",           image_url: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400" },
  { name: "JET T-Shirt",     category: "tshirts",  price: 155, description: "220gsm · 100% Combed Cotton",    image_url: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400" },
  { name: "JHG T-Shirt",     category: "tshirts",  price: 229, description: "300gsm · 100% Carded Cotton",    image_url: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400" },
  { name: "Hoodie 260gsm",   category: "hoodies",  price: 240, description: "260gsm · Cotton Blend",          image_url: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400" },
  { name: "Hoodie 360gsm",   category: "hoodies",  price: 320, description: "360gsm · Brushed Fleece",        image_url: "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=400" },
  { name: "Hoodie 430gsm",   category: "hoodies",  price: 400, description: "430gsm · 100% Cotton Fleece",    image_url: "https://images.unsplash.com/photo-1578768079052-aa76e52ff62e?w=400" },
  { name: "Sweater 260gsm",  category: "sweaters", price: 220, description: "260gsm · Cotton Blend",          image_url: "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=400" },
  { name: "Sweater 360gsm",  category: "sweaters", price: 300, description: "360gsm · Brushed Fleece",        image_url: "https://images.unsplash.com/photo-1578587018452-892bacefd3f2?w=400" },
  { name: "Sweater 430gsm",  category: "sweaters", price: 380, description: "430gsm · 100% Cotton Fleece",    image_url: "https://images.unsplash.com/photo-1572495532056-8583af1cbae0?w=400" },
  { name: "5-Panel Cap",     category: "hats",     price: 75,  description: "Cotton Twill",                   image_url: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=400" },
  { name: "Bucket Hat",      category: "hats",     price: 120, description: "Poly-Cotton",                    image_url: "https://images.unsplash.com/photo-1572460556623-78f47de5d81c?w=400" },
  { name: "Trucker Cap",     category: "hats",     price: 75,  description: "Cotton/Mesh",                    image_url: "https://images.unsplash.com/photo-1534215754734-18e55d13e346?w=400" },
  { name: "Trackpants",      category: "bottoms",  price: 260, description: "280g Brushed Fleece",            image_url: "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=400" },
  { name: "Shorts",          category: "bottoms",  price: 180, description: "Cotton Jersey",                  image_url: "https://images.unsplash.com/photo-1591195853828-11db59a44f6b?w=400" },
];

export default function Inventory() {
  const [tab, setTab] = useState("stock");
  const [search, setSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogCategory, setCatalogCategory] = useState("all");
  const [catalogView, setCatalogView] = useState("grid");
  const [editItem, setEditItem] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [showAddCatalog, setShowAddCatalog] = useState(false);
  const [editCatalogItem, setEditCatalogItem] = useState(/** @type {any} */ (null));
  const [countItem, setCountItem] = useState(/** @type {any} */ (null));
  const [historyItem, setHistoryItem] = useState(/** @type {any} */ (null));
  const [mapItem, setMapItem] = useState(/** @type {any} */ (null));
  const [stockView, setStockView] = useState("list");
  const queryClient = useQueryClient();

  const { data: inventory = [], isLoading } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => dataClient.entities.InventoryItem.list("name", 200),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => dataClient.entities.Supplier.list("name", 100),
    staleTime: 300_000,
  });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser", "inventory"],
    queryFn: () => dataClient.auth.me(),
    staleTime: 300_000,
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["inventoryMovements"],
    queryFn: () => dataClient.entities.InventoryMovement.list("created_date", 500),
  });

  const { data: internalProducts = [] } = useQuery({
    queryKey: ["inventoryProducts"],
    queryFn: () => dataClient.entities.InventoryProduct.list("internal_name", 200),
  });
  const { data: internalVariants = [] } = useQuery({
    queryKey: ["inventoryVariants"],
    queryFn: () => dataClient.entities.InventoryVariant.list("internal_sku", 500),
  });
  const { data: supplierIdentityProducts = [] } = useQuery({
    queryKey: ["inventorySupplierProducts"],
    queryFn: () => dataClient.entities.InventorySupplierProduct.list("official_product_name", 500),
  });
  const { data: supplierIdentityVariants = [] } = useQuery({
    queryKey: ["inventorySupplierVariants"],
    queryFn: () => dataClient.entities.InventorySupplierVariant.list("supplier_sku", 1000),
  });
  const { data: legacyCompat = [] } = useQuery({
    queryKey: ["inventoryLegacyCompat"],
    queryFn: () => dataClient.entities.InventoryLegacyCompat.list("name", 300),
  });

  const { data: catalogItems = [], isLoading: catalogLoading, refetch: refetchCatalog } = useQuery({
    queryKey: ["catalogItems"],
    queryFn: () => dataClient.entities.CatalogItem.list("name", 500),
    staleTime: 120_000,
  });

  const archiveMutation = useMutation({
    mutationFn: (/** @type {string} */ id) => dataClient.entities.InventoryItem.update(id, {
      is_archived: true, archived_at: new Date().toISOString(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Item archived");
    },
  });

  const addToStockMutation = useMutation({
    mutationFn: (/** @type {any} */ product) => dataClient.entities.InventoryItem.create({
      name: product.name,
      sku: product.slug ?? product.sku ?? null,
      category: getInventoryCategory(product.category),
      unit: "pieces",
      current_stock: 0,
      selling_price: product.price ?? null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Added to stock inventory");
      setAddingId(null);
    },
    onError: (err) => {
      toast.error((/** @type {any} */ (err))?.message || "Failed to add to inventory");
      setAddingId(null);
    },
  });

  const deleteCatalogMutation = useMutation({
    mutationFn: (/** @type {string} */ id) => dataClient.entities.CatalogItem.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalogItems"] });
      toast.success("Product removed from catalog");
    },
    onError: (err) => toast.error((/** @type {any} */ (err))?.message || "Failed to delete"),
  });

  const [importing, setImporting] = useState(false);
  const importShopProducts = async () => {
    setImporting(true);
    try {
      const existingNames = new Set(
        (/** @type {any[]} */ (catalogItems)).map((/** @type {any} */ c) => c.name?.toLowerCase())
      );
      const toImport = XLAB_SHOP_PRODUCTS.filter(p => !existingNames.has(p.name.toLowerCase()));
      if (toImport.length === 0) {
        toast("All shop products are already in catalog");
        setImporting(false);
        return;
      }
      let added = 0;
      for (const p of toImport) {
        try {
          await dataClient.entities.CatalogItem.create({ ...p, status: "active" });
          added++;
        } catch (err) {
          console.error(`Failed to import ${p.name}:`, err);
        }
      }
      // Force refresh catalog items after import completes
      await refetchCatalog();
      if (added > 0) {
        toast.success(`${added} shop product${added !== 1 ? "s" : ""} imported successfully`);
      } else {
        toast.error("No products were imported. Check console for errors.");
      }
    } catch (err) {
      toast.error("Import failed: " + ((/** @type {any} */ err)?.message || "Unknown error"));
      console.error("Import error:", err);
    } finally {
      setImporting(false);
    }
  };

  const handleAddToStock = (/** @type {any} */ product) => {
    const exists = inventory.find(i =>
      !i.is_archived && (i.name?.toLowerCase() === product.name?.toLowerCase())
    );
    if (exists) {
      toast("Already in stock inventory", { description: exists.name });
      return;
    }
    setAddingId(product.id);
    addToStockMutation.mutate(product);
  };

  const supplierMap = Object.fromEntries((/** @type {any[]} */ (suppliers)).map((/** @type {any} */ s) => [s.id, s.name ?? s.vendor]));

  const filteredStock = inventory.filter(i =>
    !i.is_archived &&
    (!search || (/** @type {any} */ (i)).name?.toLowerCase().includes(search.toLowerCase()) || (/** @type {any} */ (i)).sku?.toLowerCase().includes(search.toLowerCase()))
  );

  const visibleCatalogItems = dedupeProducts((/** @type {any[]} */ (catalogItems)).filter((/** @type {any} */ p) => !p.is_archived));

  const filteredCatalog = visibleCatalogItems.filter((/** @type {any} */ p) => {
    if (p.is_archived) return false;
    if (catalogCategory !== "all" && p.category !== catalogCategory) return false;
    if (catalogSearch) {
      const q = catalogSearch.toLowerCase();
      return p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q);
    }
    return true;
  });

  const lowStock = inventory.filter(i => !i.is_archived && i.reorder_point != null && i.current_stock <= i.reorder_point);

  const inStockNames = new Set(inventory.filter(i => !i.is_archived).map(i => (/** @type {any} */ (i)).name?.toLowerCase()));

  const movementsByItem = {};
  for (const m of (/** @type {any[]} */ (movements))) {
    (movementsByItem[m.inventory_id] ??= []).push(m);
  }
  const todayStr = new Date().toDateString();
  const countedTodayIds = new Set(
    (/** @type {any[]} */ (movements))
      .filter(m => m.movement_type === "count" && m.created_at && new Date(m.created_at).toDateString() === todayStr)
      .map(m => m.inventory_id)
  );

  const compatById = Object.fromEntries((/** @type {any[]} */ (legacyCompat)).map(c => [c.id, c]));

  const stockGroups = (() => {
    const groups = new Map();
    for (const item of filteredStock) {
      const compat = compatById[item.id];
      const mapped = compat && compat.mapping_state === "approved";
      const key = mapped ? compat.internal_code : "__unmapped__";
      const label = mapped ? `${compat.internal_code} — ${compat.internal_name}` : "Needs mapping";
      if (!groups.has(key)) groups.set(key, { key, label, mapped, items: [] });
      groups.get(key).items.push(item);
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (a.key === "__unmapped__") return -1;
      if (b.key === "__unmapped__") return 1;
      return a.label.localeCompare(b.label);
    });
  })();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Inventory</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {tab === "stock" ? `${filteredStock.length} items tracked` : `${filteredCatalog.length} products`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {tab === "catalog" && (
              <>
                <button
                  onClick={() => refetchCatalog()}
                  className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-all"
                  title="Refresh catalog"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <Button
                  variant="outline"
                  onClick={importShopProducts}
                  disabled={importing}
                  className="gap-2 shadow-apple-sm text-sm"
                  title="Import all XLab shop products into catalog (skips duplicates)"
                >
                  <Download className="w-4 h-4" />
                  {importing ? "Importing…" : "Import Shop"}
                </Button>
                <Button onClick={() => setShowAddCatalog(true)} className="gap-2 shadow-apple-sm">
                  <Plus className="w-4 h-4" /> Add Product
                </Button>
              </>
            )}
            {tab === "stock" && (
              <Button onClick={() => setShowAdd(true)} className="gap-2 shadow-apple-sm">
                <Plus className="w-4 h-4" /> Add Item
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-secondary rounded-xl p-1 mb-6 w-fit">
          {[
            { key: "stock", label: "Stock" },
            { key: "catalog", label: "Shop Catalog" },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tab === t.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── STOCK TAB ── */}
        {tab === "stock" && (
          <>
            {lowStock.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-5 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">{lowStock.length} item{lowStock.length > 1 ? "s" : ""} running low</p>
                  <p className="text-xs text-red-600 mt-0.5">{(/** @type {any[]} */ (lowStock)).map(i => i.name).join(", ")}</p>
                </div>
              </div>
            )}

            <div className="flex gap-2 mb-5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search inventory..." value={search} onChange={e => setSearch(e.target.value)}
                  className="pl-9 bg-card rounded-xl h-10" />
              </div>
              <div className="flex bg-secondary rounded-xl p-0.5">
                <button onClick={() => setStockView("list")} title="List view"
                  className={`p-2 rounded-lg transition-all ${stockView === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}>
                  <LayoutList className="w-4 h-4" />
                </button>
                <button onClick={() => setStockView("grouped")} title="Grouped by internal identity"
                  className={`p-2 rounded-lg transition-all ${stockView === "grouped" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}>
                  <Rows3 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-card rounded-2xl animate-pulse" />)}</div>
            ) : filteredStock.length === 0 ? (
              <div className="bg-card rounded-2xl border border-border shadow-apple-sm text-center py-12">
                <Boxes className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No inventory items</p>
              </div>
            ) : stockView === "list" ? (
              <div className="bg-card rounded-2xl border border-border shadow-apple-sm overflow-hidden">
                <div className="hidden md:grid grid-cols-12 text-xs font-semibold text-muted-foreground uppercase tracking-wide px-5 py-3 border-b border-border bg-secondary/30">
                  <span className="col-span-3">Item</span>
                  <span className="col-span-2 text-center">Stock</span>
                  <span className="col-span-2 text-center">Pricing</span>
                  <span className="col-span-2">Supplier</span>
                  <span className="col-span-2 text-center">Status</span>
                  <span className="col-span-1" />
                </div>
                {filteredStock.map(item => (
                  <StockRow key={item.id} item={item} supplierMap={supplierMap}
                    countedToday={countedTodayIds.has(item.id)}
                    mapped={compatById[item.id]?.mapping_state === "approved"}
                    onCount={setCountItem} onHistory={setHistoryItem} onMap={setMapItem} onEdit={setEditItem}
                    onArchive={(i) => { if (confirm(`Archive ${i.name}?`)) archiveMutation.mutate(i.id); }} />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {stockGroups.map(group => (
                  <div key={group.key} className="bg-card rounded-2xl border border-border shadow-apple-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-secondary/30">
                      {!group.mapped && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                      <span className="text-sm font-semibold text-foreground">{group.label}</span>
                      <span className="text-xs text-muted-foreground">({group.items.length})</span>
                    </div>
                    {group.items.map(item => (
                      <StockRow key={item.id} item={item} supplierMap={supplierMap}
                        countedToday={countedTodayIds.has(item.id)}
                        mapped={compatById[item.id]?.mapping_state === "approved"}
                        onCount={setCountItem} onHistory={setHistoryItem} onMap={setMapItem} onEdit={setEditItem}
                        onArchive={(i) => { if (confirm(`Archive ${i.name}?`)) archiveMutation.mutate(i.id); }} />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── CATALOG TAB ── */}
        {tab === "catalog" && (
          <>
            {/* Filter bar */}
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search products…" value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)}
                  className="pl-9 bg-card rounded-xl h-9 text-sm" />
              </div>
              <div className="flex bg-secondary rounded-xl p-0.5">
                <button
                  onClick={() => setCatalogView("grid")}
                  className={`p-1.5 rounded-lg transition-all ${catalogView === "grid" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCatalogView("list")}
                  className={`p-1.5 rounded-lg transition-all ${catalogView === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Category pills */}
            <div className="flex gap-1.5 flex-wrap mb-5">
              {CATALOG_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCatalogCategory(cat)}
                  className={`px-3 py-1 rounded-xl text-xs font-medium transition-all capitalize ${
                    catalogCategory === cat
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-card border border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {cat === "all" ? "All" : cat.replace(/_/g, " ")}
                </button>
              ))}
            </div>

            {catalogLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {[1,2,3,4,5,6,7,8].map(i => <div key={i} className="aspect-square bg-card rounded-2xl animate-pulse" />)}
              </div>
            ) : catalogItems.length === 0 ? (
              <div className="text-center py-20 bg-card rounded-2xl border border-border">
                <Package className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                <p className="font-semibold text-foreground mb-1">No catalog products yet</p>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                  Add your shop products here. They'll be available to quickly add to stock inventory when needed.
                </p>
                <button
                  onClick={() => setShowAddCatalog(true)}
                  className="mt-4 text-sm text-primary font-medium flex items-center gap-1.5 mx-auto hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" /> Add first product
                </button>
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-muted-foreground text-sm">No products match this filter</p>
              </div>
            ) : catalogView === "grid" ? (
              <CatalogGrid
                products={filteredCatalog.map(p => ({
                  ...p,
                  _inStock: inStockNames.has((/** @type {any} */ (p)).name?.toLowerCase()),
                }))}
                onAddToStock={handleAddToStock}
                addingId={addingId}
                onEdit={(p) => setEditCatalogItem(p)}
                onDelete={(id) => deleteCatalogMutation.mutate(id)}
              />
            ) : (
              <CatalogList
                products={filteredCatalog}
                onAddToStock={handleAddToStock}
                addingId={addingId}
                onEdit={(p) => setEditCatalogItem(p)}
                onDelete={(id) => deleteCatalogMutation.mutate(id)}
              />
            )}

            {filteredCatalog.length > 0 && (
              <p className="text-center text-xs text-muted-foreground mt-6">
                {filteredCatalog.length} product{filteredCatalog.length !== 1 ? "s" : ""}
                {catalogCategory !== "all" && ` in ${catalogCategory}`}
              </p>
            )}
          </>
        )}
      </div>

      {showAdd && (
        <ItemFormModal open={showAdd} onClose={() => setShowAdd(false)} suppliers={suppliers} />
      )}
      {editItem && (
        <ItemFormModal open={!!editItem} onClose={() => setEditItem(null)} existing={editItem} suppliers={suppliers} />
      )}
      {showAddCatalog && (
        <CatalogItemFormModal open={showAddCatalog} onClose={() => setShowAddCatalog(false)} />
      )}
      {editCatalogItem && (
        <CatalogItemFormModal open={!!editCatalogItem} onClose={() => setEditCatalogItem(null)} existing={editCatalogItem} />
      )}
      {countItem && (
        <StockCountModal open={!!countItem} onClose={() => setCountItem(null)} item={countItem} currentUser={currentUser} />
      )}
      {historyItem && (
        <MovementHistoryModal open={!!historyItem} onClose={() => setHistoryItem(null)} item={historyItem}
          movements={movementsByItem[historyItem.id] || []} />
      )}
      {mapItem && (
        <MapIdentityModal open={!!mapItem} onClose={() => setMapItem(null)} item={mapItem} suppliers={suppliers}
          internalProducts={internalProducts} internalVariants={internalVariants}
          supplierProducts={supplierIdentityProducts} supplierVariants={supplierIdentityVariants} />
      )}
    </div>
  );
}
