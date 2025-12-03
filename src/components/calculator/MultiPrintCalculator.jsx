import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calculator, Plus, Trash2, X } from "lucide-react";

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

const PRINT_OPTIONS = {
  dtf_a4: { name: "DTF A4", price: 80 },
  dtf_a3: { name: "DTF A3", price: 120 },
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

export default function MultiPrintCalculator() {
  const [garmentType, setGarmentType] = useState("jet");
  const [quantity, setQuantity] = useState(10);
  const [selectedPrints, setSelectedPrints] = useState([]);
  const [blanksCost, setBlanksCost] = useState(0);
  const [transportCost, setTransportCost] = useState(0);
  const [additionalCosts, setAdditionalCosts] = useState([]);
  const [quotedPrice, setQuotedPrice] = useState(0);
  const [useCustomBlankPrice, setUseCustomBlankPrice] = useState(false);
  const [customBlankPrice, setCustomBlankPrice] = useState(0);

  const togglePrint = (printKey) => {
    if (selectedPrints.includes(printKey)) {
      setSelectedPrints(selectedPrints.filter(p => p !== printKey));
    } else {
      setSelectedPrints([...selectedPrints, printKey]);
    }
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

  // Calculate costs
  const garmentUnitCost = useCustomBlankPrice ? customBlankPrice : GARMENT_PRICES[garmentType]?.price || 0;
  const garmentTotal = garmentUnitCost * quantity;

  let printCostPerItem = 0;
  let onceOffCosts = 0;
  selectedPrints.forEach(printKey => {
    const print = PRINT_OPTIONS[printKey];
    if (print) {
      if (print.once) {
        onceOffCosts += print.price;
      } else {
        printCostPerItem += print.price;
      }
    }
  });
  const printTotal = (printCostPerItem * quantity) + onceOffCosts;

  const totalAdditional = additionalCosts.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
  const totalCost = garmentTotal + printTotal + parseFloat(transportCost || 0) + totalAdditional;
  const costPerItem = quantity > 0 ? totalCost / quantity : 0;
  const profit = (parseFloat(quotedPrice) || 0) - totalCost;
  const profitMargin = quotedPrice > 0 ? (profit / quotedPrice) * 100 : 0;

  return (
    <Card className="bg-white border-0 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calculator className="w-5 h-5 text-blue-600" />
          Job Calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Garment Selection */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">Garment Type</Label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {Object.entries(GARMENT_PRICES).map(([key, val]) => (
              <button
                key={key}
                onClick={() => setGarmentType(key)}
                className={`p-3 rounded-lg border-2 text-left text-sm transition-all ${
                  garmentType === key 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <p className="font-medium">{val.name}</p>
                <p className="text-slate-500">R{val.price}</p>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Checkbox 
              checked={useCustomBlankPrice}
              onCheckedChange={setUseCustomBlankPrice}
            />
            <Label className="text-sm">Use custom blank price</Label>
            {useCustomBlankPrice && (
              <Input
                type="number"
                value={customBlankPrice}
                onChange={(e) => setCustomBlankPrice(parseFloat(e.target.value) || 0)}
                className="w-24 h-8"
                placeholder="R"
              />
            )}
          </div>
        </div>

        {/* Quantity */}
        <div className="space-y-2">
          <Label>Quantity</Label>
          <Input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
          />
        </div>

        {/* Print Options - Multi-select */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">Print & Branding Options</Label>
          <p className="text-sm text-slate-500">Select all that apply to this job</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(PRINT_OPTIONS).map(([key, val]) => (
              <button
                key={key}
                onClick={() => togglePrint(key)}
                className={`p-3 rounded-lg border-2 text-left text-sm transition-all flex justify-between items-center ${
                  selectedPrints.includes(key) 
                    ? 'border-emerald-500 bg-emerald-50' 
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  <p className="font-medium">{val.name}</p>
                  <p className="text-slate-500">
                    R{val.price}{val.once ? ' (once-off)' : '/item'}
                  </p>
                </div>
                {selectedPrints.includes(key) && (
                  <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-xs">✓</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Transport */}
        <div className="space-y-2">
          <Label>Transport/Uber Cost (R)</Label>
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
              <span className="text-slate-600">
                Garments ({quantity}x R{garmentUnitCost})
              </span>
              <span>R{garmentTotal.toFixed(2)}</span>
            </div>
            
            {selectedPrints.length > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-600">
                  Printing ({selectedPrints.length} options)
                </span>
                <span>R{printTotal.toFixed(2)}</span>
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
                <span>R{(quotedPrice / quantity).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}