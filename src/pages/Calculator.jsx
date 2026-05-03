import React, { useState } from "react";
import { Calculator as CalcIcon, Plus, Trash2, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

const DEFAULT_ITEMS = [
  { id: 1, label: "Cost of Goods", value: 0 },
  { id: 2, label: "Printing / Embroidery", value: 0 },
  { id: 3, label: "Packaging", value: 0 },
  { id: 4, label: "Shipping", value: 0 },
];

export default function Calculator() {
  const [items, setItems] = useState(DEFAULT_ITEMS);
  const [quantity, setQuantity] = useState(1);
  const [margin, setMargin] = useState(40);
  const [newLabel, setNewLabel] = useState("");

  const totalCost = items.reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
  const costPerUnit = quantity > 0 ? totalCost / quantity : 0;
  const profitAmount = costPerUnit * (margin / 100);
  const finalPrice = costPerUnit + profitAmount;
  const totalRevenue = finalPrice * quantity;

  const updateItem = (id, field, val) => setItems(items.map(i => i.id === id ? { ...i, [field]: val } : i));
  const removeItem = (id) => setItems(items.filter(i => i.id !== id));
  const addItem = () => {
    if (!newLabel.trim()) return;
    setItems([...items, { id: Date.now(), label: newLabel, value: 0 }]);
    setNewLabel("");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6 md:py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <CalcIcon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Pricing Calculator</h1>
            <p className="text-muted-foreground text-sm">Cost + Margin = Price</p>
          </div>
          <button onClick={() => { setItems(DEFAULT_ITEMS); setQuantity(1); setMargin(40); }}
            className="ml-auto text-muted-foreground hover:text-foreground transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Cost Items */}
        <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5 mb-4">
          <h2 className="text-sm font-semibold text-foreground mb-4">Cost Breakdown</h2>
          <div className="space-y-3 mb-4">
            {items.map(item => (
              <div key={item.id} className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground flex-1">{item.label}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">R</span>
                  <Input
                    type="number"
                    value={item.value}
                    onChange={e => updateItem(item.id, 'value', e.target.value)}
                    className="w-24 h-8 rounded-xl text-sm text-right"
                  />
                </div>
                <button onClick={() => removeItem(item.id)} className="text-muted-foreground hover:text-destructive transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Add cost line..."
              className="rounded-xl text-sm h-8" onKeyDown={e => e.key === 'Enter' && addItem()} />
            <Button size="sm" variant="outline" onClick={addItem} className="rounded-xl h-8 px-3">
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Settings */}
        <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5 mb-4">
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground">Quantity</label>
                <span className="text-sm font-bold text-foreground">{quantity} units</span>
              </div>
              <Input type="number" value={quantity} onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="rounded-xl text-sm" min="1" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm text-muted-foreground">Profit Margin</label>
                <span className="text-sm font-bold text-primary">{margin}%</span>
              </div>
              <Slider value={[margin]} onValueChange={([v]) => setMargin(v)} min={0} max={200} step={5} className="w-full" />
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="bg-primary rounded-2xl p-5 text-white shadow-apple">
          <h2 className="text-sm font-semibold text-primary-foreground/70 mb-4">Pricing Summary</h2>
          <div className="space-y-2.5">
            <ResultRow label="Total Cost" value={`R${totalCost.toFixed(2)}`} />
            <ResultRow label={`Cost per Unit (÷${quantity})`} value={`R${costPerUnit.toFixed(2)}`} />
            <ResultRow label={`Profit (${margin}%)`} value={`+R${profitAmount.toFixed(2)}`} />
            <div className="pt-3 border-t border-white/20">
              <ResultRow label="SELLING PRICE" value={`R${finalPrice.toFixed(2)}`} large />
            </div>
            <ResultRow label={`Total Revenue (×${quantity})`} value={`R${totalRevenue.toFixed(2)}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultRow({ label, value, large }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`${large ? 'text-base font-bold text-white' : 'text-sm text-primary-foreground/70'}`}>{label}</span>
      <span className={`font-bold ${large ? 'text-2xl text-white' : 'text-sm text-white'}`}>{value}</span>
    </div>
  );
}