import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  ShoppingCart, Plus, Minus, Trash2, 
  Shirt, Send, X, ChevronRight, Tag, Percent
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import FloatingCart from "@/components/catalog/FloatingCart";

const CATALOG = {
  tshirts: {
    name: "T-Shirts",
    items: [
      { id: "jv1", name: "JV1 T-Shirt", code: "JV1", gsm: "180gsm", material: "100% Cotton", price: 95, image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400" },
      { id: "jet", name: "JET T-Shirt", code: "JET", gsm: "220gsm", material: "100% Combed Cotton", price: 155, image: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400" },
      { id: "jhg", name: "JHG T-Shirt", code: "JHG", gsm: "300gsm", material: "100% Carded Cotton", price: 229, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400" }
    ]
  },
  hoodies: {
    name: "Hoodies",
    items: [
      { id: "hoodie_260", name: "Hoodie 260gsm", gsm: "260gsm", material: "Cotton Blend", price: 240, image: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400" },
      { id: "hoodie_360", name: "Hoodie 360gsm", gsm: "360gsm", material: "Brushed Fleece", price: 320, image: "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=400" },
      { id: "hoodie_430", name: "Hoodie 430gsm", gsm: "430gsm", material: "100% Cotton Fleece", price: 400, image: "https://images.unsplash.com/photo-1578768079052-aa76e52ff62e?w=400" }
    ]
  },
  sweaters: {
    name: "Sweaters",
    items: [
      { id: "sweater_260", name: "Sweater 260gsm", gsm: "260gsm", material: "Cotton Blend", price: 220, image: "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=400" },
      { id: "sweater_360", name: "Sweater 360gsm", gsm: "360gsm", material: "Brushed Fleece", price: 300, image: "https://images.unsplash.com/photo-1578587018452-892bacefd3f2?w=400" },
      { id: "sweater_430", name: "Sweater 430gsm", gsm: "430gsm", material: "100% Cotton Fleece", price: 380, image: "https://images.unsplash.com/photo-1572495532056-8583af1cbae0?w=400" }
    ]
  },
  headwear: {
    name: "Head Wear",
    items: [
      { id: "cap_5panel", name: "5-Panel Cap", material: "Cotton Twill", price: 75, image: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=400" },
      { id: "bucket_hat", name: "Bucket Hat", material: "Poly-Cotton", price: 120, image: "https://images.unsplash.com/photo-1572460556623-78f47de5d81c?w=400" },
      { id: "trucker", name: "Trucker Cap", material: "Cotton/Mesh", price: 75, image: "https://images.unsplash.com/photo-1534215754734-18e55d13e346?w=400" }
    ]
  },
  bottoms: {
    name: "Bottoms",
    items: [
      { id: "trackpants", name: "Trackpants", material: "280g Brushed Fleece", price: 260, image: "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=400" },
      { id: "shorts", name: "Shorts", material: "Cotton Jersey", price: 180, image: "https://images.unsplash.com/photo-1591195853828-11db59a44f6b?w=400" }
    ]
  }
};

// Print material costs (we'll add 100% margin for client pricing)
const PRINT_MATERIALS = {
  dtf_epic: { name: "DTF Epic (400mm x 1000mm)", cost: 212.75, type: "dtf" },
  dtf_kandy: { name: "DTF Kandy (570mm x 1000mm)", cost: 170, type: "dtf" },
  vinyl: { name: "Vinyl (500mm x 1000mm)", cost: 120, type: "vinyl" },
  embroidery: { name: "Embroidery", cost: 50, type: "embroidery" },
  neck_tag: { name: "Neck Tag", cost: 20, type: "other" }
};

const PRINT_LOCATIONS = ["Front", "Back", "Left Chest", "Right Chest", "Sleeve", "Neck Tag"];

// Calculate client price with 100% profit margin
function calculateClientPrice(cost) {
  return cost * 2; // 100% markup
}

const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
const COLORS = ["Black", "White", "Navy", "Grey", "Red", "Green", "Beige", "Brown"];

// Bulk discount tiers
const BULK_DISCOUNTS = [
  { min: 1, max: 49, discount: 0, label: "Standard" },
  { min: 50, max: 99, discount: 10, label: "10% off" },
  { min: 100, max: 249, discount: 15, label: "15% off" },
  { min: 250, max: Infinity, discount: 20, label: "Custom Quote" }
];

function getBulkDiscount(totalQty) {
  const tier = BULK_DISCOUNTS.find(t => totalQty >= t.min && totalQty <= t.max);
  return tier || BULK_DISCOUNTS[0];
}

export default function ClientCatalog() {
  const [cart, setCart] = useState([]);
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedColor, setSelectedColor] = useState("Black");
  const [sizeQuantities, setSizeQuantities] = useState({});
  const [printConfigs, setPrintConfigs] = useState([]);
  const [clientInfo, setClientInfo] = useState({
    name: "", email: "", phone: "", company: "", notes: ""
  });

  const submitOrderMutation = useMutation({
    mutationFn: (data) => base44.entities.ClientOrder.create(data),
    onSuccess: () => {
      toast.success("Order submitted! We'll contact you shortly.");
      setCart([]);
      setShowCheckout(false);
      setClientInfo({ name: "", email: "", phone: "", company: "", notes: "" });
    }
  });

  const updateSizeQty = (size, delta) => {
    setSizeQuantities(prev => ({
      ...prev,
      [size]: Math.max(0, (prev[size] || 0) + delta)
    }));
  };

  const setSizeQtyDirect = (size, value) => {
    setSizeQuantities(prev => ({
      ...prev,
      [size]: Math.max(0, parseInt(value) || 0)
    }));
  };

  const addPrintConfig = () => {
    setPrintConfigs([...printConfigs, {
      id: Date.now(),
      material: "dtf_epic",
      location: "Front",
      customWidth: 400,
      customHeight: 400
    }]);
  };

  const removePrintConfig = (id) => {
    setPrintConfigs(printConfigs.filter(p => p.id !== id));
  };

  const updatePrintConfig = (id, field, value) => {
    setPrintConfigs(printConfigs.map(p =>
      p.id === id ? { ...p, [field]: value } : p
    ));
  };

  const calculatePrintCost = (config) => {
    const material = PRINT_MATERIALS[config.material];
    if (!material) return 0;
    
    // Calculate area ratio (client size vs standard size)
    const standardArea = 400 * 1000; // Standard 400mm x 1000mm
    const clientArea = (config.customWidth || 400) * (config.customHeight || 400);
    const areaRatio = clientArea / standardArea;
    
    // Calculate cost based on area
    const materialCost = material.cost * areaRatio;
    // Return client price with 100% markup
    return calculateClientPrice(materialCost);
  };

  const itemTotalQty = Object.values(sizeQuantities).reduce((sum, q) => sum + q, 0);

  const addToCart = () => {
    if (!selectedItem || itemTotalQty === 0) return;
    
    const printTotal = printConfigs.reduce((sum, config) => sum + calculatePrintCost(config), 0);

    // Create cart items for each size with qty > 0
    const newItems = Object.entries(sizeQuantities)
      .filter(([_, qty]) => qty > 0)
      .map(([size, quantity]) => ({
        id: `${selectedItem.id}-${selectedColor}-${size}-${Date.now()}`,
        name: selectedItem.name,
        catalogItem: selectedItem,
        size,
        color: selectedColor,
        quantity,
        printOptions: printConfigs.map(config => ({
          type: PRINT_MATERIALS[config.material].name,
          location: config.location,
          customSize: `${config.customWidth}mm x ${config.customHeight}mm`,
          price: calculatePrintCost(config)
        })),
        basePrice: selectedItem.price,
        printCost: printTotal,
        unitPrice: selectedItem.price + printTotal,
        total: (selectedItem.price + printTotal) * quantity
      }));

    setCart([...cart, ...newItems]);
    setSelectedItem(null);
    setSizeQuantities({});
    setPrintConfigs([]);
    setSelectedColor("Black");
    toast.success(`Added ${itemTotalQty} items to cart!`);
  };

  const removeFromCart = (index) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  const updateCartQuantity = (index, newQty) => {
    if (newQty < 1) return;
    setCart(cart.map((item, i) => {
      if (i === index) {
        return { ...item, quantity: newQty, total: item.unitPrice * newQty };
      }
      return item;
    }));
  };

  // Calculate totals with bulk discount
  const cartQty = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cart.reduce((sum, item) => sum + item.total, 0);
  const bulkTier = getBulkDiscount(cartQty);
  const discountAmount = cartSubtotal * (bulkTier.discount / 100);
  const cartTotal = cartSubtotal - discountAmount;

  const handleSubmitOrder = () => {
    const orderData = {
      order_number: `CLT-${Date.now().toString(36).toUpperCase()}`,
      tracking_code: Math.random().toString(36).substring(2, 8).toUpperCase(),
      client_name: clientInfo.name,
      client_email: clientInfo.email,
      client_phone: clientInfo.phone,
      company_name: clientInfo.company,
      items: cart.map(item => ({
        name: item.catalogItem.name,
        size: item.size,
        color: item.color,
        quantity: item.quantity,
        print_options: item.printOptions.map(p => ({ type: p.name, price: p.price })),
        unit_price: item.unitPrice,
        total: item.total
      })),
      subtotal: cartSubtotal,
      discount: discountAmount,
      total: cartTotal,
      notes: clientInfo.notes,
      special_instructions: clientInfo.notes,
      status: "pending"
    };
    submitOrderMutation.mutate(orderData);
  };

  // Item Configuration with Multi-Size Selection
  if (selectedItem) {
    const printTotal = printConfigs.reduce((sum, config) => sum + calculatePrintCost(config), 0);
    const unitPrice = selectedItem.price + printTotal;
    const itemTotal = unitPrice * itemTotalQty;
    const currentBulkTier = getBulkDiscount(cartQty + itemTotalQty);

    return (
      <div className="min-h-screen bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto p-4 md:p-8">
          <Button variant="ghost" onClick={() => { setSelectedItem(null); setSizeQuantities({}); setPrintOptions([]); }} className="mb-6 text-slate-400">
            ← Back to Catalog
          </Button>

          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <img src={selectedItem.image} alt={selectedItem.name} className="w-full aspect-square object-cover rounded-2xl" />
            </div>
            
            <div className="space-y-6">
              <div>
                <h1 className="text-3xl font-bold">{selectedItem.name}</h1>
                {selectedItem.code && <p className="text-slate-400">Code: {selectedItem.code}</p>}
                <p className="text-2xl font-bold text-emerald-400 mt-2">R{selectedItem.price} per item</p>
              </div>

              <div className="space-y-2 text-sm text-slate-400">
                {selectedItem.gsm && <p>GSM: {selectedItem.gsm}</p>}
                {selectedItem.material && <p>Material: {selectedItem.material}</p>}
              </div>

              {/* Color Selection */}
              <div className="space-y-3">
                <Label className="text-white">Color</Label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => setSelectedColor(color)}
                      className={`px-4 py-2 rounded-lg border-2 transition-all ${
                        selectedColor === color 
                          ? 'border-emerald-500 bg-emerald-500/20' 
                          : 'border-slate-600 hover:border-slate-500'
                      }`}
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </div>

              {/* Multi-Size Quantity Selection */}
              <div className="space-y-3">
                <Label className="text-white">Sizes & Quantities</Label>
                <p className="text-sm text-slate-400">Add quantities for each size you need</p>
                <div className="grid grid-cols-4 gap-2">
                  {SIZES.map(size => (
                    <div key={size} className="bg-slate-800 rounded-lg p-3 text-center">
                      <p className="text-sm font-medium mb-2">{size}</p>
                      <div className="flex items-center justify-center gap-1">
                        <button 
                          onClick={() => updateSizeQty(size, -1)}
                          className="w-6 h-6 rounded bg-slate-700 flex items-center justify-center hover:bg-slate-600"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={sizeQuantities[size] || 0}
                          onChange={(e) => setSizeQtyDirect(size, e.target.value)}
                          className="w-10 h-6 text-center bg-slate-900 border border-slate-600 rounded text-sm"
                        />
                        <button 
                          onClick={() => updateSizeQty(size, 1)}
                          className="w-6 h-6 rounded bg-slate-700 flex items-center justify-center hover:bg-slate-600"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {itemTotalQty > 0 && (
                  <p className="text-emerald-400 text-sm font-medium">
                    Total: {itemTotalQty} items
                  </p>
                )}
              </div>

              {/* Print Options with Custom Sizes */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-white">Print & Branding (optional)</Label>
                  <Button onClick={addPrintConfig} size="sm" variant="outline" className="text-emerald-400 border-emerald-600">
                    <Plus className="w-4 h-4 mr-1" /> Add Print
                  </Button>
                </div>
                
                {printConfigs.length === 0 ? (
                  <p className="text-sm text-slate-400">No prints added. Click "Add Print" to add custom prints.</p>
                ) : (
                  <div className="space-y-3">
                    {printConfigs.map((config, index) => (
                      <div key={config.id} className="bg-slate-800 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-emerald-400">Print {index + 1}</span>
                          <button
                            onClick={() => removePrintConfig(config.id)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-400">Material</Label>
                            <Select value={config.material} onValueChange={(v) => updatePrintConfig(config.id, "material", v)}>
                              <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(PRINT_MATERIALS).map(([key, mat]) => (
                                  <SelectItem key={key} value={key}>{mat.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs text-slate-400">Location</Label>
                            <Select value={config.location} onValueChange={(v) => updatePrintConfig(config.id, "location", v)}>
                              <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PRINT_LOCATIONS.map(loc => (
                                  <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs text-slate-400">Width (mm)</Label>
                            <Input
                              type="number"
                              value={config.customWidth}
                              onChange={(e) => updatePrintConfig(config.id, "customWidth", parseInt(e.target.value) || 0)}
                              className="bg-slate-900 border-slate-700 text-white"
                              min="10"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs text-slate-400">Height (mm)</Label>
                            <Input
                              type="number"
                              value={config.customHeight}
                              onChange={(e) => updatePrintConfig(config.id, "customHeight", parseInt(e.target.value) || 0)}
                              className="bg-slate-900 border-slate-700 text-white"
                              min="10"
                            />
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-2 border-t border-slate-700">
                          <span className="text-xs text-slate-400">Print Cost</span>
                          <span className="font-semibold text-emerald-400">R{calculatePrintCost(config).toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bulk Discount Indicator */}
              {itemTotalQty > 0 && (
                <div className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 rounded-xl p-4 border border-purple-500/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Percent className="w-5 h-5 text-purple-400" />
                    <span className="font-semibold text-purple-300">Bulk Discount</span>
                  </div>
                  <p className="text-sm text-slate-300">
                    {currentBulkTier.discount > 0 ? (
                      <>You qualify for <span className="text-emerald-400 font-bold">{currentBulkTier.discount}% off</span>!</>
                    ) : cartQty + itemTotalQty >= 40 ? (
                      <>Add {50 - (cartQty + itemTotalQty)} more for <span className="text-emerald-400 font-bold">10% off</span></>
                    ) : (
                      <>50+ items = 10% off • 100+ = 15% off</>
                    )}
                  </p>
                </div>
              )}

              {/* Total & Add to Cart */}
              <div className="bg-slate-800 rounded-xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-slate-400">Unit Price</span>
                  <span>R{unitPrice}</span>
                </div>
                <div className="flex justify-between items-center mb-4">
                  <span className="text-slate-400">Subtotal ({itemTotalQty} items)</span>
                  <span className="text-2xl font-bold text-emerald-400">R{itemTotal}</span>
                </div>
                <Button 
                  onClick={addToCart} 
                  disabled={itemTotalQty === 0}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-lg disabled:opacity-50"
                >
                  <ShoppingCart className="w-5 h-5 mr-2" /> Add to Cart
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Checkout
  if (showCheckout) {
    return (
      <div className="min-h-screen bg-slate-900 text-white">
        <div className="max-w-2xl mx-auto p-4 md:p-8">
          <Button variant="ghost" onClick={() => setShowCheckout(false)} className="mb-6 text-slate-400">
            ← Back
          </Button>

          <h1 className="text-3xl font-bold mb-8">Complete Your Order</h1>

          <div className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Your Name *</Label>
                <Input value={clientInfo.name} onChange={(e) => setClientInfo({...clientInfo, name: e.target.value})} className="bg-slate-800 border-slate-700" required />
              </div>
              <div className="space-y-2">
                <Label>Phone Number *</Label>
                <Input value={clientInfo.phone} onChange={(e) => setClientInfo({...clientInfo, phone: e.target.value})} className="bg-slate-800 border-slate-700" required />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={clientInfo.email} onChange={(e) => setClientInfo({...clientInfo, email: e.target.value})} className="bg-slate-800 border-slate-700" />
              </div>
              <div className="space-y-2">
                <Label>Company/Brand Name</Label>
                <Input value={clientInfo.company} onChange={(e) => setClientInfo({...clientInfo, company: e.target.value})} className="bg-slate-800 border-slate-700" />
              </div>
              <div className="space-y-2">
                <Label>Additional Notes</Label>
                <Textarea value={clientInfo.notes} onChange={(e) => setClientInfo({...clientInfo, notes: e.target.value})} className="bg-slate-800 border-slate-700" placeholder="Design details..." rows={3} />
              </div>
            </div>

            {/* Order Summary */}
            <div className="bg-slate-800 rounded-xl p-4">
              <h3 className="font-semibold mb-4">Order Summary ({cartQty} items)</h3>
              <div className="space-y-2 text-sm mb-4 max-h-48 overflow-y-auto">
                {cart.map(item => (
                  <div key={item.id} className="flex justify-between">
                    <span>{item.quantity}x {item.catalogItem.name} ({item.size}, {item.color})</span>
                    <span>R{item.total}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-700 pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>R{cartSubtotal.toFixed(2)}</span>
                </div>
                {bulkTier.discount > 0 && (
                  <div className="flex justify-between text-sm text-emerald-400">
                    <span>Bulk Discount ({bulkTier.discount}%)</span>
                    <span>-R{discountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xl font-bold pt-2 border-t border-slate-700">
                  <span>Total</span>
                  <span className="text-emerald-400">R{cartTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <Button 
              onClick={handleSubmitOrder}
              disabled={!clientInfo.name || !clientInfo.phone || submitOrderMutation.isPending}
              className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-lg"
            >
              <Send className="w-5 h-5 mr-2" /> 
              {submitOrderMutation.isPending ? "Submitting..." : "Submit Order Request"}
            </Button>

            <p className="text-center text-sm text-slate-500">
              We'll contact you to confirm details. 50% deposit required.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Main Catalog
  return (
    <div className="min-h-screen bg-slate-900">
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
              <Shirt className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-white">Joint X</h1>
              <p className="text-xs text-slate-400">Apparel & Print</p>
            </div>
          </div>
          
          <Button onClick={() => cart.length > 0 && setShowCart(!showCart)} className="relative bg-slate-800 hover:bg-slate-700">
            <ShoppingCart className="w-5 h-5" />
            {cartQty > 0 && (
              <span className="absolute -top-2 -right-2 w-6 h-6 bg-emerald-600 rounded-full text-xs flex items-center justify-center">
                {cartQty}
              </span>
            )}
          </Button>
        </div>
      </header>

      {/* Floating Cart */}
      <FloatingCart 
        cart={cart}
        onRemove={removeFromCart}
        onCheckout={() => setShowCheckout(true)}
        onUpdateQuantity={updateCartQuantity}
      />

      {/* Hero */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 py-12 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">Premium Apparel & Print</h2>
          <p className="text-emerald-100 text-lg">Quality blanks. Expert branding. Nationwide delivery.</p>
          <div className="flex flex-wrap justify-center gap-4 mt-6">
            <Badge className="bg-white/20 text-white">Stock Ready</Badge>
            <Badge className="bg-amber-500 text-white">50+ items = 10% off</Badge>
            <Badge className="bg-pink-500 text-white">100+ = 15% off</Badge>
            <Badge className="bg-white/20 text-white">+27 75 453 4646</Badge>
          </div>
        </div>
      </div>

      {/* Catalog */}
      <div className="max-w-7xl mx-auto px-4 py-12">
        {Object.entries(CATALOG).map(([key, category]) => (
          <div key={key} className="mb-12">
            <h3 className="text-2xl font-bold text-white mb-6">{category.name}</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {category.items.map(item => (
                <Card key={item.id} className="bg-slate-800 border-0 overflow-hidden cursor-pointer hover:ring-2 hover:ring-emerald-500 transition-all" onClick={() => setSelectedItem(item)}>
                  <img src={item.image} alt={item.name} className="w-full aspect-square object-cover" />
                  <CardContent className="p-4">
                    <h4 className="font-semibold text-white">{item.name}</h4>
                    {item.gsm && <p className="text-xs text-slate-400">{item.gsm}</p>}
                    <p className="text-lg font-bold text-emerald-400 mt-2">R{item.price}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <footer className="bg-slate-800 py-8 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-slate-400">Joint X Apparel & Print</p>
          <p className="text-slate-500 text-sm mt-1">WhatsApp: +27 75 453 4646 • Email: jointx.co@gmail.com</p>
          <p className="text-slate-500 text-sm mt-1">Based in JHB • Nationwide Delivery</p>
        </div>
      </footer>
    </div>
  );
}