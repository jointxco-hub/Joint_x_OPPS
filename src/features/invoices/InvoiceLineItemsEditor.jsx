import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calculateInvoiceLine } from "./invoiceCalculations";

const emptyItem = {
  item_name: "",
  item_description: "",
  item_type: "goods",
  quantity: 1,
  unit: "",
  rate: 0,
  discount: 0,
  tax_name: "",
  tax_percentage: 0,
  account_name: "",
};

export default function InvoiceLineItemsEditor({ items = [], onChange }) {
  const safeItems = items.length ? items : [emptyItem];

  const updateItem = (index, patch) => {
    onChange(safeItems.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )));
  };

  const addItem = () => onChange([...safeItems, { ...emptyItem }]);
  const removeItem = (index) => {
    const next = safeItems.filter((_, itemIndex) => itemIndex !== index);
    onChange(next.length ? next : [{ ...emptyItem }]);
  };

  return (
    <div className="space-y-3">
      {safeItems.map((item, index) => {
        const calculated = calculateInvoiceLine(item);
        return (
          <div key={index} className="rounded-2xl border border-border bg-card p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line {index + 1}</p>
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="grid h-8 w-8 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-destructive"
                aria-label="Remove line item"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-12">
              <Input
                value={item.item_name || ""}
                onChange={(event) => updateItem(index, { item_name: event.target.value })}
                placeholder="Item name"
                className="h-10 rounded-xl md:col-span-5"
              />
              <Input
                value={item.quantity ?? ""}
                onChange={(event) => updateItem(index, { quantity: event.target.value })}
                type="number"
                min="0"
                step="0.01"
                placeholder="Qty"
                className="h-10 rounded-xl md:col-span-2"
              />
              <Input
                value={item.rate ?? ""}
                onChange={(event) => updateItem(index, { rate: event.target.value })}
                type="number"
                min="0"
                step="0.01"
                placeholder="Rate"
                className="h-10 rounded-xl md:col-span-2"
              />
              <Input
                value={item.discount ?? ""}
                onChange={(event) => updateItem(index, { discount: event.target.value })}
                type="number"
                min="0"
                step="0.01"
                placeholder="Discount"
                className="h-10 rounded-xl md:col-span-2"
              />
              <div className="flex h-10 items-center justify-end rounded-xl bg-secondary/50 px-3 text-sm font-semibold text-foreground md:col-span-1">
                R{Number(calculated.item_total || 0).toLocaleString()}
              </div>
              <Input
                value={item.item_description || ""}
                onChange={(event) => updateItem(index, { item_description: event.target.value })}
                placeholder="Description"
                className="h-10 rounded-xl md:col-span-5"
              />
              <select
                value={item.item_type || "goods"}
                onChange={(event) => updateItem(index, { item_type: event.target.value })}
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm md:col-span-2"
              >
                <option value="goods">Goods</option>
                <option value="services">Services</option>
              </select>
              <Input
                value={item.unit || ""}
                onChange={(event) => updateItem(index, { unit: event.target.value })}
                placeholder="Unit"
                className="h-10 rounded-xl md:col-span-1"
              />
              <Input
                value={item.tax_name || ""}
                onChange={(event) => updateItem(index, { tax_name: event.target.value })}
                placeholder="Tax name"
                className="h-10 rounded-xl md:col-span-2"
              />
              <Input
                value={item.tax_percentage ?? ""}
                onChange={(event) => updateItem(index, { tax_percentage: event.target.value })}
                type="number"
                min="0"
                step="0.01"
                placeholder="Tax %"
                className="h-10 rounded-xl md:col-span-2"
              />
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" onClick={addItem} className="h-10 rounded-xl">
        <Plus className="h-4 w-4" /> Add line
      </Button>
    </div>
  );
}
