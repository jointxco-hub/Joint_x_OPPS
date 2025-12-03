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
  ShoppingCart, Plus, Minus, Trash2, Check, 
  Shirt, Send, X, ChevronRight
} from "lucide-react";
import { toast } from "sonner";

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

const PRINT_OPTIONS = [
  { id: "dtf_front", name: "Front Print (DTF)", price: 40 },
  { id: "dtf_back", name: "Back Print (DTF)", price: 60 },
  { id: "dtf_a3", name: "Large Print (A3)", price: 120 },
  { id: "embroidery", name: "Embroidery", price: 50 },
  { id: "vinyl", name: "Vinyl Transfer", price: 50 },
  { id: "neck_tag", name: "Neck Tag", price: 20 }
];

const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
const COLORS = ["Black", "White", "Navy", "Grey", "Red", "Green", "Beige", "Brown"];

export default function ClientCatalog() {
  const [cart, setCart] = useState([]);
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [itemConfig, setItemConfig] = useState({
    size: "M",
    color: "Black",
    quantity: 1,
    printOptions: []
  });
  const [clientInfo, setClientInfo] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    notes: ""
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

  const addToCart = () => {
    if (!selectedItem) return;
    
    const printTotal = itemConfig.printOptions.reduce((sum, pId) => {
      const p = PRINT_OPTIONS.find(o => o.id === pId);
      return sum + (p?.price || 0);
    }, 0);

    const unitPrice = selectedItem.price + printTotal;
    
    const cartItem = {
      id: `${selectedItem.id}-${Date.now()}`,
      catalogItem: selectedItem,
      size: itemConfig.size,
      color: itemConfig.color,
      quantity: itemConfig.quantity,
      printOptions: itemConfig.printOptions.map(pId => PRINT_OPTIONS.find(o => o.id === pId)),
      unitPrice,
      total: unitPrice * itemConfig.quantity
    };

    setCart([...cart, cartItem]);
    setSelectedItem(null);
    setItemConfig({ size: "M", color: "Black", quantity: 1, printOptions: [] });
    toast.success("Added to cart!");
  };

  const removeFromCart = (itemId) => {
    setCart(cart.filter(item => item.id !== itemId));
  };

  const updateQuantity = (itemId, delta) => {
    setCart(cart.map(item => {
      if (item.id === itemId) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty, total: item.unitPrice * newQty };
      }
      return item;
    }));
  };

  const togglePrintOption = (optionId) => {
    if (itemConfig.printOptions.includes(optionId)) {
      setItemConfig({ ...itemConfig, printOptions: itemConfig.printOptions.filter(id => id !== optionId) });
    } else {
      setItemConfig({ ...itemConfig, printOptions: [...itemConfig.printOptions, optionId] });
    }
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.total, 0);
  const cartQty = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleSubmitOrder = () => {
    const orderData = {
      order_number: `CLT-${Date.now().toString(36).toUpperCase()}`,
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
      subtotal: cartTotal,
      total: cartTotal,
      notes: clientInfo.notes,
      status: "pending"
    };
    submitOrderMutation.mutate(orderData);
  };

  // Item Configuration Modal
  if (selectedItem) {
    const printTotal = itemConfig.printOptions.reduce((sum, pId) => {
      const p = PRINT_OPTIONS.find(o => o.id === pId);
      return sum + (p?.price || 0);
    }, 0);
    const itemTotal = (selectedItem.price + printTotal) * itemConfig.quantity;

    return (
      <div className="min-h-screen bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto p-4 md:p-8">
          <Button variant="ghost" onClick={() => setSelectedItem(null)} className="mb-6 text-slate-400">
            ← Back to Catalog
          </Button>

          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <img 
                src={selectedItem.image} 
                alt={selectedItem.name}
                className="w-full aspect-square object-cover rounded-2xl"
              />
            </div>
            
            <div className="space-y-6">
              <div>
                <h1 className="text-3xl font-bold">{selectedItem.name}</h1>
                {selectedItem.code && <p className="text-slate-400">Code: {selectedItem.code}</p>}
                <p className="text-2xl font-bold text-emerald-400 mt-2">R{selectedItem.price}</p>
              </div>

              <div className="space-y-2 text-sm text-slate-400">
                {selectedItem.gsm && <p>GSM: {selectedItem.gsm}</p>}
                {selectedItem.material && <p>Material: {selectedItem.material}</p>}
              </div>

              {/* Size */}
              <div className="space-y-3">
                <Label className="text-white">Size</Label>
                <div className="flex flex-wrap gap-2">
                  {SIZES.map(size => (
                    <button
                      key={size}
                      onClick={() => setItemConfig({...itemConfig, size})}
                      className={`px-4 py-2 rounded-lg border-2 transition-all ${
                        itemConfig.size === size 
                          ? 'border-emerald-500 bg-emerald-500/20' 
                          : 'border-slate-600 hover:border-slate-500'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color */}
              <div className="space-y-3">
                <Label className="text-white">Color</Label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => setItemConfig({...itemConfig, color})}
                      className={`px-4 py-2 rounded-lg border-2 transition-all ${
                        itemConfig.color === color 
                          ? 'border-emerald-500 bg-emerald-500/20' 
                          : 'border-slate-600 hover:border-slate-500'
                      }`}
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </div>

              {/* Print Options */}
              <div className="space-y-3">
                <Label className="text-white">Print & Branding (optional)</Label>
                <div className="space-y-2">
                  {PRINT_OPTIONS.map(option => (
                    <button
                      key={option.id}
                      onClick={() => togglePrintOption(option.id)}
                      className={`w-full p-3 rounded-lg border-2 text-left flex justify-between items-center transition-all ${
                        itemConfig.printOptions.includes(option.id) 
                          ? 'border-emerald-500 bg-emerald-500/20' 
                          : 'border-slate-600 hover:border-slate-500'
                      }`}
                    >
                      <span>{option.name}</span>
                      <span className="text-slate-400">+R{option.price}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity */}
              <div className="space-y-3">
                <Label className="text-white">Quantity</Label>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setItemConfig({...itemConfig, quantity: Math.max(1, itemConfig.quantity - 1)})}
                    className="w-10 h-10 rounded-lg border border-slate-600 flex items-center justify-center"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-2xl font-bold w-16 text-center">{itemConfig.quantity}</span>
                  <button 
                    onClick={() => setItemConfig({...itemConfig, quantity: itemConfig.quantity + 1})}
                    className="w-10 h-10 rounded-lg border border-slate-600 flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Total & Add to Cart */}
              <div className="bg-slate-800 rounded-xl p-4">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-slate-400">Total</span>
                  <span className="text-3xl font-bold text-emerald-400">R{itemTotal}</span>
                </div>
                <Button onClick={addToCart} className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-lg">
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
                <Input
                  value={clientInfo.name}
                  onChange={(e) => setClientInfo({...clientInfo, name: e.target.value})}
                  className="bg-slate-800 border-slate-700"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Phone Number *</Label>
                <Input
                  value={clientInfo.phone}
                  onChange={(e) => setClientInfo({...clientInfo, phone: e.target.value})}
                  className="bg-slate-800 border-slate-700"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={clientInfo.email}
                  onChange={(e) => setClientInfo({...clientInfo, email: e.target.value})}
                  className="bg-slate-800 border-slate-700"
                />
              </div>
              <div className="space-y-2">
                <Label>Company/Brand Name</Label>
                <Input
                  value={clientInfo.company}
                  onChange={(e) => setClientInfo({...clientInfo, company: e.target.value})}
                  className="bg-slate-800 border-slate-700"
                />
              </div>
              <div className="space-y-2">
                <Label>Additional Notes</Label>
                <Textarea
                  value={clientInfo.notes}
                  onChange={(e) => setClientInfo({...clientInfo, notes: e.target.value})}
                  className="bg-slate-800 border-slate-700"
                  placeholder="Design details, special requests..."
                  rows={3}
                />
              </div>
            </div>

            {/* Order Summary */}
            <div className="bg-slate-800 rounded-xl p-4">
              <h3 className="font-semibold mb-4">Order Summary</h3>
              <div className="space-y-2 text-sm mb-4">
                {cart.map(item => (
                  <div key={item.id} className="flex justify-between">
                    <span>{item.quantity}x {item.catalogItem.name} ({item.size}, {item.color})</span>
                    <span>R{item.total}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-700 pt-4 flex justify-between text-xl font-bold">
                <span>Total</span>
                <span className="text-emerald-400">R{cartTotal}</span>
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
              We'll contact you to confirm details and payment. 50% deposit required to start production.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Main Catalog
  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
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
          
          <Button 
            onClick={() => cart.length > 0 && setShowCart(!showCart)}
            className="relative bg-slate-800 hover:bg-slate-700"
          >
            <ShoppingCart className="w-5 h-5" />
            {cartQty > 0 && (
              <span className="absolute -top-2 -right-2 w-6 h-6 bg-emerald-600 rounded-full text-xs flex items-center justify-center">
                {cartQty}
              </span>
            )}
          </Button>
        </div>
      </header>

      {/* Cart Drawer */}
      {showCart && cart.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setShowCart(false)}>
          <div 
            className="absolute right-0 top-0 h-full w-full max-w-md bg-slate-900 p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Your Cart</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowCart(false)}>
                <X className="w-5 h-5 text-white" />
              </Button>
            </div>

            <div className="space-y-4 mb-6">
              {cart.map(item => (
                <div key={item.id} className="bg-slate-800 rounded-lg p-4">
                  <div className="flex justify-between mb-2">
                    <div>
                      <p className="font-medium text-white">{item.catalogItem.name}</p>
                      <p className="text-sm text-slate-400">{item.size} • {item.color}</p>
                      {item.printOptions.length > 0 && (
                        <p className="text-xs text-emerald-400 mt-1">
                          {item.printOptions.map(p => p.name).join(", ")}
                        </p>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeFromCart(item.id)}>
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => updateQuantity(item.id, -1)}
                        className="w-8 h-8 rounded border border-slate-600 flex items-center justify-center text-white"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-8 text-center text-white">{item.quantity}</span>
                      <button 
                        onClick={() => updateQuantity(item.id, 1)}
                        className="w-8 h-8 rounded border border-slate-600 flex items-center justify-center text-white"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="font-semibold text-white">R{item.total}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-700 pt-4">
              <div className="flex justify-between text-xl font-bold text-white mb-4">
                <span>Total</span>
                <span className="text-emerald-400">R{cartTotal}</span>
              </div>
              <Button 
                onClick={() => { setShowCart(false); setShowCheckout(true); }}
                className="w-full bg-emerald-600 hover:bg-emerald-700 h-12"
              >
                Checkout <ChevronRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 py-12 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">Premium Apparel & Print</h2>
          <p className="text-emerald-100 text-lg">Quality blanks. Expert branding. Nationwide delivery.</p>
          <div className="flex flex-wrap justify-center gap-4 mt-6">
            <Badge className="bg-white/20 text-white">Stock Ready</Badge>
            <Badge className="bg-white/20 text-white">Bulk Discounts</Badge>
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
                <Card 
                  key={item.id}
                  className="bg-slate-800 border-0 overflow-hidden cursor-pointer hover:ring-2 hover:ring-emerald-500 transition-all"
                  onClick={() => setSelectedItem(item)}
                >
                  <img 
                    src={item.image} 
                    alt={item.name}
                    className="w-full aspect-square object-cover"
                  />
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

      {/* Footer */}
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