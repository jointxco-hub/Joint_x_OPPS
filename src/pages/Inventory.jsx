import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Boxes, AlertTriangle, Archive, Pencil, LayoutGrid, List, Package, RefreshCw, Download } from "lucide-react";
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

const EMPTY_CATALOG_FORM = {
  name: "", description: "", category: "tshirts",
  price: "", image_url: "", status: "active",
};

function CatalogItemFormModal({ open, onClose, existing }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(existing ?? EMPTY_CATALOG_FORM);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

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
      status: form.status || "active",
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
        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Status</label>
          <select value={form.status} onChange={set("status")}
            className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
            <option value="active">Active</option>
            <option value="draft">Draft</option>
          </select>
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

function ProductImage({ url, name }) {
  const [err, setErr] = useState(false);
  if (!url || err) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-secondary">
        <Package className="w-8 h-8 text-muted-foreground/30" />
      </div>
    );
  }
  return <img src={url} alt={name} className="w-full h-full object-cover" onError={() => setErr(true)} />;
}

function CatalogGrid({ products, onAddToStock, addingId, onEdit, onDelete }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {(/** @type {any[]} */ (products)).map((/** @type {any} */ p) => (
        <div key={p.id} className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-apple-sm transition-all group">
          <div className="aspect-square overflow-hidden relative">
            <ProductImage url={p.image_url} name={p.name} />
            {p.status === "draft" && (
              <span className="absolute top-2 left-2 text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-medium">Draft</span>
            )}
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
            <ProductImage url={p.image_url} name={p.name} />
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
      category: product.category ?? "other",
      unit: "pieces",
      current_stock: 0,
      selling_price: product.price ?? null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Added to stock inventory");
      setAddingId(null);
    },
    onError: () => {
      toast.error("Failed to add to inventory");
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

  const filteredCatalog = (/** @type {any[]} */ (catalogItems)).filter((/** @type {any} */ p) => {
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

            <div className="relative mb-5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search inventory..." value={search} onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-card rounded-xl h-10" />
            </div>

            {isLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-card rounded-2xl animate-pulse" />)}</div>
            ) : (
              <div className="bg-card rounded-2xl border border-border shadow-apple-sm overflow-hidden">
                <div className="hidden md:grid grid-cols-12 text-xs font-semibold text-muted-foreground uppercase tracking-wide px-5 py-3 border-b border-border bg-secondary/30">
                  <span className="col-span-3">Item</span>
                  <span className="col-span-2 text-center">Stock</span>
                  <span className="col-span-2 text-center">Pricing</span>
                  <span className="col-span-2">Supplier</span>
                  <span className="col-span-2 text-center">Status</span>
                  <span className="col-span-1" />
                </div>
                {filteredStock.length === 0 ? (
                  <div className="text-center py-12">
                    <Boxes className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No inventory items</p>
                  </div>
                ) : filteredStock.map(item => {
                  const i = /** @type {any} */ (item);
                  const isLow = i.reorder_point != null && i.current_stock <= i.reorder_point;
                  const supplierName = i.preferred_supplier_id ? supplierMap[i.preferred_supplier_id] : null;
                  const cost = Number(i.cost_price) || 0;
                  const selling = Number(i.selling_price) || 0;
                  const profit = selling - cost;
                  const margin = selling > 0 ? Math.round((profit / selling) * 100) : null;
                  return (
                    <div key={i.id} className={`border-b border-border last:border-0 hover:bg-secondary/30 transition-all ${isLow ? "bg-red-50/30" : ""}`}>
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
                        </div>
                        <button onClick={() => setEditItem(i)} className="text-muted-foreground hover:text-foreground mt-0.5">
                          <Pencil className="w-4 h-4" />
                        </button>
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
                          <button onClick={() => setEditItem(i)} className="text-muted-foreground hover:text-foreground transition-all">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => { if (confirm(`Archive ${i.name}?`)) archiveMutation.mutate(i.id); }}
                            className="text-muted-foreground hover:text-foreground transition-all">
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
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
    </div>
  );
}
