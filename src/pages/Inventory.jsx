import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Boxes, AlertTriangle, TrendingDown, Edit2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function Inventory() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState({});
  const queryClient = useQueryClient();

  const { data: inventory = [], isLoading } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => base44.entities.InventoryItem.list('name', 200)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.InventoryItem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setEditingId(null);
      toast.success("Updated");
    }
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.InventoryItem.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setShowForm(false);
      toast.success("Item added");
    }
  });

  const filtered = inventory.filter(i =>
    !search || i.name?.toLowerCase().includes(search.toLowerCase()) || i.sku?.toLowerCase().includes(search.toLowerCase())
  );

  const lowStock = inventory.filter(i => i.reorder_point && i.current_stock <= i.reorder_point);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Inventory</h1>
            <p className="text-muted-foreground text-sm mt-0.5">{inventory.length} items tracked</p>
          </div>
          <Button onClick={() => setShowForm(true)} className="gap-2 shadow-apple-sm">
            <Plus className="w-4 h-4" /> Add Item
          </Button>
        </div>

        {lowStock.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">{lowStock.length} item{lowStock.length > 1 ? 's' : ''} running low</p>
              <p className="text-xs text-red-600 mt-0.5">{lowStock.map(i => i.name).join(', ')}</p>
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
            <div className="grid grid-cols-5 text-xs font-semibold text-muted-foreground uppercase tracking-wide px-5 py-3 border-b border-border bg-secondary/30">
              <span className="col-span-2">Item</span>
              <span className="text-center">Stock</span>
              <span className="text-center">Reorder At</span>
              <span className="text-center">Status</span>
            </div>
            {filtered.length === 0 ? (
              <div className="text-center py-12">
                <Boxes className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No inventory items</p>
              </div>
            ) : filtered.map(item => {
              const isLow = item.reorder_point && item.current_stock <= item.reorder_point;
              const isEditing = editingId === item.id;
              return (
                <div key={item.id} className={`grid grid-cols-5 items-center px-5 py-4 border-b border-border last:border-0 hover:bg-secondary/30 transition-all ${isLow ? 'bg-red-50/30' : ''}`}>
                  <div className="col-span-2">
                    <p className="text-sm font-medium text-foreground">{item.name}</p>
                    {item.sku && <p className="text-xs text-muted-foreground">SKU: {item.sku}</p>}
                  </div>
                  <div className="text-center">
                    {isEditing ? (
                      <div className="flex items-center gap-1 justify-center">
                        <Input type="number" value={editValue.current_stock ?? item.current_stock}
                          onChange={e => setEditValue({...editValue, current_stock: parseInt(e.target.value)})}
                          className="h-7 w-16 text-xs text-center rounded-lg" />
                        <button onClick={() => updateMutation.mutate({ id: item.id, data: editValue })}
                          className="text-green-600 hover:text-green-700"><Check className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setEditingId(null)} className="text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingId(item.id); setEditValue({ current_stock: item.current_stock }); }}
                        className={`text-sm font-bold hover:text-primary transition-all ${isLow ? 'text-red-600' : 'text-foreground'}`}>
                        {item.current_stock ?? 0} {item.unit || ''}
                      </button>
                    )}
                  </div>
                  <div className="text-center">
                    <span className="text-xs text-muted-foreground">{item.reorder_point ?? '—'}</span>
                  </div>
                  <div className="flex justify-center">
                    {isLow ? (
                      <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Low Stock</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-200 bg-green-50">OK</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showForm && <AddItemModal onClose={() => setShowForm(false)} onCreate={(d) => createMutation.mutate(d)} />}
      </div>
    </div>
  );
}

function AddItemModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ name: '', sku: '', current_stock: 0, reorder_point: 10, unit: 'pieces' });
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onCreate(form);
  };
  return (
    <>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-card rounded-2xl shadow-apple-xl border border-border p-6 w-full max-w-sm animate-slide-in-up">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-foreground">Add Inventory Item</h2>
            <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Item name *" className="rounded-xl" required />
            <Input value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} placeholder="SKU (optional)" className="rounded-xl" />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" value={form.current_stock} onChange={e => setForm({...form, current_stock: parseInt(e.target.value)})} placeholder="Current stock" className="rounded-xl" />
              <Input type="number" value={form.reorder_point} onChange={e => setForm({...form, reorder_point: parseInt(e.target.value)})} placeholder="Reorder at" className="rounded-xl" />
            </div>
            <Input value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} placeholder="Unit (pieces, kg, etc.)" className="rounded-xl" />
            <Button type="submit" className="w-full rounded-xl mt-2">Add Item</Button>
          </form>
        </div>
      </div>
    </>
  );
}