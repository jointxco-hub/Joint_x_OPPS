import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Boxes, AlertTriangle, Archive, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import ResponsiveModal from "@/components/common/ResponsiveModal";

const CATEGORIES = [
  "tees","hoodies","sweaters","bottoms","headwear","accessories",
  "vinyl","dtf_materials","embroidery_materials","ink","labels","packaging","other",
];
const UNITS = ["pieces","meters","rolls","liters"];

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
              {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
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
          <label className="text-xs font-medium text-foreground block mb-1">Preferred Supplier</label>
          <select value={form.preferred_supplier_id} onChange={set("preferred_supplier_id")}
            className="w-full h-11 md:h-10 rounded-xl border border-input bg-background px-3 text-sm">
            <option value="">— None —</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name ?? s.vendor}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-foreground block mb-1">Location / bin</label>
          <Input value={form.location} onChange={set("location")} placeholder="Shelf A3" className="h-11 md:h-10" />
        </div>
      </form>
    </ResponsiveModal>
  );
}

export default function Inventory() {
  const [search, setSearch] = useState("");
  const [editItem, setEditItem] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
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

  const archiveMutation = useMutation({
    mutationFn: (id) => dataClient.entities.InventoryItem.update(id, {
      is_archived: true, archived_at: new Date().toISOString(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Item archived");
    },
  });

  const supplierMap = Object.fromEntries(suppliers.map(s => [s.id, s.name ?? s.vendor]));

  const filtered = inventory.filter(i =>
    !i.is_archived &&
    (!search || i.name?.toLowerCase().includes(search.toLowerCase()) || i.sku?.toLowerCase().includes(search.toLowerCase()))
  );

  const lowStock = inventory.filter(i => !i.is_archived && i.reorder_point != null && i.current_stock <= i.reorder_point);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Inventory</h1>
            <p className="text-muted-foreground text-sm mt-0.5">{filtered.length} items tracked</p>
          </div>
          <Button onClick={() => setShowAdd(true)} className="gap-2 shadow-apple-sm">
            <Plus className="w-4 h-4" /> Add Item
          </Button>
        </div>

        {lowStock.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">{lowStock.length} item{lowStock.length > 1 ? "s" : ""} running low</p>
              <p className="text-xs text-red-600 mt-0.5">{lowStock.map(i => i.name).join(", ")}</p>
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
              <span className="col-span-2 text-center">Reorder</span>
              <span className="col-span-2">Supplier</span>
              <span className="col-span-2 text-center">Status</span>
              <span className="col-span-1" />
            </div>
            {filtered.length === 0 ? (
              <div className="text-center py-12">
                <Boxes className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No inventory items</p>
              </div>
            ) : filtered.map(item => {
              const isLow = item.reorder_point != null && item.current_stock <= item.reorder_point;
              const supplierName = item.preferred_supplier_id ? supplierMap[item.preferred_supplier_id] : null;
              return (
                <div key={item.id} className={`border-b border-border last:border-0 hover:bg-secondary/30 transition-all ${isLow ? "bg-red-50/30" : ""}`}>
                  {/* Mobile */}
                  <div className="md:hidden px-5 py-4 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{item.name}</p>
                      {item.sku && <p className="text-xs text-muted-foreground">SKU: {item.sku}</p>}
                      {supplierName && <p className="text-xs text-primary mt-0.5">{supplierName}</p>}
                      <p className={`text-xs mt-1 font-semibold ${isLow ? "text-red-600" : "text-foreground"}`}>
                        {item.current_stock ?? 0} {item.unit}
                        {isLow && " — Low stock"}
                      </p>
                    </div>
                    <button onClick={() => setEditItem(item)} className="text-muted-foreground hover:text-foreground mt-0.5">
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Desktop */}
                  <div className="hidden md:grid grid-cols-12 items-center px-5 py-4 gap-2">
                    <div className="col-span-3">
                      <p className="text-sm font-medium text-foreground">{item.name}</p>
                      {item.sku && <p className="text-xs text-muted-foreground font-mono">{item.sku}</p>}
                    </div>
                    <div className="col-span-2 text-center">
                      <span className={`text-sm font-bold ${isLow ? "text-red-600" : "text-foreground"}`}>
                        {item.current_stock ?? 0} {item.unit}
                      </span>
                    </div>
                    <div className="col-span-2 text-center text-xs text-muted-foreground">
                      {item.reorder_point ?? "—"}
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
                      <button onClick={() => setEditItem(item)} className="text-muted-foreground hover:text-foreground transition-all">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { if (confirm(`Archive ${item.name}?`)) archiveMutation.mutate(item.id); }}
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
      </div>

      {showAdd && (
        <ItemFormModal open={showAdd} onClose={() => setShowAdd(false)} suppliers={suppliers} />
      )}
      {editItem && (
        <ItemFormModal open={!!editItem} onClose={() => setEditItem(null)} existing={editItem} suppliers={suppliers} />
      )}
    </div>
  );
}
