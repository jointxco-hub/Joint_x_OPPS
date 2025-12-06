import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Calculator, Plus, Trash2, Car } from "lucide-react";

const GARMENT_PRICES = {
  jv1: { name: "JV1 T-Shirt (180gsm)", price: 95 },
  jet: { name: "JET T-Shirt (220gsm)", price: 155 },
  jhg: { name: "JHG T-Shirt (300gsm)", price: 229 },
  hoodie_260: { name: "Hoodie 260gsm", price: 240 },
  hoodie_360: { name: "Hoodie 360gsm", price: 320 },
  hoodie_430: { name: "Hoodie 430gsm", price: 400 },
  sweater_260: { name: "Sweater 260gsm", price: 220 },
  sweater_360: { name: "Sweater 360gsm", price: 300 },
  sweater_430: { name: "Sweater 430gsm", price: 380 },
  cap_5panel: { name: "5-Panel Cap", price: 75 },
  bucket_hat: { name: "Bucket Hat", price: 120 },
  trackpants: { name: "Trackpants", price: 260 },
  shorts: { name: "Shorts", price: 180 }
};

const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];

const PRINT_OPTIONS = {
  dtf_a4: { name: "DTF A4", price: 80 },
  dtf_a3: { name: "DTF A3", price: 120 },
  dtf_epic_400x1000: { name: "DTF Epic (400mm x 1000mm)", price: 212.75 },
  dtf_kandy_570x1000: { name: "DTF Kandy (570mm x 1000mm)", price: 170 },
  vinyl_500x1000: { name: "Vinyl (500mm x 1000mm)", price: 120 },
  front_logo: { name: "Front Logo (DTF)", price: 40 },
  back_print: { name: "Back Print (DTF)", price: 60 },
  neck_tag: { name: "Neck Tag Print", price: 20 },
  vinyl_small: { name: "Vinyl Heat Transfer", price: 50 },
  vinyl_large: { name: "Vinyl Large", price: 80 },
  embroidery_small: { name: "Small Embroidery", price: 50 },
  embroidery_large: { name: "Large Embroidery", price: 100 },
  embroidery_setup: { name: "Embroidery Setup (once-off)", price: 300, once: true },
  screen_print: { name: "Screen Printing (per item, 50+ min)", price: 25 },
  label_application: { name: "Label Application", price: 3 },
  design_setup: { name: "Design Setup Fee", price: 175, once: true }
};

const ERRAND_PRESETS = [
  { name: "DTF Randburg", uber: 80, time: 45 },
  { name: "DTF Joburg", uber: 120, time: 60 },
  { name: "Blanks Joburg", uber: 100, time: 50 },
  { name: "JG Electronics", uber: 60, time: 30 }
];

export default function MultiPrintCalculator() {
  const [items, setItems] = useState([{
    id: 1,
    garmentType: "jet",
    sizeQuantities: {},
    selectedPrints: [],
    useCustomBlankPrice: false,
    customBlankPrice: 0
  }]);
  const [transportCost, setTransportCost] = useState(0);
  const [additionalCosts, setAdditionalCosts] = useState([]);
  const [quotedPrice, setQuotedPrice] = useState(0);

  const addItem = () => {
    setItems([...items, {
      id: Date.now(),
      garmentType: "jet",
      sizeQuantities: {},
      selectedPrints: [],
      useCustomBlankPrice: false,
      customBlankPrice: 0
    }]);
  };

  const removeItem = (id) => {
    if (items.length > 1) {
      setItems(items.filter(item => item.id !== id));
    }
  };

  const updateItem = (id, field, value) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const updateSizeQty = (itemId, size, delta) => {
    setItems(items.map(item => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        sizeQuantities: {
          ...item.sizeQuantities,
          [size]: Math.max(0, (item.sizeQuantities[size] || 0) + delta)
        }
      };
    }));
  };

  const setSizeQtyDirect = (itemId, size, value) => {
    setItems(items.map(item => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        sizeQuantities: {
          ...item.sizeQuantities,
          [size]: Math.max(0, parseInt(value) || 0)
        }
      };
    }));
  };

  const togglePrint = (itemId, printKey) => {
    setItems(items.map(item => {
      if (item.id !== itemId) return item;
      const prints = item.selectedPrints.includes(printKey)
        ? item.selectedPrints.filter(p => p !== printKey)
        : [...item.selectedPrints, printKey];
      return { ...item, selectedPrints: prints };
    }));
  };

  const addAdditionalCost = () => {
    setAdditionalCosts([...additionalCosts, { name: "", amount: 0 }]);
  };

  const updateAdditionalCost = (index, field, value) => {
    const updated = [...additionalCosts];
    updated[index][field] = value;
    setAdditionalCosts(updated);
  };

  const removeAdditionalCost = (index) => {
    setAdditionalCosts(additionalCosts.filter((_, i) => i !== index));
  };

  // Calculate totals
  let totalGarmentCost = 0;
  let totalPrintCost = 0;
  let totalQuantity = 0;
  let onceOffCosts = 0;

  items.forEach(item => {
    const itemQty = Object.values(item.sizeQuantities).reduce((sum, q) => sum + q, 0);
    totalQuantity += itemQty;
    
    const garmentUnitCost = item.useCustomBlankPrice 
      ? item.customBlankPrice 
      : GARMENT_PRICES[item.garmentType]?.price || 0;
    totalGarmentCost += garmentUnitCost * itemQty;

    let printCostPerItem = 0;
    item.selectedPrints.forEach(printKey => {
      const print = PRINT_OPTIONS[printKey];
      if (print) {
        if (print.once) {
          onceOffCosts += print.price;
        } else {
          printCostPerItem += print.price;
        }
      }
    });
    totalPrintCost += printCostPerItem * itemQty;
  });

  const totalAdditional = additionalCosts.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
  const totalCost = totalGarmentCost + totalPrintCost + onceOffCosts + parseFloat(transportCost || 0) + totalAdditional;
  const costPerItem = totalQuantity > 0 ? totalCost / totalQuantity : 0;
  const profit = (parseFloat(quotedPrice) || 0) - totalCost;
  const profitMargin = quotedPrice > 0 ? (profit / quotedPrice) * 100 : 0;

  return (
    <Card className="bg-white border-0 shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calculator className="w-5 h-5 text-blue-600" />
            Job Calculator
          </CardTitle>
          <Button variant="outline" size="sm" onClick={addItem}>
            <Plus className="w-4 h-4 mr-1" /> Add Product
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Items */}
        {items.map((item, index) => (
          <div key={item.id} className="border rounded-xl p-4 space-y-4 bg-slate-50">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-700">Product {index + 1}</h3>
              {items.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removeItem(item.id)}>
                  <Trash2 className="w-4 h-4 text-red-500" />
                </Button>
              )}
            </div>

            {/* Garment Type */}
            <div className="space-y-2">
              <Label className="text-sm">Garment Type</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(GARMENT_PRICES).map(([key, val]) => (
                  <button
                    key={key}
                    onClick={() => updateItem(item.id, 'garmentType', key)}
                    className={`p-2 rounded-lg border-2 text-left text-xs transition-all ${
                      item.garmentType === key 
                        ? 'border-blue-500 bg-blue-50' 
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <p className="font-medium truncate">{val.name}</p>
                    <p className="text-slate-500">R{val.price}</p>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Checkbox 
                  checked={item.useCustomBlankPrice}
                  onCheckedChange={(checked) => updateItem(item.id, 'useCustomBlankPrice', checked)}
                />
                <Label className="text-xs">Custom price</Label>
                {item.useCustomBlankPrice && (
                  <Input
                    type="number"
                    value={item.customBlankPrice}
                    onChange={(e) => updateItem(item.id, 'customBlankPrice', parseFloat(e.target.value) || 0)}
                    className="w-20 h-7 text-xs"
                    placeholder="R"
                  />
                )}
              </div>
            </div>

            {/* Size Quantities */}
            <div className="space-y-2">
              <Label className="text-sm">Sizes & Quantities</Label>
              <div className="grid grid-cols-7 gap-1">
                {SIZES.map(size => (
                  <div key={size} className="text-center">
                    <p className="text-xs font-medium mb-1">{size}</p>
                    <Input
                      type="number"
                      min="0"
                      value={item.sizeQuantities[size] || 0}
                      onChange={(e) => setSizeQtyDirect(item.id, size, e.target.value)}
                      className="h-8 text-center text-xs p-1"
                    />
                  </div>
                ))}
              </div>
              {Object.values(item.sizeQuantities).reduce((sum, q) => sum + q, 0) > 0 && (
                <p className="text-xs text-blue-600 font-medium">
                  Total: {Object.values(item.sizeQuantities).reduce((sum, q) => sum + q, 0)} items
                </p>
              )}
            </div>

            {/* Print Options */}
            <div className="space-y-2">
              <Label className="text-sm">Print & Branding</Label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(PRINT_OPTIONS).map(([key, val]) => (
                  <button
                    key={key}
                    onClick={() => togglePrint(item.id, key)}
                    className={`p-2 rounded-lg border-2 text-left text-xs transition-all flex justify-between items-center ${
                      item.selectedPrints.includes(key) 
                        ? 'border-emerald-500 bg-emerald-50' 
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <span className="truncate">{val.name}</span>
                    <span className="text-slate-500 ml-1">
                      R{val.price}{val.once ? '*' : ''}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">* once-off fee</p>
            </div>
          </div>
        ))}

        {/* Transport with Presets */}
        <div className="space-y-3">
          <Label>Transport/Uber Cost (R)</Label>
          <div className="flex flex-wrap gap-2 mb-2">
            {ERRAND_PRESETS.map(preset => (
              <Button 
                key={preset.name}
                variant="outline" 
                size="sm"
                onClick={() => setTransportCost(transportCost + preset.uber)}
                className="text-xs"
              >
                <Car className="w-3 h-3 mr-1" />
                {preset.name} (~R{preset.uber}, {preset.time}min)
              </Button>
            ))}
          </div>
          <Input
            type="number"
            min="0"
            value={transportCost}
            onChange={(e) => setTransportCost(e.target.value)}
            placeholder="0"
          />
        </div>

        {/* Additional Costs */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Additional Costs</Label>
            <Button variant="outline" size="sm" onClick={addAdditionalCost}>
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </div>
          {additionalCosts.map((cost, index) => (
            <div key={index} className="flex gap-2 items-center">
              <Input
                placeholder="Description"
                value={cost.name}
                onChange={(e) => updateAdditionalCost(index, "name", e.target.value)}
                className="flex-1"
              />
              <Input
                type="number"
                placeholder="R"
                value={cost.amount}
                onChange={(e) => updateAdditionalCost(index, "amount", e.target.value)}
                className="w-24"
              />
              <Button variant="ghost" size="icon" onClick={() => removeAdditionalCost(index)}>
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            </div>
          ))}
        </div>

        {/* Quoted Price */}
        <div className="space-y-2">
          <Label>Quoted Price to Client (R)</Label>
          <Input
            type="number"
            min="0"
            value={quotedPrice}
            onChange={(e) => setQuotedPrice(e.target.value)}
            placeholder="0"
            className="text-lg font-semibold"
          />
        </div>

        {/* Results */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <h4 className="font-semibold text-slate-700">Cost Breakdown</h4>
          
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Garments ({totalQuantity} items)</span>
              <span>R{totalGarmentCost.toFixed(2)}</span>
            </div>
            
            {totalPrintCost > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-600">Printing (per item)</span>
                <span>R{totalPrintCost.toFixed(2)}</span>
              </div>
            )}

            {onceOffCosts > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-600">Setup Fees</span>
                <span>R{onceOffCosts.toFixed(2)}</span>
              </div>
            )}
            
            {parseFloat(transportCost) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-600">Transport</span>
                <span>R{parseFloat(transportCost).toFixed(2)}</span>
              </div>
            )}
            
            {additionalCosts.map((cost, i) => (
              parseFloat(cost.amount) > 0 && (
                <div key={i} className="flex justify-between">
                  <span className="text-slate-600">{cost.name || "Additional"}</span>
                  <span>R{parseFloat(cost.amount).toFixed(2)}</span>
                </div>
              )
            ))}
          </div>

          <div className="border-t border-slate-200 pt-3 space-y-2">
            <div className="flex justify-between font-semibold">
              <span>Total Cost</span>
              <span>R{totalCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-600">
              <span>Cost per Item</span>
              <span>R{costPerItem.toFixed(2)}</span>
            </div>
          </div>

          {parseFloat(quotedPrice) > 0 && (
            <div className="border-t border-slate-200 pt-3 space-y-2">
              <div className={`flex justify-between font-bold text-lg ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                <span>Profit</span>
                <span>R{profit.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Profit Margin</span>
                <span className={profitMargin >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                  {profitMargin.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Price per Item</span>
                <span>R{(quotedPrice / totalQuantity).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}