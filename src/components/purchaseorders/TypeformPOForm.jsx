import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function TypeformPOForm({
  purchaseOrder,
  suppliers = [],
  inventoryItems = [],
  onSubmit,
  onCancel
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [formData, setFormData] = useState(purchaseOrder ? {
    ...purchaseOrder,
    supplier_ids: purchaseOrder.supplier_ids || (purchaseOrder.supplier_id ? [purchaseOrder.supplier_id] : []),
    total: Number(purchaseOrder.total_amount ?? purchaseOrder.total ?? 0),
    subtotal: Number(purchaseOrder.subtotal ?? purchaseOrder.total_amount ?? purchaseOrder.total ?? 0),
    expected_delivery: purchaseOrder.expected_delivery || purchaseOrder.expected_date || purchaseOrder.due_date || "",
    order_date: purchaseOrder.order_date || purchaseOrder.created_date?.slice?.(0, 10) || new Date().toISOString().split('T')[0],
  } : {
    po_number: `PO-${Date.now().toString(36).toUpperCase()}`,
    supplier_ids: [],
    supplier_name: "",
    status: "draft",
    items: [{ name: "", inventory_item_id: "", is_custom: false, quantity: 1, unit: "pieces", unit_price: 0, total: 0 }],
    subtotal: 0,
    tax: 0,
    total: 0,
    notes: "",
    order_date: new Date().toISOString().split('T')[0],
    expected_delivery: ""
  });

  const handleChange = (field, value) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      if (field === "supplier_ids") {
        const selectedSuppliers = suppliers.filter(s => value.includes(s.id));
        updated.supplier_name = selectedSuppliers.map(s => s.name).join(", ");
        updated.supplier_id = value[0] || "";
      }
      return updated;
    });
  };

  const toggleSupplier = (supplierId) => {
    const current = formData.supplier_ids || [];
    const updated = current.includes(supplierId)
      ? current.filter(id => id !== supplierId)
      : [...current, supplierId];
    handleChange("supplier_ids", updated);
  };

  const handleInventorySelect = (index, inventoryId) => {
    const item = inventoryItems.find(i => i.id === inventoryId);
    if (item) {
      setFormData(prev => {
        const newItems = [...prev.items];
        newItems[index] = {
          ...newItems[index],
          inventory_item_id: inventoryId,
          name: item.name,
          unit: item.unit,
          unit_price: item.cost_price || 0,
          is_custom: false,
          total: (newItems[index].quantity || 0) * (item.cost_price || 0)
        };
        const subtotal = newItems.reduce((sum, i) => sum + (i.total || 0), 0);
        return { ...prev, items: newItems, subtotal, total: subtotal + (prev.tax || 0) };
      });
    }
  };

  const handleItemChange = (index, field, value) => {
    setFormData(prev => {
      const newItems = [...prev.items];
      newItems[index] = { ...newItems[index], [field]: value };
      if (field === "quantity" || field === "unit_price") {
        newItems[index].total = (parseFloat(newItems[index].quantity) || 0) * (parseFloat(newItems[index].unit_price) || 0);
      }
      const subtotal = newItems.reduce((sum, i) => sum + (i.total || 0), 0);
      return { ...prev, items: newItems, subtotal, total: subtotal + (prev.tax || 0) };
    });
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { name: "", inventory_item_id: "", is_custom: false, quantity: 1, unit: "pieces", unit_price: 0, total: 0 }]
    }));
  };

  const removeItem = (index) => {
    if (formData.items.length <= 1) return;
    const newItems = formData.items.filter((_, i) => i !== index);
    const subtotal = newItems.reduce((sum, i) => sum + (i.total || 0), 0);
    setFormData(prev => ({ ...prev, items: newItems, subtotal, total: subtotal + (prev.tax || 0) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaveError("");
    setIsSubmitting(true);
    try {
      const items = (formData.items || []);
      const validItems = items.filter(item => {
        const hasName = item.name?.trim();
        const hasInventoryId = !item.is_custom && item.inventory_item_id;
        const hasQuantity = parseFloat(item.quantity) > 0;
        const hasPrice = parseFloat(item.unit_price) > 0;
        return (hasName || hasInventoryId || hasQuantity || hasPrice) && (hasName || hasInventoryId);
      });

      if (validItems.length < items.length) {
        toast.warning(`${items.length - validItems.length} empty item(s) skipped`);
      }
      
      const processedItems = validItems.map(item => ({
        ...item,
        quantity: parseFloat(item.quantity) || 1,
        unit_price: parseFloat(item.unit_price) || 0,
        total: (parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0),
      }));
      const subtotal = processedItems.reduce((sum, item) => sum + item.total, 0);
      await onSubmit({
        ...formData,
        items: processedItems,
        subtotal,
        total: subtotal + (parseFloat(formData.tax) || 0),
        total_amount: subtotal + (parseFloat(formData.tax) || 0),
        supplier_id: formData.supplier_id || undefined,
        supplier_name: formData.supplier_name?.trim() || undefined,
        order_date: formData.order_date || undefined,
        expected_delivery: formData.expected_delivery || undefined,
        expected_date: formData.expected_delivery || undefined,
      });
    } catch (err) {
      const msg = err?.message || "Unknown error — check Supabase purchase_orders table";
      setSaveError(msg);
      toast.error("PO save failed — see error above");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{purchaseOrder ? 'Edit Purchase Order' : 'New Purchase Order'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pb-2">
          {/* PO Number + Dates */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">PO Number</label>
              <Input value={formData.po_number} onChange={e => handleChange("po_number", e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Order Date</label>
              <Input type="date" value={formData.order_date} onChange={e => handleChange("order_date", e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Expected Delivery</label>
              <Input type="date" value={formData.expected_delivery} onChange={e => handleChange("expected_delivery", e.target.value)} />
            </div>
          </div>

          {/* Suppliers */}
          <div>
            <label className="text-xs font-medium text-slate-600 mb-2 block">Suppliers</label>
            {suppliers.length === 0 ? (
              <p className="text-xs text-slate-400">No suppliers found</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                {suppliers.map(supplier => (
                  <button
                    key={supplier.id}
                    type="button"
                    onClick={() => toggleSupplier(supplier.id)}
                    className={`text-left p-3 rounded-lg border-2 transition-all ${
                      (formData.supplier_ids || []).includes(supplier.id)
                        ? 'border-primary bg-primary/5'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <p className="text-sm font-semibold">{supplier.name}</p>
                    <p className="text-xs text-slate-500">{supplier.location || 'No location'}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items */}
          <div>
            <label className="text-xs font-medium text-slate-600 mb-2 block">Items</label>
            <div className="space-y-3">
              {formData.items.map((item, index) => (
                <div key={index} className="bg-slate-50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-600">Item {index + 1}</span>
                    {formData.items.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(index)}>
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={item.is_custom}
                      onCheckedChange={(checked) => {
                        handleItemChange(index, "is_custom", checked);
                        if (!checked) handleItemChange(index, "inventory_item_id", "");
                      }}
                    />
                    <label className="text-xs text-slate-600">Custom item</label>
                  </div>

                  {item.is_custom ? (
                    <Input
                      placeholder="Item name"
                      value={item.name}
                      onChange={e => handleItemChange(index, "name", e.target.value)}
                      className="bg-white"
                    />
                  ) : (
                    <Select value={item.inventory_item_id} onValueChange={v => handleInventorySelect(index, v)}>
                      <SelectTrigger className="bg-white"><SelectValue placeholder="Select from inventory..." /></SelectTrigger>
                      <SelectContent>
                        {inventoryItems.map(inv => (
                          <SelectItem key={inv.id} value={inv.id}>
                            {inv.name} ({inv.current_stock} {inv.unit})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-slate-500">Qty</label>
                      <Input
                        inputMode="decimal"
                        value={item.quantity}
                        onChange={e => handleItemChange(index, "quantity", e.target.value)}
                        className="bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Unit Price (R)</label>
                      <Input
                        inputMode="decimal"
                        value={item.unit_price}
                        onChange={e => handleItemChange(index, "unit_price", e.target.value)}
                        className="bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Total</label>
                      <div className="h-9 flex items-center font-semibold text-slate-900 text-sm">
                        R{(item.total || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <Button type="button" variant="outline" onClick={addItem} className="w-full">
                <Plus className="w-4 h-4 mr-2" /> Add Item
              </Button>

              <div className="bg-primary text-primary-foreground rounded-xl p-4 flex justify-between items-center">
                <span className="font-semibold">Total</span>
                <span className="text-lg font-bold">R{(formData.total || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Notes</label>
            <Textarea
              placeholder="Special instructions, delivery notes..."
              value={formData.notes}
              onChange={e => handleChange("notes", e.target.value)}
              rows={3}
            />
          </div>

          {saveError && (
            <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 break-words">
              <p className="font-semibold mb-1">Save failed</p>
              <p className="font-mono text-xs">{saveError}</p>
              {saveError.includes('migration') && (
                <p className="mt-2 text-xs text-red-700">
                  Go to <strong>Supabase → SQL Editor</strong> and run the file{' '}
                  <code>supabase/migrations/202605180002_create_purchase_orders_table.sql</code>
                </p>
              )}
              {saveError.includes('RLS') && (
                <p className="mt-2 text-xs text-red-700">
                  Go to <strong>Supabase → Authentication → Policies</strong> and add an ALL policy for <code>purchase_orders</code> table.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : purchaseOrder ? 'Update PO' : 'Create PO'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
