import React, { useState, useMemo } from "react";
import { X, Plus, Trash2, Search, ShoppingCart, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { dataClient } from "@/api/dataClient";

export default function NewOrderDrawer({ onClose, onCreate }) {
  const [form, setForm] = useState({
    client_name: '',
    client_email: '',
    client_phone: '',
    order_number: `ORD-${Date.now().toString(36).toUpperCase()}`,
    status: 'confirmed',
    priority: 'normal',
    print_type: 'none',
    notes: '',
    total_amount: '',
    due_date: '',
    linked_po_id: '',
    products: [{ name: '', quantity: 1, price: '' }]
  });

  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => dataClient.entities.Client.list('-created_date', 200)
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => dataClient.entities.Order.list('-created_date', 50)
  });

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['purchaseOrders'],
    queryFn: () => dataClient.entities.PurchaseOrder.list('-created_date', 100)
  });

  const filteredClients = useMemo(() => {
    if (!clientSearch) return clients.slice(0, 6);
    return clients.filter(c =>
      c.name?.toLowerCase().includes(clientSearch.toLowerCase()) ||
      c.email?.toLowerCase().includes(clientSearch.toLowerCase())
    ).slice(0, 6);
  }, [clients, clientSearch]);

  const selectClient = (client) => {
    // pre-fill from client data
    const lastOrder = orders.find(o => o.client_name === client.name || o.client_email === client.email);
    setForm(f => ({
      ...f,
      client_name: client.name,
      client_email: client.email || f.client_email,
      client_phone: client.phone || f.client_phone,
      // pre-fill products from last order if available
      products: lastOrder?.products?.length ? lastOrder.products.map(p => ({ ...p })) : f.products,
      total_amount: '',
    }));
    setClientSearch(client.name);
    setShowClientDropdown(false);
  };

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
    const data = { ...form, total_amount: total };
    if (!data.linked_po_id) delete data.linked_po_id;
    onCreate(data);
  };

  const activePOs = purchaseOrders.filter(po => ['draft','pending','approved','ordered'].includes(po.status));

  return (
    <>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-card shadow-apple-xl z-50 flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold text-foreground">New Order</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Client autocomplete */}
          <div className="relative">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Client *</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={clientSearch || form.client_name}
                onChange={e => {
                  setClientSearch(e.target.value);
                  setForm(f => ({ ...f, client_name: e.target.value }));
                  setShowClientDropdown(true);
                }}
                onFocus={() => setShowClientDropdown(true)}
                placeholder="Search or type client name..."
                className="rounded-xl pl-9"
                required
              />
            </div>
            {showClientDropdown && filteredClients.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-apple-lg z-20 max-h-48 overflow-y-auto">
                {filteredClients.map(c => (
                  <button key={c.id} type="button" onClick={() => selectClient(c)}
                    className="w-full text-left px-3 py-2.5 hover:bg-secondary transition-all flex items-center justify-between first:rounded-t-xl last:rounded-b-xl">
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.name}</p>
                      {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                    </div>
                    {c.status && <span className="text-xs text-muted-foreground capitalize">{c.status}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Client contact pre-fill */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
              <Input value={form.client_email} onChange={e => setForm({...form, client_email: e.target.value})}
                placeholder="client@email.com" className="rounded-xl h-9 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Phone</label>
              <Input value={form.client_phone} onChange={e => setForm({...form, client_phone: e.target.value})}
                placeholder="Phone number" className="rounded-xl h-9 text-sm" />
            </div>
          </div>

          {/* Order details */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Order Number</label>
              <Input value={form.order_number} onChange={e => setForm({...form, order_number: e.target.value})}
                placeholder="ORD-..." className="rounded-xl h-9 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Due Date</label>
              <Input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})}
                className="rounded-xl h-9 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Status</label>
              <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
                <SelectTrigger className="rounded-xl h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['confirmed','in_production','ready','shipped','delivered'].map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Priority</label>
              <Select value={form.priority} onValueChange={v => setForm({...form, priority: v})}>
                <SelectTrigger className="rounded-xl h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['low','normal','high','urgent'].map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Print Type</label>
            <Select value={form.print_type} onValueChange={v => setForm({...form, print_type: v})}>
              <SelectTrigger className="rounded-xl h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[['none','None'],['dtf','DTF'],['vinyl','Vinyl'],['embroidery','Embroidery'],['screen','Screen Print']].map(([v,l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Link to Purchase Order */}
          {activePOs.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block flex items-center gap-1">
                <ShoppingCart className="w-3 h-3" /> Link Purchase Order <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Select value={form.linked_po_id || '__none'} onValueChange={v => setForm({...form, linked_po_id: v === '__none' ? '' : v})}>
                <SelectTrigger className="rounded-xl h-9 text-sm"><SelectValue placeholder="Select a PO..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No PO linked</SelectItem>
                  {activePOs.map(po => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.po_number} — {po.supplier_name} ({po.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
