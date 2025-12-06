import React, { useState, useEffect } from "react";
import TypeformWrapper from "../forms/TypeformWrapper";
import TypeformInput from "../forms/TypeformInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

export default function TypeformPOForm({ 
  purchaseOrder, 
  suppliers = [], 
  inventoryItems = [],
  onSubmit, 
  onCancel 
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState(purchaseOrder || {
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
        // For backward compatibility, set supplier_id to first
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
      handleItemChange(index, "inventory_item_id", inventoryId);
      handleItemChange(index, "name", item.name);
      handleItemChange(index, "unit", item.unit);
      handleItemChange(index, "unit_price", item.cost_price || 0);
      handleItemChange(index, "is_custom", false);
    }
  };

  const handleItemChange = (index, field, value) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    
    if (field === "quantity" || field === "unit_price") {
      newItems[index].total = (newItems[index].quantity || 0) * (newItems[index].unit_price || 0);
    }
    
    const subtotal = newItems.reduce((sum, item) => sum + (item.total || 0), 0);
    
    setFormData(prev => ({
      ...prev,
      items: newItems,
      subtotal,
      total: subtotal + (prev.tax || 0)
    }));
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
    const subtotal = newItems.reduce((sum, item) => sum + (item.total || 0), 0);
    setFormData(prev => ({
      ...prev,
      items: newItems,
      subtotal,
      total: subtotal + (prev.tax || 0)
    }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    await onSubmit(formData);
    setIsSubmitting(false);
  };

  const SupplierStep = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-6">
        <span className="text-sm text-slate-400 mb-1 block">1 →</span>
        <h2 className="text-2xl md:text-3xl font-medium text-slate-900">
          Select suppliers
        </h2>
        <p className="text-slate-500 mt-2">Choose one or more suppliers for this order</p>
      </div>

      <div className="space-y-2">
        {suppliers.map(supplier => (
          <button
            key={supplier.id}
            onClick={() => toggleSupplier(supplier.id)}
            className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
              (formData.supplier_ids || []).includes(supplier.id)
                ? 'border-[#0F9B8E] bg-[#0F9B8E]/5'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <p className="font-semibold">{supplier.name}</p>
            <p className="text-sm text-slate-500">
              {supplier.type?.replace(/_/g, ' ')} • {supplier.location || 'No location'}
            </p>
          </button>
        ))}
      </div>
    </motion.div>
  );

  const ItemsStep = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="mb-6">
        <span className="text-sm text-slate-400 mb-1 block">3 →</span>
        <h2 className="text-2xl md:text-3xl font-medium text-slate-900">
          What items are you ordering?
        </h2>
        <p className="text-slate-500 mt-2">Add the items you need to purchase</p>
      </div>

      <div className="space-y-4">
        {formData.items.map((item, index) => (
          <div key={index} className="bg-slate-50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">Item {index + 1}</span>
              {formData.items.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removeItem(index)}>
                  <Trash2 className="w-4 h-4 text-red-500" />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 mb-2">
              <Checkbox 
                checked={item.is_custom}
                onCheckedChange={(checked) => {
                  handleItemChange(index, "is_custom", checked);
                  if (!checked) handleItemChange(index, "inventory_item_id", "");
                }}
              />
              <label className="text-xs text-slate-600">Custom product</label>
            </div>
            
            {item.is_custom ? (
              <Input
                placeholder="Custom item name"
                value={item.name}
                onChange={(e) => handleItemChange(index, "name", e.target.value)}
                className="bg-white"
              />
            ) : (
              <Select 
                value={item.inventory_item_id} 
                onValueChange={(v) => handleInventorySelect(index, v)}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Select from inventory..." />
                </SelectTrigger>
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
                  type="number"
                  value={item.quantity}
                  onChange={(e) => handleItemChange(index, "quantity", parseFloat(e.target.value) || 0)}
                  className="bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Unit Price (R)</label>
                <Input
                  type="number"
                  value={item.unit_price}
                  onChange={(e) => handleItemChange(index, "unit_price", parseFloat(e.target.value) || 0)}
                  className="bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Total</label>
                <div className="h-10 flex items-center font-semibold text-slate-900">
                  R{(item.total || 0).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        ))}

        <Button type="button" variant="outline" onClick={addItem} className="w-full">
          <Plus className="w-4 h-4 mr-2" /> Add Another Item
        </Button>

        <div className="bg-slate-900 text-white rounded-xl p-4 mt-4">
          <div className="flex justify-between text-lg font-semibold">
            <span>Total</span>
            <span>R{(formData.total || 0).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );

  const steps = [
    <SupplierStep key="suppliers" />,
    <TypeformInput
      key="expected_delivery"
      type="date"
      label="Expected delivery date"
      subtitle="When do you need these items?"
      value={formData.expected_delivery}
      onChange={(v) => handleChange("expected_delivery", v)}
      isActive={currentStep === 1}
      questionNumber="2"
    />,
    <ItemsStep key="items" />,
    <TypeformInput
      key="notes"
      type="textarea"
      label="Any notes for this order?"
      subtitle="Special instructions, delivery notes, etc."
      value={formData.notes}
      onChange={(v) => handleChange("notes", v)}
      placeholder="Additional notes..."
      isActive={currentStep === 3}
      questionNumber="4"
    />
  ];

  return (
    <div className="fixed inset-0 z-50 bg-white">
      <button 
        onClick={onCancel}
        className="fixed top-6 right-6 z-50 text-slate-400 hover:text-slate-600 text-sm"
      >
        ✕ Close
      </button>
      
      <TypeformWrapper
        currentStep={currentStep}
        setCurrentStep={setCurrentStep}
        totalSteps={steps.length}
        onSubmit={handleSubmit}
        submitLabel={purchaseOrder ? "Update PO" : "Create Purchase Order"}
        isSubmitting={isSubmitting}
      >
        {steps[currentStep]}
      </TypeformWrapper>
    </div>
  );
}