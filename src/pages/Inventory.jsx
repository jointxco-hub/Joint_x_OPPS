import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Plus, Package, AlertTriangle, X, Trash2, 
  Edit, TrendingUp
} from "lucide-react";

const categoryColors = {
  vinyl: "bg-blue-100 text-blue-700",
  blanks: "bg-emerald-100 text-emerald-700",
  ink: "bg-purple-100 text-purple-700",
  labels: "bg-pink-100 text-pink-700",
  packaging: "bg-orange-100 text-orange-700",
  other: "bg-slate-100 text-slate-700"
};

export default function Inventory() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    sku: "",
    category: "vinyl",
    current_stock: 0,
    unit: "meters",
    reorder_point: 10,
    reorder_quantity: 20,
    cost_price: 0,
    selling_price: 0,
    preferred_supplier_id: "",
    location: ""
  });
  const queryClient = useQueryClient();

  const { data: inventory = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => base44.entities.InventoryItem.list('name', 200)
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => base44.entities.Supplier.list('name', 100)
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.InventoryItem.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.InventoryItem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.InventoryItem.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory'] })
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingItem(null);
    setFormData({
      name: "", sku: "", category: "vinyl", current_stock: 0, unit: "meters",
      reorder_point: 10, reorder_quantity: 20, cost_price: 0, selling_price: 0,
      preferred_supplier_id: "", location: ""
    });
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setFormData({
      name: item.name || "",
      sku: item.sku || "",
      category: item.category || "vinyl",
      current_stock: item.current_stock || 0,
      unit: item.unit || "meters",
      reorder_point: item.reorder_point || 10,
      reorder_quantity: item.reorder_quantity || 20,
      cost_price: item.cost_price || item.unit_cost || 0,
      selling_price: item.selling_price || 0,
      preferred_supplier_id: item.preferred_supplier_id || "",
      location: item.location || ""
    });
    setShowForm(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const lowStockItems = inventory.filter(item => 
    item.reorder_point && item.current_stock <= item.reorder_point
  );

  const groupedInventory = inventory.reduce((acc, item) => {
    const cat = item.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const calculateMargin = (cost, sell) => {
    if (!cost || !sell || sell === 0) return 0;
    return ((sell - cost) / sell) * 100;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
            <p className="text-slate-500">Track materials with cost & selling prices</p>
          </div>
          <Button onClick={() => setShowForm(true)} className="bg-slate-900 hover:bg-slate-800">
            <Plus className="w-4 h-4 mr-2" /> Add Item
          </Button>
        </div>

        {/* Low Stock Alert */}
        {lowStockItems.length > 0 && (
          <Card className="mb-6 bg-gradient-to-r from-red-50 to-orange-50 border-red-100">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <div>
                  <p className="font-semibold text-red-700">
                    {lowStockItems.length} items below reorder point
                  </p>
                  <p className="text-sm text-red-600">
                    {lowStockItems.map(i => i.name).join(", ")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-lg bg-white border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle>{editingItem ? "Edit Item" : "Add Inventory Item"}</CardTitle>
                <Button variant="ghost" size="icon" onClick={resetForm}>
                  <X className="w-5 h-5" />
                </Button>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 col-span-2">
                      <Label>Item Name *</Label>
                      <Input
                        value={formData.name}
                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                        placeholder="e.g., Videoflex Vinyl"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>SKU</Label>
                      <Input
                        value={formData.sku}
                        onChange={(e) => setFormData({...formData, sku: e.target.value})}
                        placeholder="VNL-VF-001"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="vinyl">Vinyl</SelectItem>
                          <SelectItem value="blanks">Blanks</SelectItem>
                          <SelectItem value="ink">Ink</SelectItem>
                          <SelectItem value="labels">Labels</SelectItem>
                          <SelectItem value="packaging">Packaging</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Current Stock</Label>
                      <Input
                        type="number"
                        value={formData.current_stock}
                        onChange={(e) => setFormData({...formData, current_stock: parseFloat(e.target.value) || 0})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Unit</Label>
                      <Select value={formData.unit} onValueChange={(v) => setFormData({...formData, unit: v})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="meters">Meters</SelectItem>
                          <SelectItem value="pieces">Pieces</SelectItem>
                          <SelectItem value="rolls">Rolls</SelectItem>
                          <SelectItem value="liters">Liters</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Cost Price (R)</Label>
                      <Input
                        type="number"
                        value={formData.cost_price}
                        onChange={(e) => setFormData({...formData, cost_price: parseFloat(e.target.value) || 0})}
                        placeholder="What you pay"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Selling Price (R)</Label>
                      <Input
                        type="number"
                        value={formData.selling_price}
                        onChange={(e) => setFormData({...formData, selling_price: parseFloat(e.target.value) || 0})}
                        placeholder="What you charge"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Reorder Point</Label>
                      <Input
                        type="number"
                        value={formData.reorder_point}
                        onChange={(e) => setFormData({...formData, reorder_point: parseFloat(e.target.value) || 0})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Reorder Quantity</Label>
                      <Input
                        type="number"
                        value={formData.reorder_quantity}
                        onChange={(e) => setFormData({...formData, reorder_quantity: parseFloat(e.target.value) || 0})}
                      />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>Preferred Supplier</Label>
                      <Select 
                        value={formData.preferred_supplier_id} 
                        onValueChange={(v) => setFormData({...formData, preferred_supplier_id: v})}
                      >
                        <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={null}>None</SelectItem>
                          {suppliers.map(s => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>Storage Location</Label>
                      <Input
                        value={formData.location}
                        onChange={(e) => setFormData({...formData, location: e.target.value})}
                        placeholder="e.g., Warehouse A, Shelf 3"
                      />
                    </div>
                  </div>

                  {/* Margin Preview */}
                  {formData.cost_price > 0 && formData.selling_price > 0 && (
                    <div className="bg-emerald-50 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-600" />
                        <span className="text-sm font-medium text-emerald-700">
                          Profit Margin: {calculateMargin(formData.cost_price, formData.selling_price).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={resetForm} className="flex-1">
                      Cancel
                    </Button>
                    <Button type="submit" className="flex-1 bg-slate-900">
                      {editingItem ? "Update" : "Add Item"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Inventory Grid */}
        {inventory.length === 0 ? (
          <Card className="p-12 text-center bg-white border-0">
            <Package className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700 mb-2">No inventory items</h3>
            <p className="text-slate-500 mb-4">Add your first inventory item to get started</p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Item
            </Button>
          </Card>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedInventory).map(([category, items]) => (
              <div key={category}>
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Badge className={`${categoryColors[category]} border-0`}>
                    {category}
                  </Badge>
                  <span>({items.length} items)</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map(item => {
                    const isLowStock = item.reorder_point && item.current_stock <= item.reorder_point;
                    const stockPercent = item.reorder_point 
                      ? Math.min((item.current_stock / item.reorder_point) * 100, 100)
                      : 100;
                    const costPrice = item.cost_price || item.unit_cost || 0;
                    const sellingPrice = item.selling_price || 0;
                    const margin = calculateMargin(costPrice, sellingPrice);
                    
                    return (
                      <Card 
                        key={item.id} 
                        className={`bg-white border-0 shadow-sm hover:shadow-md transition-all ${isLowStock ? 'ring-2 ring-red-200' : ''}`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h3 className="font-semibold text-slate-900">{item.name}</h3>
                              {item.sku && <p className="text-xs text-slate-400">{item.sku}</p>}
                            </div>
                            {isLowStock && (
                              <AlertTriangle className="w-5 h-5 text-red-500" />
                            )}
                          </div>

                          <div className="space-y-3">
                            {/* Stock Level */}
                            <div>
                              <div className="flex justify-between text-sm mb-1">
                                <span className="text-slate-500">Stock</span>
                                <span className="font-medium">
                                  {item.current_stock} {item.unit}
                                </span>
                              </div>
                              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full ${isLowStock ? 'bg-red-500' : 'bg-emerald-500'}`}
                                  style={{ width: `${stockPercent}%` }}
                                />
                              </div>
                            </div>

                            {/* Pricing */}
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="bg-slate-50 rounded p-2">
                                <p className="text-xs text-slate-500">Cost</p>
                                <p className="font-semibold">R{costPrice.toFixed(2)}</p>
                              </div>
                              <div className="bg-emerald-50 rounded p-2">
                                <p className="text-xs text-slate-500">Sell</p>
                                <p className="font-semibold text-emerald-700">
                                  R{sellingPrice > 0 ? sellingPrice.toFixed(2) : '-'}
                                </p>
                              </div>
                            </div>

                            {/* Margin */}
                            {margin > 0 && (
                              <div className="flex items-center gap-2 text-sm">
                                <TrendingUp className={`w-4 h-4 ${margin >= 30 ? 'text-emerald-500' : 'text-amber-500'}`} />
                                <span className={margin >= 30 ? 'text-emerald-600' : 'text-amber-600'}>
                                  {margin.toFixed(1)}% margin
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex gap-2 mt-4 pt-3 border-t">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => handleEdit(item)}
                              className="flex-1"
                            >
                              <Edit className="w-4 h-4 mr-1" /> Edit
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => deleteMutation.mutate(item.id)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}