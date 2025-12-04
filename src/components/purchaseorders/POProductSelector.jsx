import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, Package, X } from "lucide-react";

const CATALOG_PRODUCTS = {
  blanks: {
    name: "Blanks",
    items: [
      { id: "jv1", name: "JV1 T-Shirt (180gsm)", sku: "JV1", price: 75, sizes: ["S", "M", "L", "XL", "2XL", "3XL"] },
      { id: "jet", name: "JET T-Shirt (220gsm)", sku: "JET", price: 120, sizes: ["S", "M", "L", "XL", "2XL", "3XL"] },
      { id: "jhg", name: "JHG T-Shirt (300gsm)", sku: "JHG", price: 180, sizes: ["S", "M", "L", "XL", "2XL", "3XL"] },
      { id: "hoodie_260", name: "Hoodie 260gsm", sku: "HOD-260", price: 190, sizes: ["S", "M", "L", "XL", "2XL"] },
      { id: "hoodie_360", name: "Hoodie 360gsm", sku: "HOD-360", price: 250, sizes: ["S", "M", "L", "XL", "2XL"] },
      { id: "hoodie_430", name: "Hoodie 430gsm", sku: "HOD-430", price: 310, sizes: ["S", "M", "L", "XL", "2XL"] },
      { id: "cap_5panel", name: "5-Panel Cap", sku: "CAP-5P", price: 55 },
      { id: "bucket_hat", name: "Bucket Hat", sku: "HAT-BKT", price: 90 },
      { id: "trackpants", name: "Trackpants", sku: "TRK", price: 200, sizes: ["S", "M", "L", "XL", "2XL"] },
      { id: "shorts", name: "Shorts", sku: "SHT", price: 140, sizes: ["S", "M", "L", "XL", "2XL"] }
    ]
  },
  vinyl: {
    name: "Vinyl",
    items: [
      { id: "vinyl_vf", name: "Videoflex Vinyl", sku: "VNL-VF", price: 85, unit: "meters" },
      { id: "vinyl_flk", name: "Flock Vinyl", sku: "VNL-FLK", price: 95, unit: "meters" },
      { id: "vinyl_sil", name: "Silicon Vinyl", sku: "VNL-SIL", price: 100, unit: "meters" }
    ]
  },
  labels: {
    name: "Labels & Packaging",
    items: [
      { id: "lbl_white", name: "White Satin Labels (100pc)", sku: "LBL-WS", price: 180 },
      { id: "lbl_black", name: "Black Satin Labels (100pc)", sku: "LBL-BS", price: 200 },
      { id: "lbl_woven", name: "Woven Labels (1000pc)", sku: "LBL-WVN", price: 1500 },
      { id: "pkg_zip", name: "Zipper Bags (100pc)", sku: "PKG-ZIP", price: 180 }
    ]
  }
};

const COLORS = ["Black", "White", "Navy", "Grey", "Red", "Green", "Beige"];

export default function POProductSelector({ selectedItems, onItemsChange }) {
  const [activeCategory, setActiveCategory] = useState("blanks");
  const [showCustom, setShowCustom] = useState(false);
  const [customItem, setCustomItem] = useState({ name: "", quantity: 1, unit_price: 0, unit: "pieces" });

  const addProduct = (product) => {
    const existing = selectedItems.find(i => i.product_id === product.id && !i.size && !i.color);
    if (existing) {
      onItemsChange(selectedItems.map(i => 
        i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i
      ));
    } else {
      onItemsChange([...selectedItems, {
        id: Date.now(),
        product_id: product.id,
        name: product.name,
        sku: product.sku,
        quantity: 1,
        unit: product.unit || "pieces",
        unit_price: product.price,
        total: product.price,
        sizes: product.sizes || null
      }]);
    }
  };

  const addVariant = (itemId, size, color) => {
    const item = selectedItems.find(i => i.id === itemId);
    if (!item) return;

    const variantKey = `${size}-${color}`;
    const variants = item.variants || {};
    variants[variantKey] = (variants[variantKey] || 0) + 1;
    
    const totalQty = Object.values(variants).reduce((sum, q) => sum + q, 0);
    
    onItemsChange(selectedItems.map(i => 
      i.id === itemId ? { ...i, variants, quantity: totalQty, total: totalQty * i.unit_price } : i
    ));
  };

  const updateVariant = (itemId, variantKey, qty) => {
    const item = selectedItems.find(i => i.id === itemId);
    if (!item) return;

    const variants = { ...item.variants };
    if (qty <= 0) {
      delete variants[variantKey];
    } else {
      variants[variantKey] = qty;
    }
    
    const totalQty = Object.values(variants).reduce((sum, q) => sum + q, 0);
    
    if (totalQty === 0) {
      onItemsChange(selectedItems.filter(i => i.id !== itemId));
    } else {
      onItemsChange(selectedItems.map(i => 
        i.id === itemId ? { ...i, variants, quantity: totalQty, total: totalQty * i.unit_price } : i
      ));
    }
  };

  const updateQuantity = (itemId, qty) => {
    if (qty <= 0) {
      onItemsChange(selectedItems.filter(i => i.id !== itemId));
    } else {
      onItemsChange(selectedItems.map(i => 
        i.id === itemId ? { ...i, quantity: qty, total: qty * i.unit_price } : i
      ));
    }
  };

  const removeItem = (itemId) => {
    onItemsChange(selectedItems.filter(i => i.id !== itemId));
  };

  const addCustomItem = () => {
    if (!customItem.name) return;
    onItemsChange([...selectedItems, {
      id: Date.now(),
      product_id: null,
      name: customItem.name,
      sku: "CUSTOM",
      quantity: customItem.quantity,
      unit: customItem.unit,
      unit_price: customItem.unit_price,
      total: customItem.quantity * customItem.unit_price,
      isCustom: true
    }]);
    setCustomItem({ name: "", quantity: 1, unit_price: 0, unit: "pieces" });
    setShowCustom(false);
  };

  return (
    <div className="space-y-6">
      {/* Category Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {Object.entries(CATALOG_PRODUCTS).map(([key, cat]) => (
          <button
            key={key}
            onClick={() => setActiveCategory(key)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              activeCategory === key
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {cat.name}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(true)}
          className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap bg-blue-50 text-blue-600 hover:bg-blue-100"
        >
          <Plus className="w-4 h-4 inline mr-1" /> Custom
        </button>
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {CATALOG_PRODUCTS[activeCategory]?.items.map(product => {
          const isSelected = selectedItems.some(i => i.product_id === product.id);
          return (
            <button
              key={product.id}
              onClick={() => addProduct(product)}
              className={`p-4 rounded-2xl border-2 text-left transition-all ${
                isSelected
                  ? 'border-slate-900 bg-slate-50'
                  : 'border-slate-100 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-slate-900 text-sm">{product.name}</p>
                  <p className="text-xs text-slate-500 mt-1">{product.sku}</p>
                </div>
                {isSelected && (
                  <Badge className="bg-slate-900 text-white">Added</Badge>
                )}
              </div>
              <p className="text-lg font-semibold text-slate-900 mt-2">
                R{product.price}
                <span className="text-xs text-slate-500 font-normal">/{product.unit || 'pc'}</span>
              </p>
            </button>
          );
        })}
      </div>

      {/* Custom Item Modal */}
      {showCustom && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold">Add Custom Item</h3>
              <button onClick={() => setShowCustom(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <Label>Item Name</Label>
                <Input
                  value={customItem.name}
                  onChange={(e) => setCustomItem({...customItem, name: e.target.value})}
                  placeholder="e.g., Special Fabric"
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    value={customItem.quantity}
                    onChange={(e) => setCustomItem({...customItem, quantity: parseInt(e.target.value) || 1})}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Unit Price (R)</Label>
                  <Input
                    type="number"
                    value={customItem.unit_price}
                    onChange={(e) => setCustomItem({...customItem, unit_price: parseFloat(e.target.value) || 0})}
                    className="mt-1"
                  />
                </div>
              </div>
              <Button onClick={addCustomItem} className="w-full bg-slate-900 hover:bg-slate-800">
                Add Item
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Selected Items */}
      {selectedItems.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-medium text-slate-700">Selected Items</h4>
          {selectedItems.map(item => (
            <div key={item.id} className="bg-slate-50 rounded-2xl p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-slate-500">{item.sku}</p>
                </div>
                <button onClick={() => removeItem(item.id)} className="text-slate-400 hover:text-red-500">
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              {item.sizes ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">Sizes & Colors</p>
                  <div className="flex flex-wrap gap-2">
                    {item.sizes.map(size => (
                      COLORS.slice(0, 3).map(color => {
                        const key = `${size}-${color}`;
                        const qty = item.variants?.[key] || 0;
                        return (
                          <div key={key} className="flex items-center gap-1 bg-white rounded-lg px-2 py-1 border">
                            <span className="text-xs">{size}/{color.slice(0,3)}</span>
                            <button 
                              onClick={() => updateVariant(item.id, key, qty - 1)}
                              className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="text-xs w-4 text-center">{qty}</span>
                            <button 
                              onClick={() => updateVariant(item.id, key, qty + 1)}
                              className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    className="w-8 h-8 rounded-full bg-white border flex items-center justify-center"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="font-medium">{item.quantity}</span>
                  <button 
                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    className="w-8 h-8 rounded-full bg-white border flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <span className="text-slate-500 text-sm">{item.unit}</span>
                  <span className="ml-auto font-semibold">R{item.total}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}