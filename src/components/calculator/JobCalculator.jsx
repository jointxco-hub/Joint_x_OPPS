import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calculator, Plus, Trash2 } from "lucide-react";

const PRINT_PRICES = {
  vinyl_videoflex: { price: 110, label: "Vinyl Videoflex", unit: "per meter" },
  vinyl_flock: { price: 150, label: "Vinyl Flock", unit: "per meter" },
  vinyl_silicon: { price: 180, label: "Vinyl Silicon", unit: "per meter" },
  dtf_randburg: { price: 212.75, label: "DTF (Randburg - Quality)", unit: "per meter" },
  dtf_joburg: { price: 170, label: "DTF (Joburg)", unit: "per meter" }
};

export default function JobCalculator({ onSave }) {
  const [printType, setPrintType] = useState("vinyl_videoflex");
  const [meters, setMeters] = useState(1);
  const [quantity, setQuantity] = useState(1);
  const [blanksCost, setBlanksCost] = useState(0);
  const [transportCost, setTransportCost] = useState(0);
  const [quotedPrice, setQuotedPrice] = useState(0);
  const [additionalCosts, setAdditionalCosts] = useState([]);

  const printCost = PRINT_PRICES[printType].price * meters;
  const totalAdditional = additionalCosts.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
  const totalCost = printCost + (parseFloat(blanksCost) || 0) + (parseFloat(transportCost) || 0) + totalAdditional;
  const costPerItem = quantity > 0 ? totalCost / quantity : 0;
  const profit = (parseFloat(quotedPrice) || 0) - totalCost;
  const profitMargin = quotedPrice > 0 ? (profit / quotedPrice) * 100 : 0;

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

  return (
    <Card className="bg-white border-0 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calculator className="w-5 h-5 text-blue-600" />
          Job Calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Print Type */}
        <div className="space-y-2">
          <Label>Print Type</Label>
          <Select value={printType} onValueChange={setPrintType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PRINT_PRICES).map(([key, val]) => (
                <SelectItem key={key} value={key}>
                  {val.label} - R{val.price} {val.unit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Meters Required</Label>
            <Input
              type="number"
              min="0"
              step="0.1"
              value={meters}
              onChange={(e) => setMeters(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label>Quantity (items)</Label>
            <Input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Blanks Cost (R)</Label>
            <Input
              type="number"
              min="0"
              value={blanksCost}
              onChange={(e) => setBlanksCost(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label>Transport/Uber (R)</Label>
            <Input
              type="number"
              min="0"
              value={transportCost}
              onChange={(e) => setTransportCost(e.target.value)}
              placeholder="0"
            />
          </div>
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
              <span className="text-slate-600">Print ({PRINT_PRICES[printType].label})</span>
              <span>R{printCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Blanks</span>
              <span>R{parseFloat(blanksCost || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Transport</span>
              <span>R{parseFloat(transportCost || 0).toFixed(2)}</span>
            </div>
            {additionalCosts.map((cost, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-slate-600">{cost.name || "Additional"}</span>
                <span>R{parseFloat(cost.amount || 0).toFixed(2)}</span>
              </div>
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

          {quotedPrice > 0 && (
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
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}