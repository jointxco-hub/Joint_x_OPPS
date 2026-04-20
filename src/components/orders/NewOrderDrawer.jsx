import React, { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function NewOrderDrawer({ onClose, onCreate }) {
  const [form, setForm] = useState({
    client_name: '',
    order_number: `ORD-${Date.now().toString(36).toUpperCase()}`,
    status: 'confirmed',
    notes: '',
    total_amount: '',
    products: [{ name: '', quantity: 1, price: '' }]
  });

  const addProduct = () => setForm(f => ({ ...f, products: [...f.products, { name: '', quantity: 1, price: '' }] }));
  const removeProduct = (i) => setForm(f => ({ ...f, products: f.products.filter((_, idx) => idx !== i) }));
  const updateProduct = (i, field, val) => setForm(f => ({
    ...f,
    products: f.products.map((p, idx) => idx === i ? { ...p, [field]: val } : p)
  }));

  const calcTotal = () => form.products.reduce((s, p) => s + (parseFloat(p.price || 0) * (parseInt(p.quantity) || 1)), 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.client_name.trim()) return;
    const total = form.total_amount ? parseFloat(form.total_amount) : calcTotal();
    onCreate({ ...form, total_amount: total });
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-card shadow-apple-xl z-50 flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold text-foreground">New Order</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Client Name *</label>
            <Input value={form.client_name} onChange={e => setForm({...form, client_name: e.target.value})}
              placeholder="Client name..." className="rounded-xl" required />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Order Number</label>
            <Input value={form.order_number} onChange={e => setForm({...form, order_number: e.target.value})}
              placeholder="Order number..." className="rounded-xl" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Status</label>
            <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['confirmed','in_production','ready','shipped','delivered'].map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Products */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Products</label>
              <button type="button" onClick={addProduct} className="text-xs text-primary font-medium flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            <div className="space-y-2">
              {form.products.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={p.name} onChange={e => updateProduct(i, 'name', e.target.value)}
                    placeholder="Product name" className="rounded-xl flex-1 h-9 text-sm" />
                  <Input value={p.quantity} onChange={e => updateProduct(i, 'quantity', e.target.value)}
                    placeholder="Qty" type="number" className="rounded-xl w-14 h-9 text-sm" />
                  <Input value={p.price} onChange={e => updateProduct(i, 'price', e.target.value)}
                    placeholder="R" type="number" className="rounded-xl w-16 h-9 text-sm" />
                  {form.products.length > 1 && (
                    <button type="button" onClick={() => removeProduct(i)} className="text-muted-foreground hover:text-destructive transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Total Amount {calcTotal() > 0 && <span className="text-primary">(auto: R{calcTotal().toLocaleString()})</span>}
            </label>
            <Input value={form.total_amount} onChange={e => setForm({...form, total_amount: e.target.value})}
              placeholder={`R${calcTotal() || '0'}`} type="number" className="rounded-xl" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Notes</label>
            <Textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
              placeholder="Any special instructions..." className="rounded-xl resize-none h-20" />
          </div>
        </form>
        <div className="p-5 border-t border-border">
          <Button type="submit" onClick={handleSubmit} className="w-full rounded-xl">Create Order</Button>
        </div>
      </div>
    </>
  );
}